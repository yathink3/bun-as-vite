import path from 'path';
import fs from 'fs';
import { MIME_TYPES } from '../utils/mime';
import { logBox, logStep } from '../utils/logger';
import type { BavPlugin, PluginContext, BuildCompleteContext, ServerRequestContext, LocalRewriteRule } from '../types';

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

// ─────────────── template helpers ───────────────

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
  fs.writeFileSync(outputPath, redirects.join('\n'));
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
  fs.writeFileSync(outputPath, JSON.stringify({ rewrites }, null, 2));
};

const writeNginxRedirects = (lines: string[], envMap: Record<string, string>, outputPath: string) => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const header = `# Nginx Redirects\n#\n# Copy and paste the following rewrite rules into your Nginx server block.\n\n`;
  const rewriteRules = lines.map(line => {
    const [from, to] = line.split(/\s+/);
    const escapedFrom = from.replace(/([.])/g, '\\$1').replace(/\*$/, '(.*)');
    const resolvedTo = applyEnv(to, envMap);
    const resolvedToWithCapture = resolvedTo.endsWith('$1') ? resolvedTo : `${resolvedTo}$1`;
    return `rewrite ^${escapedFrom}$ ${resolvedToWithCapture} permanent;`;
  });
  fs.writeFileSync(outputPath, header + rewriteRules.join('\n'));
};

// ─────────────── sub-app build-dir detection ───────────────

const subAppBuildDirCache = new Map<string, string[]>();

function detectSubAppBuildDirs(root: string, prefix: string): string[] {
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  if (!cleanPrefix) return [];

  const cacheKey = `${root}:${cleanPrefix}`;
  if (subAppBuildDirCache.has(cacheKey)) {
    return subAppBuildDirCache.get(cacheKey)!;
  }

  const detectedDirs: string[] = [];
  const addDir = (dirPath: string) => {
    if (dirPath && fs.existsSync(dirPath)) {
      try {
        if (fs.statSync(dirPath).isDirectory() && !detectedDirs.includes(dirPath)) {
          detectedDirs.push(dirPath);
        }
      } catch {}
    }
  };

  // 1. Detect from root package.json scripts
  const rootPkgPath = path.join(root, 'package.json');
  if (fs.existsSync(rootPkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
      for (const script of Object.values(pkg.scripts || {})) {
        if (typeof script !== 'string') continue;
        const matches = script.matchAll(/(?:cp\s+(?:-[a-zA-Z]+\s+)*|copy\s+)([^\s*]+)(?:\/\*)?\s+([^\s*]+)/g);
        for (const match of matches) {
          const srcPart = match[1];
          const dstPart = match[2];
          if (dstPart.includes(cleanPrefix) || srcPart.includes(cleanPrefix)) {
            addDir(path.resolve(root, srcPart));
          }
        }
      }
    } catch {}
  }

  // 2. Discover sub-projects in root that target this prefix via config files
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subName = entry.name;
      if (subName.startsWith('.') || subName === 'node_modules') continue;

      const subDirPath = path.join(root, subName);
      const configFiles = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'bun.config.js', 'bun.config.ts'];

      for (const cfgFile of configFiles) {
        const cfgPath = path.join(subDirPath, cfgFile);
        if (!fs.existsSync(cfgPath)) continue;

        try {
          const content = fs.readFileSync(cfgPath, 'utf8');
          const baseRegex = new RegExp(`base\\s*:\\s*['"]\\/??${cleanPrefix}\\/?['"]`);
          const matchesPrefix = subName === cleanPrefix || baseRegex.test(content);

          if (matchesPrefix) {
            const outDirMatch = content.match(/outDir\s*:\s*['"]([^'"]+)['"]/);
            if (outDirMatch && outDirMatch[1]) {
              addDir(path.resolve(subDirPath, outDirMatch[1]));
            }

            const subPkgPath = path.join(subDirPath, 'package.json');
            if (fs.existsSync(subPkgPath)) {
              try {
                const subPkg = JSON.parse(fs.readFileSync(subPkgPath, 'utf8'));
                for (const s of Object.values(subPkg.scripts || {})) {
                  if (typeof s !== 'string') continue;
                  const outMatch = s.match(/--outDir\s+([^\s]+)/);
                  if (outMatch && outMatch[1]) {
                    addDir(path.resolve(subDirPath, outMatch[1]));
                  }
                }
              } catch {}
            }

            addDir(path.join(subDirPath, 'dist'));
            addDir(subDirPath);
          }
        } catch {}
      }
    }
  } catch {}

  subAppBuildDirCache.set(cacheKey, detectedDirs);
  return detectedDirs;
}

// ─────────────── local rewrite handler ───────────────

function serveFile(
  filePath: string,
  { isPreview = false, isDev = false }: { isPreview?: boolean; isDev?: boolean } = {}
): Response {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || (Bun as any).file(filePath).type || 'application/octet-stream';
  const isHashedAsset = filePath.includes('/assets/');
  const cacheControl = isDev
    ? 'no-store, no-cache, must-revalidate, max-age=0'
    : isPreview && isHashedAsset
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': cacheControl,
  };
  if (isDev) {
    headers['Pragma'] = 'no-cache';
    headers['Expires'] = '0';
  }
  return new Response((Bun as any).file(filePath), { headers });
}

function handleLocalRewrite(
  pathname: string,
  url: URL,
  rewrites: LocalRewriteRule[],
  context: {
    root: string;
    srcDir: string;
    publicDir: string;
    outDir?: string;
    isDev?: boolean;
    isPreview?: boolean;
  }
): Response | null {
  if (!rewrites || rewrites.length === 0) return null;

  for (const rw of rewrites) {
    if (rw.prefix === '/' || !rw.prefix) continue;

    if (pathname === rw.prefix || pathname.startsWith(rw.prefix + '/')) {
      const { root, publicDir, outDir, isDev, isPreview } = context;

      // Exact prefix without trailing slash → redirect to trailing slash
      if (pathname === rw.prefix) {
        return new Response(null, {
          status: 302,
          headers: { Location: `${rw.prefix}/${url.search}` },
        });
      }

      const directCandidates: string[] = [];
      if (outDir) directCandidates.push(path.join(outDir, pathname));
      directCandidates.push(path.join(publicDir, pathname));
      directCandidates.push(path.join(root, pathname));

      const detectedBuildDirs = detectSubAppBuildDirs(root, rw.prefix);
      const subPath = pathname.slice(rw.prefix.length);
      for (const bDir of detectedBuildDirs) {
        directCandidates.push(path.join(bDir, subPath));
        directCandidates.push(path.join(bDir, pathname));
      }

      for (const candidate of directCandidates) {
        if (fs.existsSync(candidate)) {
          try {
            if (!fs.statSync(candidate).isDirectory()) {
              return serveFile(candidate, isDev ? { isDev: true } : { isPreview: true });
            }
          } catch {}
        }
      }

      // SPA fallback: serve the target HTML file
      const htmlCandidates: string[] = [];
      if (outDir) {
        htmlCandidates.push(path.join(outDir, rw.to));
        const cleanPrefix = rw.prefix.replace(/^\/+|\/+$/g, '');
        if (cleanPrefix) htmlCandidates.push(path.join(outDir, cleanPrefix, 'index.html'));
      }
      htmlCandidates.push(path.join(publicDir, rw.to));
      htmlCandidates.push(path.join(root, rw.to));

      for (const bDir of detectedBuildDirs) {
        htmlCandidates.push(path.join(bDir, 'index.html'));
        htmlCandidates.push(path.join(bDir, rw.to));
      }

      for (const htmlFile of htmlCandidates) {
        if (fs.existsSync(htmlFile)) {
          try {
            return serveFile(htmlFile, isDev ? { isDev: true } : { isPreview: true });
          } catch {}
        }
      }
    }
  }

  return null;
}

// ─────────────── plugin ───────────────

/**
 * Proxy redirects plugin.
 *
 * Responsibilities (all self-contained):
 *  - Reads `redirects.template` and populates `config.server.proxy` + `config.server.rewrites`
 *  - Handles SPA local rewrites (sub-app detection, static file serving) via the `serverRequest` hook
 *  - Writes deployment redirect files (Netlify / Vercel / Nginx) via the `buildComplete` hook
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
  /** Local rewrite rules resolved during configBun — reused in serverRequest */
  let localRewrites: LocalRewriteRule[] = [];

  return {
    name: 'bav:proxy-redirects',

    configBun(ctx: PluginContext) {
      ctx.config.server = ctx.config.server || {};
      ctx.config.server.proxy = ctx.config.server.proxy || {};

      // 1. Merge any statically-provided proxy entries
      if (proxy && typeof proxy === 'object') {
        Object.assign(ctx.config.server.proxy, proxy);
      }

      // 2. Load template
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

      // 3. Build active env map
      const mergedEnv = { ...process.env, ...envMap } as Record<string, string>;
      const allVars = [...new Set(getLines(template).flatMap(extractVars))];
      activeEnvMap = Object.fromEntries(allVars.map(k => [k, mergedEnv[k]]).filter(([, v]) => !!v));

      // 4. Parse template lines → proxy entries or local rewrites
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
            const rewriteRule: LocalRewriteRule = { from, to: resolved, prefix: route, status: 200 };
            ctx.config.server.rewrites = ctx.config.server.rewrites || [];
            ctx.config.server.rewrites.push(rewriteRule);
            localRewrites.push(rewriteRule);
          }
        }
      }
    },

    /**
     * Handles local SPA rewrites (sub-app routing) in both dev and preview.
     * This is the serverRequest hook — it owns all the local rewrite / sub-app detection logic.
     */
    serverRequest(req: Request, ctx: ServerRequestContext): Response | null {
      const rewrites: LocalRewriteRule[] = localRewrites;
      if (!rewrites || rewrites.length === 0) return null;

      const url = new URL(req.url);
      const pathname = url.pathname;

      return handleLocalRewrite(pathname, url, rewrites, {
        root: ctx.root,
        srcDir: ctx.srcDir,
        publicDir: ctx.publicDir || path.join(ctx.root, 'public'),
        outDir: ctx.outDir,
        isDev: ctx.mode === 'dev',
        isPreview: ctx.mode === 'preview',
      });
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
            logBox(`Unknown deploy platform: ${platform}. Set DEPLOY_PLATFORM=netlify|vercel|nginx`, 'warn');
            return;
          }
          logBox(successMessage, 'success');
        } catch (e: any) {
          logBox(`Failed writing redirects: ${e.message}`, 'error');
        }
      }
    },
  };
}

export default proxyRedirectsPlugin;
