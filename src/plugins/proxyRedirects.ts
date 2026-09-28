import path from 'path';
import fs from 'fs';
import type { BavPlugin, PluginContext } from '../types';

export interface ProxyRedirectsPluginOptions {
  templateFile?: string;
  templateString?: string;
  proxy?: Record<string, any> | null;
  envMap?: Record<string, string>;
  ignoreBuild?: boolean;
}

/**
 * Proxy redirects plugin.
 * Configures upstream proxies from Vite server.proxy or Netlify-style redirect templates.
 */
export function proxyRedirectsPlugin(options: ProxyRedirectsPluginOptions = {}): BavPlugin {
  const {
    templateFile = 'redirects.template',
    templateString = '',
    proxy = null,
    envMap = {},
  } = options;

  return {
    name: 'bav:proxy-redirects',

    configBun(ctx: PluginContext) {
      ctx.config.server = ctx.config.server || {};
      ctx.config.server.proxy = ctx.config.server.proxy || {};

      if (proxy && typeof proxy === 'object') {
        Object.assign(ctx.config.server.proxy, proxy);
      }

      let tpl = templateString;
      if (!tpl && templateFile) {
        const tplPath = path.resolve(ctx.root, templateFile);
        if (fs.existsSync(tplPath)) {
          tpl = fs.readFileSync(tplPath, 'utf8');
        }
      }

      if (tpl) {
        const mergedEnv = { ...process.env, ...envMap };
        for (const line of tpl.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const [from, raw] = trimmed.split(/\s+/);
          if (!from || !raw) continue;

          const resolved = raw.replace(/\{\{(.*?)\}\}/g, (_, k) => mergedEnv[k] || '');
          if (resolved.includes('{{')) continue;

          const cleanFrom = from.replace(/\*$/, '');
          const route = cleanFrom.length > 1 && cleanFrom.endsWith('/') ? cleanFrom.slice(0, -1) : cleanFrom;
          if (route === '/') continue;

          const target = resolved.match(/^https?:\/\/[^/]+/)?.[0] || '';
          const urlpart = resolved.slice(target.length);
          const pathPart = (urlpart.replace(/\*/g, '').replace(/:\w+$/, '') || '/').replace(/\/+$/, '');

          const proxyEntry: any = {
            target,
            changeOrigin: true,
            secure: false,
          };

          if (pathPart && pathPart !== route) {
            const pat = new RegExp(`^${route}(/|$)`);
            proxyEntry.rewrite = (p: string) => p.replace(pat, `${pathPart}$1`);
          }

          ctx.config.server.proxy[route] = proxyEntry;
        }
      }
    },
  };
}

export default proxyRedirectsPlugin;
