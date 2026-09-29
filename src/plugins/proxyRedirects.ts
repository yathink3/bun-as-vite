import path from 'path';
import fs from 'fs';
import type { BavPlugin, PluginContext, BuildCompleteContext } from '../types';

/**
 * Supported target platforms for outputting deployment redirect rules.
 */
export type DeployPlatform = 'netlify' | 'vercel' | 'nginx' | string;

/**
 * Options for the proxyRedirectsPlugin.
 */
export interface ProxyRedirectsPluginOptions {
  /**
   * Relative path to the template file containing proxy/redirect rules.
   * @default 'redirects.template'
   */
  templateFile?: string;
  /**
   * Inline template string containing proxy/redirect rules. Overrides `templateFile` if provided.
   */
  templateString?: string;
  /**
   * Custom server.proxy configuration object to merge.
   */
  proxy?: Record<string, any> | null;
  /**
   * Custom key-value map of environment variable replacements for template placeholders (`{{VAR_NAME}}`).
   */
  envMap?: Record<string, string>;
  /**
   * Target deployment platform for production build redirect output (`'netlify'`, `'vercel'`, or `'nginx'`).
   * @default 'netlify'
   */
  deployPlatform?: DeployPlatform;
  /**
   * If true, suppresses writing production redirect files during build.
   * @default false
   */
  ignoreBuild?: boolean;
  /**
   * Custom output directory path for generated redirect configuration files. Defaults to build outDir.
   */
  outDir?: string;
}

export type ProxyRedirectsOptions = ProxyRedirectsPluginOptions;

const getLines = (tpl: string): string[] =>
  tpl
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

const extractVars = (str: string): string[] => [
  ...new Set(str.match(/{{(.*?)}}/g)?.map(m => m.slice(2, -2)) || []),
];

const hasAllEnvVars = (str: string, envMap: Record<string, string>): boolean =>
  extractVars(str).every(k => envMap[k]);

const applyEnv = (str: string, envMap: Record<string, string>): string =>
  str.replace(/{{(.*?)}}/g, (_, k) => envMap[k] || '');

const splitTargetPath = (url: string) => {
  const target = url.match(/^https?:\/\/[^/]+/)?.[0] || '';
  const urlpart = url.slice(target.length);
  const pathPart = (urlpart.replace(/\*/g, '').replace(/:\w+$/, '') || '/').replace(/\/+$/, '/');
  return { target, pathPart };
};

const makeProxyEntry = (prefix: string, { target, pathPart }: { target: string; pathPart: string }) => {
  const entry: any = { target, changeOrigin: true, secure: false };
  if (pathPart !== '/' && !pathPart.startsWith(prefix)) {
    const pat = new RegExp(`^${prefix}`);
    entry.rewrite = (p: string) => p.replace(pat, pathPart);
  }
  return entry;
};

const detectPlatform = (envMap: Record<string, string>): string => {
  const flag = (v?: string) => String(v || '').toLowerCase();
  const platform = flag(envMap.DEPLOY_PLATFORM);
  if (platform === 'vercel') return 'vercel';
  if (platform === 'netlify') return 'netlify';
  if (platform === 'nginx') return 'nginx';
  if (envMap.VERCEL === '1') return 'vercel';
  if (envMap.NETLIFY === 'true') return 'netlify';
  return '';
};

// ─────────────── redirect writers ───────────────
const writeNetlifyRedirects = (lines: string[], envMap: Record<string, string>, outputPath: string) => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const redirects = lines
    .map(line => {
      const [from, to] = line.split(/\s+/);
      const resolvedTo = applyEnv(to, envMap).replace(/\*/g, ':splat');
      if (from === '/*' && resolvedTo === '/index.html') return '';
      return `${from} ${resolvedTo} 200!`;
    })
    .filter(Boolean);
  redirects.push('/* /index.html 200');
  const result = redirects.join('\n');
  fs.writeFileSync(outputPath, result);
};

const writeVercelRedirects = (lines: string[], envMap: Record<string, string>, outputPath: string) => {
  const rewrites = lines
    .map(line => {
      const [from, to] = line.split(/\s+/);
      const resolvedTo = applyEnv(to, envMap).replace(/\*/g, '').replace(/:\w+$/, '');
      if (from === '/*' && resolvedTo === '/index.html') return '';
      return { source: from, destination: resolvedTo };
    })
    .filter(Boolean);
  rewrites.push({ source: '/(.*)', destination: '/' });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const json = { rewrites };
  fs.writeFileSync(outputPath, JSON.stringify(json, null, 2));
};

const writeNginxRedirects = (lines: string[], envMap: Record<string, string>, outputPath: string) => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const header = `# Nginx Redirects
#
# Copy and paste the following rewrite rules into your Nginx server block.
\n`;

  const rewriteRules = lines.map(line => {
    const [from, to] = line.split(/\s+/);
    const escapedFrom = from.replace(/([.])/g, '\\$1').replace(/\*$/, '(.*)');
    const resolvedTo = applyEnv(to, envMap);
    const resolvedToWithCapture = resolvedTo.endsWith('$1') ? resolvedTo : `${resolvedTo}$1`;
    return `rewrite ^${escapedFrom}$ ${resolvedToWithCapture} permanent;`;
  });
  fs.writeFileSync(outputPath, header + rewriteRules.join('\n'));
};

/**
 * Proxy redirects plugin.
 * Configures upstream proxies from Vite server.proxy or Netlify-style redirect templates,
 * and outputs deployment redirect rules for Netlify, Vercel, or Nginx on production build unless ignoreBuild is set.
 */
export function proxyRedirectsPlugin(options: ProxyRedirectsPluginOptions = {}): BavPlugin {
  const {
    templateFile = 'redirects.template',
    templateString = '',
    proxy = null,
    envMap = {},
    deployPlatform = 'netlify',
    ignoreBuild = false,
  } = options;

  let template = templateString;
  let activeEnvMap: Record<string, string> = {};

  return {
    name: 'bav:proxy-redirects',

    configBun(ctx: PluginContext) {
      ctx.config.server = ctx.config.server || {};
      ctx.config.server.proxy = ctx.config.server.proxy || {};

      if (proxy && typeof proxy === 'object') {
        Object.assign(ctx.config.server.proxy, proxy);
      }

      if (!template && templateFile) {
        const tplPath = path.resolve(ctx.root, templateFile);
        if (fs.existsSync(tplPath)) {
          try {
            template = fs.readFileSync(tplPath, 'utf8');
          } catch {
            template = '';
          }
        }
      }

      const mergedEnv = { ...process.env, ...envMap };
      const allVars = [...new Set(getLines(template).flatMap(extractVars))];
      activeEnvMap = Object.fromEntries(allVars.map(k => [k, mergedEnv[k]]).filter(([, v]) => !!v));

      if (template) {
        for (const line of getLines(template)) {
          if (!hasAllEnvVars(line, activeEnvMap)) continue;
          const [from, raw] = line.split(/\s+/);
          if (!from || !raw) continue;

          const resolved = applyEnv(raw, activeEnvMap);
          const cleanFrom = from.replace(/\*$/, '');
          const route = cleanFrom.length > 1 && cleanFrom.endsWith('/') ? cleanFrom.slice(0, -1) : cleanFrom;
          if (route === '/') continue;

          const isProxy = /^https?:\/\//i.test(resolved) || /^wss?:\/\//i.test(resolved);

          if (isProxy) {
            const { target, pathPart } = splitTargetPath(resolved);
            const cleanPathPart = pathPart.replace(/\/+$/, '');
            const proxyEntry: any = {
              target,
              displayTarget: `${target}${cleanPathPart}`,
              pathPart: cleanPathPart,
              changeOrigin: true,
              secure: false,
            };

            if (cleanPathPart && cleanPathPart !== route) {
              const pat = new RegExp(`^${route}(/|$)`);
              proxyEntry.rewrite = (p: string) => p.replace(pat, `${cleanPathPart}$1`);
            }

            ctx.config.server.proxy[route] = proxyEntry;
          } else {
            if (from === '/*' && (resolved === '/index.html' || resolved === 'index.html')) continue;
            ctx.config.server.rewrites = ctx.config.server.rewrites || [];
            ctx.config.server.rewrites.push({
              from,
              to: resolved,
              prefix: route,
              status: 200,
            });
          }
        }
      }
    },

    buildComplete(_result: any, ctx: BuildCompleteContext) {
      const isProd = ctx.mode === 'production' || process.env.NODE_ENV === 'production';
      if (isProd && !ignoreBuild && template) {
        try {
          const effectiveOutDir = options.outDir || ctx.outDir || 'build';
          const lines = getLines(template).filter(line => hasAllEnvVars(line, activeEnvMap));
          const platform = detectPlatform(activeEnvMap) || deployPlatform || 'unknown';

          let successMessage = '';
          if (platform === 'netlify') {
            const outputPath = path.resolve(effectiveOutDir, '_redirects');
            writeNetlifyRedirects(lines, activeEnvMap, outputPath);
            successMessage = `Wrote Netlify _redirects to ${outputPath}`;
          } else if (platform === 'vercel') {
            const vercelPath = path.resolve(effectiveOutDir, 'vercel.json');
            writeVercelRedirects(lines, activeEnvMap, vercelPath);
            successMessage = `Wrote Vercel redirects to ${vercelPath}`;
          } else if (platform === 'nginx') {
            const nginxPath = path.resolve(effectiveOutDir, 'nginx.conf.snippet');
            writeNginxRedirects(lines, activeEnvMap, nginxPath);
            successMessage = `Wrote Nginx config snippet to ${nginxPath}`;
          } else {
            console.warn(`\x1b[33m[bun-as-vite:proxy-redirects] Unknown deploy platform: ${platform}. Set DEPLOY_PLATFORM=netlify|vercel|nginx\x1b[0m`);
            return;
          }
          console.log(`\x1b[32m✔  [bun-as-vite:proxy-redirects]\x1b[0m ${successMessage}`);
        } catch (e: any) {
          console.error(`\x1b[31m✖  [bun-as-vite:proxy-redirects] Failed writing redirects: ${e.message}\x1b[0m`);
        }
      }
    },
  };
}

export default proxyRedirectsPlugin;
