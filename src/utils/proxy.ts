import { HOP_BY_HOP_HEADERS } from './mime';

export interface ParsedRedirectRule {
  prefix: string;
  targetBase: string;
  pathPart: string;
  displayKey: string;
  displayTarget: string;
  changeOrigin: boolean;
  secure: boolean;
}

export interface ServerProxyRule {
  displayKey: string;
  displayTarget: string;
  prefix: string;
  isRegex: boolean;
  regex: RegExp | null;
  targetBase: string;
  pathPart: string;
  rewrite: ((path: string) => string) | null;
  headers: Record<string, string> | null;
  changeOrigin: boolean;
  secure: boolean;
  ws: boolean;
  rewriteWsOrigin: boolean;
  configure: ((proxy: any, options: any) => void) | null;
}

/**
 * Parses a redirects.template / Netlify _redirects file.
 */
export function parseRedirectsTemplate(
  templateContent: string,
  env: Record<string, any> | string = process.env
): ParsedRedirectRule[] {
  const rules: ParsedRedirectRule[] = [];
  for (const line of templateContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [from, to] = trimmed.split(/\s+/);
    if (!from || !to) continue;

    const fromPrefix = from.replace(/\*$/, '');
    const resolvedTo = to.replace(/\{\{(.*?)\}\}/g, (_, k) =>
      typeof env === 'string' ? env : (env as any)[k] || ''
    );
    if (resolvedTo.includes('{{')) continue;
    const targetBase = resolvedTo.match(/^(?:https?|wss?):\/\/[^/]+/)?.[0] || '';
    if (!targetBase) continue;
    const pathPart = resolvedTo.slice(targetBase.length).replace(/\*$/, '');

    rules.push({
      prefix: fromPrefix,
      targetBase,
      pathPart: pathPart || '',
      displayKey: from,
      displayTarget: resolvedTo,
      changeOrigin: true,
      secure: false,
    });
  }
  return rules;
}

/**
 * Parses standard Vite `server.proxy` configuration.
 */
export function parseServerProxy(serverProxy: Record<string, any>): ServerProxyRule[] {
  if (!serverProxy || typeof serverProxy !== 'object') return [];
  const rules: ServerProxyRule[] = [];

  for (const [key, val] of Object.entries(serverProxy)) {
    if (!val) continue;

    const isRegex = key.startsWith('^') || key.includes('.*') || key.includes('\\');
    const regex = isRegex ? new RegExp(key) : null;
    const prefix = isRegex ? '' : key;

    if (typeof val === 'string') {
      const targetBase = val.match(/^(?:https?|wss?):\/\/[^/]+/)?.[0] || val;
      const pathPart = val.slice(targetBase.length).replace(/\/+$/, '');
      rules.push({
        displayKey: key,
        displayTarget: val,
        prefix,
        isRegex,
        regex,
        targetBase,
        pathPart: pathPart || '',
        rewrite: null,
        headers: null,
        changeOrigin: true,
        secure: false,
        ws: false,
        rewriteWsOrigin: false,
        configure: null,
      });
    } else if (typeof val === 'object') {
      const target = val.target || '';
      const targetBase = target.match(/^(?:https?|wss?):\/\/[^/]+/)?.[0] || target;
      const pathPart = target.slice(targetBase.length).replace(/\/+$/, '');
      rules.push({
        displayKey: key,
        displayTarget: target,
        prefix,
        isRegex,
        regex,
        targetBase,
        pathPart: pathPart || '',
        rewrite: typeof val.rewrite === 'function' ? val.rewrite : null,
        headers: val.headers || null,
        changeOrigin: val.changeOrigin ?? true,
        secure: val.secure ?? false,
        ws: Boolean(val.ws),
        rewriteWsOrigin: Boolean(val.rewriteWsOrigin),
        configure: typeof val.configure === 'function' ? val.configure : null,
      });
    }
  }

  return rules;
}

/**
 * Builds clean proxy-forwarding headers.
 */
export function cleanProxyHeaders(
  rawHeaders: Headers,
  targetBase: string,
  changeOrigin: boolean = true
): Headers {
  const headers = new Headers();
  rawHeaders.forEach((val, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, val);
    }
  });
  if (changeOrigin && targetBase && targetBase.startsWith('http')) {
    try {
      headers.set('host', new URL(targetBase).host);
    } catch {}
  }
  return headers;
}

/**
 * Rewrites Set-Cookie headers from upstream for localhost compatibility.
 */
export function rewriteSetCookie(cookieStr: string): string {
  return cookieStr
    .replace(/Domain=[^;]+;?/gi, '')
    .replace(/Secure;?/gi, '')
    .replace(/SameSite=None;?/gi, 'SameSite=Lax;')
    .replace(/;\s*;/g, ';')
    .trim();
}

function formatTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: true });
}

function colorMethod(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return `\x1b[34m${method}\x1b[0m`;
    case 'POST':
      return `\x1b[32m${method}\x1b[0m`;
    case 'PUT':
      return `\x1b[33m${method}\x1b[0m`;
    case 'PATCH':
      return `\x1b[35m${method}\x1b[0m`;
    case 'DELETE':
      return `\x1b[31m${method}\x1b[0m`;
    case 'OPTIONS':
      return `\x1b[90m${method}\x1b[0m`;
    default:
      return `\x1b[37m${method}\x1b[0m`;
  }
}

function colorStatus(status: number, statusText: string = ''): string {
  const text = statusText ? `${status} ${statusText}` : `${status}`;
  if (status >= 200 && status < 300) return `\x1b[32m${text}\x1b[0m`;
  if (status >= 300 && status < 400) return `\x1b[36m${text}\x1b[0m`;
  if (status >= 400 && status < 500) return `\x1b[33m${text}\x1b[0m`;
  return `\x1b[31m${text}\x1b[0m`;
}

/**
 * Logs registered proxy rewrite rules.
 */
export function logProxyRules(rules: any[]): void {
  if (!rules || rules.length === 0) return;
  for (const rule of rules) {
    const from = rule.displayKey || rule.prefix || (rule.regex ? rule.regex.toString() : '');
    const to = rule.displayTarget || `${rule.targetBase}${rule.pathPart || ''}`;
    console.log(
      `  \x1b[36m↪\x1b[0m \x1b[90mproxy\x1b[0m \x1b[37m[REWRITE]\x1b[0m \x1b[36m${from}\x1b[0m \x1b[90m→\x1b[0m \x1b[35m${to}\x1b[0m`
    );
  }
  console.log(`\x1b[32m✔\x1b[0m  \x1b[32mDevelopment redirects loaded\x1b[0m\n`);
}

/**
 * Core proxy request handler.
 */
export async function handleProxyRequest(
  req: Request,
  proxyRules: any[]
): Promise<Response | null> {
  if (!proxyRules || proxyRules.length === 0) return null;

  const url = new URL(req.url);
  const pathname = url.pathname;

  for (const rule of proxyRules) {
    let isMatched = false;
    let isExact = false;
    let isChild = false;

    if (rule.isRegex && rule.regex) {
      if (rule.regex.test(pathname)) {
        isMatched = true;
      }
    } else if (rule.prefix) {
      const prefixWithoutSlash = rule.prefix.endsWith('/')
        ? rule.prefix.slice(0, -1)
        : rule.prefix;
      isExact = pathname === rule.prefix || pathname === prefixWithoutSlash;
      isChild = pathname.startsWith(rule.prefix.endsWith('/') ? rule.prefix : `${rule.prefix}/`);
      isMatched = isExact || isChild;
    }

    if (!isMatched) continue;

    let targetUrl: string;
    if (typeof rule.rewrite === 'function') {
      const rewrittenPath = rule.rewrite(pathname + url.search);
      const cleanTarget = rule.targetBase.replace(/\/+$/, '');
      targetUrl = rewrittenPath.startsWith('http')
        ? rewrittenPath
        : `${cleanTarget}${rewrittenPath.startsWith('/') ? rewrittenPath : '/' + rewrittenPath}`;
    } else if (isChild) {
      const cleanPrefix = rule.prefix.endsWith('/') ? rule.prefix : `${rule.prefix}/`;
      const subPath = pathname.slice(cleanPrefix.length);
      const basePart = rule.pathPart.endsWith('/')
        ? rule.pathPart
        : rule.pathPart
        ? `${rule.pathPart}/`
        : '/';
      targetUrl = `${rule.targetBase}${basePart}${subPath}${url.search}`;
    } else if (pathname.endsWith('/')) {
      targetUrl = `${rule.targetBase}${rule.pathPart || ''}${url.search}`;
    } else {
      targetUrl = `${rule.targetBase}${rule.pathPart.replace(/\/$/, '')}${url.search}`;
    }

    const time = formatTime();

    // ── OPTIONS preflight ──────────────────────────────────────────────────
    if (req.method === 'OPTIONS') {
      console.log(
        `\x1b[90m${time}\x1b[0m \x1b[36m[proxy]\x1b[0m ${colorMethod('OPTIONS')} \x1b[33m${pathname}${url.search}\x1b[0m \x1b[90m→\x1b[0m \x1b[90m${targetUrl}\x1b[0m : \x1b[32m204 No Content\x1b[0m \x1b[90m(0ms)\x1b[0m`
      );
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
          'Access-Control-Allow-Headers': req.headers.get('access-control-request-headers') || '*',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // ── Forward the request ────────────────────────────────────────────────
    const startTime = Date.now();
    const headers = cleanProxyHeaders(req.headers, rule.targetBase, rule.changeOrigin !== false);

    if (rule.headers) {
      for (const [k, v] of Object.entries(rule.headers)) {
        headers.set(k, String(v));
      }
    }

    let body: ArrayBuffer | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        const buf = await req.arrayBuffer();
        if (buf.byteLength > 0) body = buf;
      } catch {}
    }

    try {
      const res = await fetch(targetUrl, {
        method: req.method,
        headers,
        body,
        redirect: 'follow',
      });

      const elapsed = Date.now() - startTime;
      console.log(
        `\x1b[90m${time}\x1b[0m \x1b[36m[proxy]\x1b[0m ${colorMethod(req.method)} \x1b[33m${pathname}${url.search}\x1b[0m \x1b[90m→\x1b[0m \x1b[90m${targetUrl}\x1b[0m : ${colorStatus(res.status, res.statusText)} \x1b[90m(${elapsed}ms)\x1b[0m`
      );

      // ── Build clean response headers ───────────────────────────────────
      const responseHeaders = new Headers();
      res.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (
          lower === 'content-encoding' ||
          lower === 'content-length' ||
          lower === 'transfer-encoding' ||
          lower === 'connection' ||
          lower === 'keep-alive'
        ) {
          return;
        }

        if (lower === 'set-cookie') {
          responseHeaders.append('set-cookie', rewriteSetCookie(value));
        } else {
          responseHeaders.set(key, value);
        }
      });

      if (!responseHeaders.has('access-control-allow-origin')) {
        responseHeaders.set('access-control-allow-origin', req.headers.get('origin') || '*');
        responseHeaders.set('access-control-allow-credentials', 'true');
      }

      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
      });
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      console.error(
        `\x1b[90m${time}\x1b[0m \x1b[31m[proxy ERROR]\x1b[0m ${req.method} ${pathname} → ${targetUrl} (${elapsed}ms):`,
        err.message
      );
      return new Response(`[bun-as-vite proxy error] ${err.message}`, {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }

  return null;
}
