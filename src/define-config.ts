import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import type { BunPlugin } from 'bun';
import { MIME_TYPES } from './utils/mime';
import { resolveStaticAsset } from './utils/assets';
import { handleProxyRequest, logProxyRules, parseServerProxy } from './utils/proxy';
import { logBox, logStep, colors } from './utils/logger';
import { bunAsVite } from './plugins/bun-plugin';
import { createBunConfig } from './plugins/shims';
import type {
  BunConfig,
  BavPlugin,
  UserConfig,
  ConfigFactory,
  CLIOptions,
  ResolvedConfig,
  PluginContext,
  BunAsViteConfigResult,
} from './types';

// ─── file extension sets ──────────────────────────────────────────────────────

const CSS_EXTS = new Set(['.css', '.scss', '.sass', '.less']);
const WATCH_EXTS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.json',
  '.css',
  '.html',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
]);

// ─── plugin hook runners ──────────────────────────────────────────────────────

async function runConfigHooks(plugins: BavPlugin[], env: Omit<PluginContext, 'config'>): Promise<BunConfig> {
  const config = createBunConfig();
  for (const plugin of plugins) {
    if (!plugin || typeof plugin !== 'object') continue;
    if (typeof plugin.configBun !== 'function') continue;
    try {
      await plugin.configBun({ config, ...env });
    } catch (err: any) {
      logBox(`Plugin "${plugin.name}" configBun hook failed: ${err.message}`, 'error');
    }
  }
  return config;
}

async function runCssTransformHooks(
  plugins: BavPlugin[],
  rawCss: string,
  filePath: string,
  root: string
): Promise<string> {
  let css = rawCss;
  for (const plugin of plugins) {
    if (!plugin || typeof plugin.cssTransform !== 'function') continue;
    try {
      const result = await plugin.cssTransform(css, filePath, root);
      if (typeof result === 'string') css = result;
    } catch (err: any) {
      logBox(`Plugin "${plugin.name}" cssTransform failed (${filePath}): ${err.message}`, 'error');
    }
  }
  return css;
}

/**
 * Phase 1 — reorganisation hooks: only plugins whose name starts with 'bav:code-split'.
 * These must run before the file table is printed so files are in their final j/c/a locations.
 */
async function runReorgHooks(
  plugins: BavPlugin[],
  result: any,
  ctx: { outputs: any[]; elapsedMs: number; mode: string; outDir: string }
): Promise<void> {
  for (const plugin of plugins) {
    if (!plugin || typeof plugin.buildComplete !== 'function') continue;
    if (!plugin.name?.startsWith('bav:code-split')) continue;
    try {
      await plugin.buildComplete(result, ctx);
    } catch (err: any) {
      logBox(`Plugin "${plugin.name}" buildComplete (reorg) failed: ${err.message}`, 'error');
    }
  }
}

/**
 * Phase 2 — display hooks: all plugins except bav:code-split.
 * These run after the file table so build-scorer and others appear below the file listing.
 */
async function runDisplayHooks(
  plugins: BavPlugin[],
  result: any,
  ctx: { outputs: any[]; elapsedMs: number; mode: string; outDir: string }
): Promise<void> {
  for (const plugin of plugins) {
    if (!plugin || typeof plugin.buildComplete !== 'function') continue;
    if (plugin.name?.startsWith('bav:code-split')) continue;
    try {
      await plugin.buildComplete(result, ctx);
    } catch (err: any) {
      logBox(`Plugin "${plugin.name}" buildComplete hook failed: ${err.message}`, 'error');
    }
  }
}

async function runServerRequestHooks(
  plugins: BavPlugin[],
  req: Request,
  ctx: { mode: 'dev' | 'preview'; srcDir: string; root: string; outDir?: string; publicDir?: string }
): Promise<Response | null> {
  for (const plugin of plugins) {
    if (!plugin || typeof plugin.serverRequest !== 'function') continue;
    try {
      const res = await plugin.serverRequest(req, ctx);
      if (res instanceof Response) return res;
    } catch (err: any) {
      logBox(`Plugin "${plugin.name}" serverRequest hook failed: ${err.message}`, 'error');
    }
  }
  return null;
}

// ─── env helpers ──────────────────────────────────────────────────────────────

function loadEnvFile(root: string, mode: string = 'development'): Record<string, string> {
  const envFiles = [
    path.join(root, `.env.${mode}.local`),
    path.join(root, `.env.${mode}`),
    path.join(root, '.env.local'),
    path.join(root, '.env'),
  ];
  const env: Record<string, string> = {};
  for (const file of envFiles) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      env[key] = val;
    }
  }
  return env;
}

function buildDefineMap(
  envVars: Record<string, string>,
  mode: string,
  buildTimeUnix: string,
  userDefine: Record<string, any> = {}
): Record<string, string> {
  const isProd = mode === 'production';
  const define: Record<string, string> = {
    global: 'globalThis',
    'import.meta.env.PROD': isProd ? 'true' : 'false',
    'import.meta.env.DEV': isProd ? 'false' : 'true',
    'import.meta.env.MODE': JSON.stringify(mode),
    'import.meta.env.VITE_APP_BUILD_TIME': JSON.stringify(buildTimeUnix),
    'import.meta.env.VITE_APP_ENV': JSON.stringify(isProd ? 'production' : 'development'),
    'import.meta.env.BASE_URL': '"/"',
  };
  for (const [key, val] of Object.entries(envVars)) {
    if (key.startsWith('VITE_') || key.startsWith('BASE_')) {
      define[`import.meta.env.${key}`] = JSON.stringify(val);
    }
  }
  for (const [key, val] of Object.entries(userDefine)) {
    define[key] = typeof val === 'string' ? val : JSON.stringify(val);
  }
  return define;
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function transformIndexHtml(
  html: string,
  { entryJs, buildTimeUnix, mode }: { entryJs: string; buildTimeUnix: string; mode: string }
): string {
  const isProd = mode === 'production';
  if (entryJs) {
    html = html.replace(
      /<script type="module" src="\/src\/index\.(jsx|tsx|js|ts)"><\/script>/,
      `<script type="module" src="${entryJs}"></script>`
    );
  }
  html = html
    .replace(/window\.xfebt = import\.meta\.env\.VITE_APP_BUILD_TIME;/, `window.xfebt = ${JSON.stringify(buildTimeUnix)};`)
    .replace(
      /window\.xapenv = import\.meta\.env;/,
      `window.xapenv = { VITE_APP_BUILD_TIME: ${JSON.stringify(buildTimeUnix)}, VITE_APP_ENV: ${JSON.stringify(isProd ? 'production' : 'development')}, PROD: ${isProd}, DEV: ${!isProd}, MODE: ${JSON.stringify(mode)} };`
    )
    .replace(/window\.xrenv = import\.meta\.env\.VITE_APP_ENV;/, `window.xrenv = ${JSON.stringify(isProd ? 'production' : 'development')};`);
  return html;
}

function injectHmrClient(html: string): string {
  const snippet = `
  <script type="module">
    (function() {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          for (var i = 0; i < regs.length; i++) regs[i].unregister();
        }).catch(function() {});
      }

      window.__vite_plugin_react_preamble_installed__ = true;

      var wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var wsUrl = wsProtocol + '//' + location.host + '/__bav_hmr';
      var socket = null;
      var reconnectTimer = null;

      function connect() {
        try {
          socket = new WebSocket(wsUrl);
          socket.onopen = function() {
            if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
          };
          socket.onmessage = function(event) {
            try {
              var payload = JSON.parse(event.data);
              if (payload.type === 'full-reload') location.reload();
            } catch (e) {
              if (event.data === 'reload') location.reload();
            }
          };
          socket.onclose = function() {
            if (!reconnectTimer) reconnectTimer = setInterval(connect, 1500);
          };
        } catch (e) {
          if (!reconnectTimer) reconnectTimer = setInterval(connect, 1500);
        }
      }
      connect();

      try {
        var es = new EventSource('/__bav_reload');
        es.onmessage = function(e) {
          if (e.data === 'reload') location.reload();
        };
      } catch (e) {}
    })();
  </script>`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${snippet}\n</body>`);
  }
  return html + snippet;
}

// ─── static-file helpers ──────────────────────────────────────────────────────

function serveFile(filePath: string, { isPreview = false, isDev = false }: { isPreview?: boolean; isDev?: boolean } = {}): Response {
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

// ─── build / dev / preview runners ───────────────────────────────────────────

/**
 * Scans outDir recursively and prints a Vite-style file table:
 *   build/j/index-BK6Z54OP.js    31.75 kB │ gzip:  8.88 kB
 *
 * Gzip sizes are computed in parallel for speed.
 */
async function logBuildOutputs(outDir: string): Promise<void> {
  // ── 1. Collect all non-map files recursively ──────────────────────────────
  const filePaths: string[] = [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (path.extname(full).toLowerCase() !== '.map') {
          filePaths.push(full);
        }
      } catch {}
    }
  }
  walk(outDir);

  if (filePaths.length === 0) return;

  // ── 2. Read + gzip all files in parallel ──────────────────────────────────
  const gzipAsync = (buf: Buffer): Promise<number> =>
    new Promise((resolve) => {
      zlib.gzip(buf, { level: 9 }, (_, result) => resolve(result?.byteLength ?? 0));
    });

  const fileData = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        const raw   = fs.readFileSync(filePath);
        const bytes = raw.byteLength;
        const gzip  = await gzipAsync(raw);
        const rel   = path.relative(outDir, filePath).replace(/\\/g, '/');
        return { rel, bytes, gzip };
      } catch {
        return null;
      }
    })
  );

  const files = fileData.filter(Boolean) as Array<{ rel: string; bytes: number; gzip: number }>;

  // ── 3. Sort: JS → CSS → assets → HTML → rest (by size within each group) ──
  const order = (rel: string): number => {
    const ext = path.extname(rel).toLowerCase();
    if (ext === '.js' || ext === '.mjs') return 0;
    if (ext === '.css')                  return 1;
    if (['.png','.jpg','.jpeg','.svg','.gif','.webp','.ico','.avif',
         '.ttf','.woff','.woff2','.eot'].includes(ext)) return 2;
    if (ext === '.html')                 return 3;
    return 4;
  };
  files.sort((a, b) => {
    const od = order(a.rel) - order(b.rel);
    return od !== 0 ? od : a.bytes - b.bytes;
  });

  // ── 4. Format and print ───────────────────────────────────────────────────
  const fmt = (n: number): string => {
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${(n / 1024).toFixed(2)} kB`;
  };

  const nameCol = Math.max(...files.map(f => f.rel.length), 10);
  const sizeCol = Math.max(...files.map(f => fmt(f.bytes).length), 7);

  const extColor = (rel: string): ((s: string) => string) => {
    const ext = path.extname(rel).toLowerCase();
    if (ext === '.js' || ext === '.mjs') return colors.cyan;
    if (ext === '.css')  return colors.magenta;
    if (ext === '.html') return colors.green;
    return colors.yellow;
  };

  console.log();
  for (const f of files) {
    const nameStr = `build/${f.rel}`.padEnd(nameCol + 6);
    const sizeStr = fmt(f.bytes).padStart(sizeCol);
    const gzipStr = fmt(f.gzip).padStart(sizeCol);
    const colorFn = extColor(f.rel);
    console.log(
      `  ${colorFn(nameStr)}  ${colors.dim(sizeStr)} ${colors.dim('│')} gzip: ${colors.dim(gzipStr)}`
    );
  }
  console.log();
}

/**
 * Runs a production build using `Bun.build(...)`.
 *
 * Compiles JavaScript and TypeScript, executes plugin transforms, resolves aliases,
 * generates code-split chunks (if splitting is enabled), copies static public assets,
 * injects asset links into `index.html`, and reports build time and bundle statistics.
 *
 * @param resolvedConfig Fully resolved configuration object.
 * @returns Promise that resolves once the production build completes.
 */
export async function runBuild(resolvedConfig: ResolvedConfig): Promise<void> {
  const { root, srcDir, publicDir, outDir, minify, define, plugins, bunPlugin } = resolvedConfig;
  const t0 = Date.now();
  const buildTimeUnix = Math.floor(t0 / 1000).toString();

  logBox('[bun-as-vite:build] Starting production build with Bun…', 'info');

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  const envVars = loadEnvFile(root, 'production');
  const mainEntry = resolvedConfig.entrypoint || path.resolve(srcDir, 'index.jsx');
  const entrypoints = [mainEntry, ...(resolvedConfig.extraEntrypoints || [])];
  const sourcemapMode =
    resolvedConfig.rawConfig?.build?.sourcemap === true
      ? 'external'
      : (resolvedConfig.rawConfig?.build?.sourcemap as any) || 'none';

  // Derive publicPath: Bun prepends publicPath to the relative output path of chunks/assets.
  // Because chunk/entry naming already includes the directory (e.g. 'assets/...'),
  // publicPath must NOT duplicate that directory.
  // Vite defaults base to '/'. If the user supplies base, normalize with leading/trailing slash.
  const rawBase = resolvedConfig.rawConfig?.base;
  const normalizedBase = rawBase
    ? (rawBase.startsWith('/') ? rawBase : `/${rawBase}`).replace(/\/?$/, '/')
    : '/';
  const publicPath: string = resolvedConfig.extraBuildProps?.publicPath ?? normalizedBase;

  const buildResult = await (Bun as any).build({
    entrypoints,
    plugins: [
      bunPlugin,
      ...resolvedConfig.bunPlugins,
      ...(Array.isArray(resolvedConfig.extraBuildProps?.plugins) ? resolvedConfig.extraBuildProps.plugins : []),
    ],
    target: 'browser',
    outdir: outDir,
    minify,
    splitting: resolvedConfig.splitting ?? true,
    sourcemap: sourcemapMode,
    naming: resolvedConfig.naming,
    publicPath,
    define: buildDefineMap(envVars, 'production', buildTimeUnix, define),
    ...resolvedConfig.extraBuildProps,
  });

  if (!buildResult.success) {
    logBox('[bun-as-vite:build] Build failed:', 'error');
    for (const log of buildResult.logs) console.error(log);
    process.exit(1);
  }

  if (fs.existsSync(publicDir)) {
    fs.cpSync(publicDir, outDir, { recursive: true });
    logBox('[bun-as-vite:build] Copied public/ → build/', 'success');
  }

  const indexHtmlPath = path.resolve(root, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    let html = fs.readFileSync(indexHtmlPath, 'utf-8');
    const groupNames = new Set((resolvedConfig.codeSplitGroups || []).map((g) => g.name));

    // Find the real app entry-point:
    //  - must be kind === 'entry-point'
    //  - must NOT be a codeSplitGroup named chunk (groupNames check)
    //  - must NOT come from the temporary .bun-chunks virtual entry dir
    //  - hash suffix uses uppercase hex (e.g. BK6Z54OP) — regex must be case-insensitive
    const isGroupEntry = (o: any): boolean => {
      if (o.kind !== 'entry-point') return false;
      const base      = path.basename(o.path, path.extname(o.path));
      const cleanName = base.replace(/-[a-zA-Z0-9]+$/, ''); // case-insensitive hash strip
      if (groupNames.has(cleanName) || groupNames.has(base)) return true;
      // Virtual entries written to .bun-chunks/ are always group entries
      if (o.path.includes('.bun-chunks')) return true;
      // If the base name (without hash) exactly matches a group name
      if ([...groupNames].some(g => cleanName === g || base.startsWith(g + '-'))) return true;
      return false;
    };

    const ep =
      buildResult.outputs.find((o: any) => o.kind === 'entry-point' && !isGroupEntry(o)) ||
      buildResult.outputs.find((o: any) => o.kind === 'entry-point');

    const entryJs = ep ? '/' + path.relative(outDir, ep.path).replace(/\\/g, '/') : '/index.js';
    html = transformIndexHtml(html, { entryJs, buildTimeUnix, mode: 'production' });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');
    logBox(`[bun-as-vite:build] Generated build/index.html → entry: ${entryJs}`, 'success');
  }

  const elapsedMs = Date.now() - t0;
  const hookCtx = { outputs: buildResult.outputs, elapsedMs, mode: 'production', outDir };

  // Phase 1: reorganisation hooks (bav:code-split) — move files to j/c/a dirs
  await runReorgHooks(plugins, buildResult, hookCtx);

  // Phase 2: print file table (files are now in their final locations)
  await logBuildOutputs(outDir);

  // Phase 3: display hooks (build-scorer Quality Report, etc.) appear below file table
  await runDisplayHooks(plugins, buildResult, hookCtx);

  logBox(`[bun-as-vite:build] Built ${buildResult.outputs.length} outputs in ${elapsedMs}ms`, 'success');
  logStep('build', 'Output directory:', outDir);
}

function handlePortError(err: any, port: number | string, mode: 'dev' | 'preview'): never {
  if (
    err?.code === 'EADDRINUSE' ||
    String(err?.message || '').includes('EADDRINUSE') ||
    String(err?.message || '').toLowerCase().includes('is port') ||
    String(err?.message || '').toLowerCase().includes('in use')
  ) {
    logBox(`Port ${port} is already in use (EADDRINUSE).`, 'error');
    console.log(`\n  ${colors.yellow('💡 Suggestion:')}`);
    console.log(
      `     • Stop the process using port ${colors.cyan(String(port))}: ${colors.dim(`lsof -i :${port}`)} then ${colors.dim('kill -9 <PID>')}`
    );
    console.log(`     • Or run with another port: ${colors.dim(`--port ${Number(port) + 1}`)}\n`);
    process.exit(1);
  }
  logBox(`Failed to start ${mode} server: ${err?.message || err}`, 'error');
  process.exit(1);
}

function startBunServer(opts: any, mode: 'dev' | 'preview') {
  try {
    return (Bun as any).serve(opts);
  } catch (err: any) {
    handlePortError(err, opts.port, mode);
  }
}

/**
 * Runs a preview server using `Bun.serve(...)` to serve the production build output.
 *
 * Serves files from `outDir` (default `'build'`), handles client-side SPA routing,
 * forwards requests matching configured proxy rules, and executes `serverRequest` plugin hooks.
 *
 * @param resolvedConfig Fully resolved configuration object.
 * @returns Promise that resolves when the preview server starts listening.
 */
export async function runPreview(resolvedConfig: ResolvedConfig): Promise<void> {
  const { root, srcDir, publicDir, outDir, plugins } = resolvedConfig;
  const port = resolvedConfig.server?.port || resolvedConfig.port || 4545;
  const host = resolvedConfig.server?.host || resolvedConfig.host || '0.0.0.0';

  if (!fs.existsSync(outDir)) {
    logBox(`No build found at "${outDir}". Run build first.`, 'error');
    process.exit(1);
  }

  const proxyRules = resolvedConfig.proxyRules || [];
  const rewrites = resolvedConfig.rewrites || [];

  startBunServer({
    port,
    hostname: host,
    async fetch(req: Request) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // Plugin hooks — plugins like proxyRedirects own their own request handling
      const pluginRes = await runServerRequestHooks(plugins, req, {
        mode: 'preview',
        srcDir,
        root,
        outDir,
        publicDir,
      });
      if (pluginRes) return pluginRes;

      // Core proxy forwarding
      const proxyRes = await handleProxyRequest(req, proxyRules);
      if (proxyRes) return proxyRes;

      const direct = path.join(outDir, pathname);
      if (pathname !== '/' && fs.existsSync(direct)) {
        try {
          if (!fs.statSync(direct).isDirectory()) return serveFile(direct, { isPreview: true });
        } catch {}
      }

      // Resilient fallbacks for duplicate /assets/assets/ or direct /chunk- requests
      if (pathname.startsWith('/assets/assets/')) {
        const cleanDirect = path.join(outDir, pathname.replace(/^\/assets\/assets\//, '/assets/'));
        if (fs.existsSync(cleanDirect) && !fs.statSync(cleanDirect).isDirectory()) {
          return serveFile(cleanDirect, { isPreview: true });
        }
      }
      if (pathname.startsWith('/chunk-')) {
        const inAssets = path.join(outDir, 'assets', path.basename(pathname));
        if (fs.existsSync(inAssets) && !fs.statSync(inAssets).isDirectory()) {
          return serveFile(inAssets, { isPreview: true });
        }
      }

      const staticFallback = resolveStaticAsset(pathname, { root, srcDir, publicDir });
      if (staticFallback) return serveFile(staticFallback, { isPreview: true });

      // Static assets (.js, .css, images, etc.) that do not exist should return 404, not index.html
      const hasStaticExt = /\.(js|mjs|cjs|ts|tsx|jsx|css|json|wasm|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|otf|map|xlsx|pdf|txt)$/i.test(pathname);
      if (hasStaticExt) {
        return new Response('Not found', { status: 404 });
      }

      const indexHtml = path.join(outDir, 'index.html');
      if (fs.existsSync(indexHtml)) return serveFile(indexHtml, { isPreview: true });

      return new Response('Not found', { status: 404 });
    },
  }, 'preview');

  logProxyRules(proxyRules, rewrites);

  const explicitHost = host !== '0.0.0.0';

  console.log(`\n${colors.green('🚀  Bun Production Preview:')} ${colors.cyan(`http://localhost:${port}/`)}`);
  if (explicitHost) {
    logStep('preview', 'Serving:', outDir, '|', 'Host:', host);
  } else {
    logStep('preview', 'Serving:', outDir);
  }
}

/**
 * Runs the development server using `Bun.serve(...)` with fast rebuilds and live reload.
 *
 * Features:
 * - Live module rebundling on file changes in `src/` and `public/`.
 * - In-memory and fast file serving with WebSocket live-reload notification.
 * - HTTP and WebSocket proxy forwarding for backend API routes.
 * - Local SPA route rewrites and static asset streaming.
 *
 * @param resolvedConfig Fully resolved configuration object.
 * @returns Promise that resolves when the dev server starts listening.
 */
export async function runDev(resolvedConfig: ResolvedConfig): Promise<void> {
  const { root, srcDir, publicDir, outDir, define, plugins, bunPlugin } = resolvedConfig;
  const port = resolvedConfig.server?.port || resolvedConfig.port || 4545;
  const host = resolvedConfig.server?.host || resolvedConfig.host || '0.0.0.0';

  const devDir = path.resolve(root, '.bun-dev');
  const indexHtmlPath = path.resolve(root, 'index.html');
  const proxyRules = resolvedConfig.proxyRules || [];
  const rewrites = resolvedConfig.rewrites || [];

  let entryJs = '';
  let isBuilding = false;
  const reloadSubscribers = new Set<(msg: string) => void>();
  const wsClients = new Set<any>();

  function broadcast(payload: any) {
    const isString = typeof payload === 'string';
    const json = isString ? payload : JSON.stringify(payload);
    for (const ws of wsClients) {
      try {
        ws.send(json);
      } catch {
        wsClients.delete(ws);
      }
    }
    for (const send of reloadSubscribers) {
      try {
        send(isString ? payload : 'data: reload\n\n');
      } catch {
        reloadSubscribers.delete(send);
      }
    }
  }

  const mainEntry = resolvedConfig.entrypoint || path.resolve(srcDir, 'index.jsx');
  const entrypoints = [mainEntry, ...(resolvedConfig.extraEntrypoints || [])];

  async function rebuild() {
    if (isBuilding) return;
    isBuilding = true;
    const t0 = Date.now();
    const buildTimeUnix = Math.floor(t0 / 1000).toString();
    try {
      const rawBase = resolvedConfig.rawConfig?.base;
      const normalizedBase = rawBase
        ? (rawBase.startsWith('/') ? rawBase : `/${rawBase}`).replace(/\/?$/, '/')
        : '/';
      const devPublicPath: string = resolvedConfig.extraBuildProps?.publicPath ?? normalizedBase;

      const result = await (Bun as any).build({
        entrypoints,
        plugins: [
          bunPlugin,
          ...resolvedConfig.bunPlugins,
          ...(Array.isArray(resolvedConfig.extraBuildProps?.plugins) ? resolvedConfig.extraBuildProps.plugins : []),
        ],
        target: 'browser',
        sourcemap: 'inline',
        splitting: resolvedConfig.splitting ?? true,
        naming: resolvedConfig.naming,
        publicPath: devPublicPath,
        define: buildDefineMap(loadEnvFile(root, 'development'), 'development', buildTimeUnix, define),
        ...resolvedConfig.extraBuildProps,
        outdir: devDir,
      });

      if (result.success) {
        const groupNames = new Set((resolvedConfig.codeSplitGroups || []).map((g: any) => g.name));
        const isGroupEntry = (o: any): boolean => {
          if (o.kind !== 'entry-point') return false;
          const base      = path.basename(o.path, path.extname(o.path));
          const cleanName = base.replace(/-[a-zA-Z0-9]+$/, ''); // case-insensitive hash strip
          if (groupNames.has(cleanName) || groupNames.has(base)) return true;
          if (o.path.includes('.bun-chunks')) return true;
          if ([...groupNames].some((g: string) => cleanName === g || base.startsWith(g + '-'))) return true;
          return false;
        };
        const ep =
          result.outputs.find((o: any) => o.kind === 'entry-point' && !isGroupEntry(o)) ||
          result.outputs.find((o: any) => o.kind === 'entry-point');
        if (ep) entryJs = '/' + path.relative(devDir, ep.path);
        logBox(`[bun-as-vite:dev] Rebuilt (${entryJs}) in ${Date.now() - t0}ms`, 'success');
        broadcast('data: reload\n\n');
      } else {
        logBox('[bun-as-vite:dev] Build failed:', 'error');
        for (const log of result.logs) console.error(log);
      }
    } catch (err: any) {
      logBox(`[bun-as-vite:dev] Build error: ${err.message || err}`, 'error');
    } finally {
      isBuilding = false;
      if (initialBuildResolve) {
        initialBuildResolve();
        initialBuildResolve = null;
      }
    }
  }

  let initialBuildResolve: (() => void) | null = null;
  const initialBuildPromise = new Promise<void>((resolve) => {
    initialBuildResolve = resolve;
  });

  function getIndexHtml(): string {
    const buildTimeUnix = Math.floor(Date.now() / 1000).toString();
    let html = fs.readFileSync(indexHtmlPath, 'utf-8');
    html = transformIndexHtml(html, { entryJs, buildTimeUnix, mode: 'development' });
    html = injectHmrClient(html);
    return html;
  }

  startBunServer({
    port,
    hostname: host,
    async fetch(req: Request, server: any) {
      if (initialBuildResolve) await initialBuildPromise;

      const url = new URL(req.url);
      const pathname = url.pathname;

      if (pathname === '/__bav_hmr' || (req.headers.get('upgrade') || '').toLowerCase() === 'websocket') {
        const upgraded = server.upgrade(req);
        if (upgraded) return undefined;
      }

      if (pathname === '/__bav_reload') {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();
        const send = (msg: string) => writer.write(encoder.encode(msg)).catch(() => {});
        reloadSubscribers.add(send);
        send('data: connected\n\n');
        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      }

      if (pathname === '/' || pathname === '/index.html') {
        return new Response(getIndexHtml(), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            Pragma: 'no-cache',
            Expires: '0',
          },
        });
      }

      // Plugin hooks — plugins own their specific request handling
      const pluginRes = await runServerRequestHooks(plugins, req, {
        mode: 'dev',
        srcDir,
        root,
        publicDir,
      });
      if (pluginRes) return pluginRes;

      // Core proxy forwarding
      const proxyRes = await handleProxyRequest(req, proxyRules);
      if (proxyRes) return proxyRes;

      // Dev bundle assets: /assets/..., /chunk-..., or duplicate /assets/assets/
      if (pathname.startsWith('/assets/') || pathname.startsWith('/chunk-')) {
        const cleanPathname = pathname.replace(/^\/assets\/assets\//, '/assets/');
        const devFile = path.join(devDir, cleanPathname);
        if (fs.existsSync(devFile) && !fs.statSync(devFile).isDirectory()) {
          return serveFile(devFile, { isDev: true });
        }
        const basename = path.basename(pathname);
        const inAssets = path.join(devDir, 'assets', basename);
        if (fs.existsSync(inAssets) && !fs.statSync(inAssets).isDirectory()) {
          return serveFile(inAssets, { isDev: true });
        }
        const directInDev = path.join(devDir, basename);
        if (fs.existsSync(directInDev) && !fs.statSync(directInDev).isDirectory()) {
          return serveFile(directInDev, { isDev: true });
        }
      }

      const publicFile = path.join(publicDir, pathname);
      if (pathname !== '/' && pathname !== '/index.html' && fs.existsSync(publicFile)) {
        try {
          if (!fs.statSync(publicFile).isDirectory()) return serveFile(publicFile, { isDev: true });
        } catch {}
      }

      if (pathname.startsWith('/src/')) {
        const srcFile = path.join(root, pathname);
        if (fs.existsSync(srcFile) && !fs.statSync(srcFile).isDirectory()) {
          return serveFile(srcFile, { isDev: true });
        }
      }

      if (pathname !== '/index.html') {
        const staticFile = resolveStaticAsset(pathname, { root, srcDir, publicDir });
        if (staticFile && staticFile !== indexHtmlPath) {
          return serveFile(staticFile, { isDev: true });
        }
      }

      // Fallback check directly in devDir
      const anyDevFile = path.join(devDir, pathname);
      if (fs.existsSync(anyDevFile) && !fs.statSync(anyDevFile).isDirectory()) {
        return serveFile(anyDevFile, { isDev: true });
      }

      // SPA Fallback: only HTML / extensionless navigation routes should receive index.html.
      // Static assets that were not found must return 404 to avoid MIME type errors in browsers.
      const hasStaticExt = /\.(js|mjs|cjs|ts|tsx|jsx|css|json|wasm|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|otf|map|xlsx|pdf|txt)$/i.test(pathname);
      if (hasStaticExt) {
        return new Response(`Not found: ${pathname}`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      return new Response(getIndexHtml(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
        },
      });
    },
    websocket: {
      open(ws: any) {
        wsClients.add(ws);
        ws.send(JSON.stringify({ type: 'connected' }));
      },
      message(ws: any, msg: any) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        } catch {}
      },
      close(ws: any) {
        wsClients.delete(ws);
      },
    },
  }, 'dev');

  // Once server port is acquired without error, proceed with dev setup
  if (fs.existsSync(devDir)) fs.rmSync(devDir, { recursive: true, force: true });
  fs.mkdirSync(devDir, { recursive: true });

  logProxyRules(proxyRules, rewrites);

  await rebuild();

  let debounce: any = null;
  const trigger = (_event: string, filename?: string) => {
    if (!filename) {
      clearTimeout(debounce);
      debounce = setTimeout(() => rebuild(), 150);
      return;
    }
    const base = path.basename(filename);
    if (base.startsWith('.') || base.startsWith('~') || base.endsWith('.tmp') || base.endsWith('~')) return;
    const ext = path.extname(filename).toLowerCase();
    if (ext && !WATCH_EXTS.has(ext)) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => rebuild(), 150);
  };

  try {
    fs.watch(srcDir, { recursive: true }, trigger as any);
  } catch (err: any) {
    logBox(`[bun-as-vite:dev] Could not watch srcDir recursively: ${err.message}`, 'warn');
  }

  const explicitHost = host !== '0.0.0.0';

  console.log(`\n${colors.green('🚀  Bun Dev Server:')} ${colors.cyan(`http://localhost:${port}/`)}`);
  if (explicitHost) {
    logStep('dev', 'Host:', host, '|', 'HMR: WebSocket enabled');
  } else {
    logStep('dev', 'HMR: WebSocket enabled');
  }
}

// ─── defineConfig ─────────────────────────────────────────────────────────────

/**
 * Defines the application configuration with full Vite compatibility, native Bun execution,
 * and plugin lifecycle integration.
 *
 * Accepts either a configuration object or a factory function receiving `{ mode, command }`.
 * Returns an object with `.run()`, `.resolve()`, and `.getRawConfig()` methods.
 *
 * @param configOrFactory User configuration object or factory function.
 * @returns Config runner and resolver object with `run`, `resolve`, and `getRawConfig` methods.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'bun-as-vite';
 * import react from '@vitejs/plugin-react';
 *
 * export default defineConfig({
 *   plugins: [react()],
 *   server: {
 *     port: 3000,
 *     proxy: {
 *       '/api': 'http://localhost:8080',
 *     },
 *   },
 * });
 * ```
 */
export function defineConfig(configOrFactory: ConfigFactory | UserConfig): BunAsViteConfigResult {
  function getRawConfig(env: { mode: string; command: string } = { mode: 'development', command: 'serve' }): UserConfig {
    return typeof configOrFactory === 'function' ? (configOrFactory as any)(env) || {} : configOrFactory || {};
  }

  async function resolve(cliOpts: CLIOptions = {}): Promise<ResolvedConfig> {
    const mode = cliOpts.mode === 'build' ? 'production' : 'development';
    const command = cliOpts.mode === 'build' ? 'build' : 'serve';

    const rawConfig = getRawConfig({ mode, command });
    const root = path.resolve(rawConfig.root || process.cwd());
    const srcDir = path.resolve(root, 'src');
    const publicDir = path.resolve(root, rawConfig.publicDir || 'public');
    const outDir = path.resolve(root, rawConfig.build?.outDir || 'build');

    // Collect BAV-aware plugins (those implementing at least one lifecycle hook)
    const BAV_HOOKS = ['configBun', 'cssTransform', 'buildComplete', 'serverRequest'];
    const allPlugins = (rawConfig.plugins || []).flat(Infinity).filter(Boolean);
    const plugins = allPlugins.filter((p: any) => BAV_HOOKS.some((h) => typeof p[h] === 'function'));

    // Run configBun hooks — each plugin mutates the shared BunConfig
    const userDefine = rawConfig.define || {};
    const bunConfig = await runConfigHooks(plugins, { root, srcDir, publicDir, mode, command });

    // Build CSS transform pipeline from config chain + plugin hooks
    const hasCssTransforms =
      bunConfig.cssTransformChain.length > 0 || plugins.some((p: any) => typeof p.cssTransform === 'function');

    const cssTransform = hasCssTransforms
      ? async (rawCss: string, filePath: string) => {
          let css = rawCss;
          for (const fn of bunConfig.cssTransformChain) {
            try {
              const out = await fn(css, filePath, root);
              if (typeof out === 'string') css = out;
            } catch (err: any) {
              logBox(`cssTransformChain error: ${err.message}`, 'error');
            }
          }
          return runCssTransformHooks(plugins, css, filePath, root);
        }
      : null;

    // Merge alias: user-defined aliases take precedence; plugins can add extras via config.alias
    const userAlias: Record<string, string> = {};
    if (rawConfig.resolve?.alias) {
      if (Array.isArray(rawConfig.resolve.alias)) {
        for (const item of rawConfig.resolve.alias) {
          if (item && (item as any).find) userAlias[(item as any).find] = (item as any).replacement;
        }
      } else if (typeof rawConfig.resolve.alias === 'object') {
        Object.assign(userAlias, rawConfig.resolve.alias);
      }
    }
    const mergedAlias = {
      ...userAlias,
      ...(bunConfig.alias || {}),
    };

    // Create the core Bun resolver/CSS-injection plugin
    const bunPlugin = bunAsVite({
      root,
      srcDir,
      publicDir,
      alias: mergedAlias,
      autoMapSrcFolders: bunConfig.autoMapSrcFolders,
      injectCss: bunConfig.injectCss,
      cssTransform,
    });

    // Resolve server config: Vite-style server.proxy → internal ProxyRule[]
    const rawServer = rawConfig.server || {};
    const server = {
      port: cliOpts.port || Number(process.env.PORT) || rawServer.port || 4545,
      host: cliOpts.host || process.env.HOST || rawServer.host || '0.0.0.0',
      proxy: {
        // Plugin-contributed proxy rules come first, user config overrides
        ...(bunConfig.server?.proxy || {}),
        ...(rawServer.proxy || {}),
      },
    };

    if (cliOpts.proxy) {
      server.proxy['/api'] = { target: cliOpts.proxy, changeOrigin: true };
    }

    const proxyRules = parseServerProxy(server.proxy);

    // Collect local rewrites contributed by plugins (e.g. proxyRedirects)
    const rewrites = bunConfig.server?.rewrites || [];

    // Translate Vite-only build keys and top-level extras into Bun.build() props
    const VITE_CORE_KEYS = new Set([
      'root', 'base', 'mode', 'define', 'publicDir', 'envDir', 'envPrefix',
      'server', 'build', 'preview', 'plugins', 'resolve', 'css', 'json',
      'esbuild', 'assetsInclude', 'logLevel', 'clearScreen', 'appType',
    ]);

    const VITE_BUILD_KEYS = new Set([
      'outDir', 'assetsDir', 'assetsInlineLimit', 'cssCodeSplit', 'cssTarget',
      'cssMinify', 'rollupOptions', 'commonjsOptions', 'dynamicImportVarsOptions',
      'lib', 'manifest', 'ssrManifest', 'ssr', 'write', 'emptyOutDir',
      'copyPublicDir', 'reportCompressedSize', 'chunkSizeWarningLimit', 'watch',
    ]);

    const rawBuild = rawConfig.build || {};
    const buildExtra: Record<string, any> = {};
    for (const [key, val] of Object.entries(rawBuild)) {
      if (!VITE_BUILD_KEYS.has(key)) {
        buildExtra[key] = val;
      }
    }

    const topLevelExtra: Record<string, any> = {};
    for (const [key, val] of Object.entries(rawConfig)) {
      if (!VITE_CORE_KEYS.has(key) && key !== 'bun' && key !== 'bunBuild') {
        topLevelExtra[key] = val;
      }
    }

    const extraBuildProps = {
      ...(bunConfig.bunBuild || {}),
      ...topLevelExtra,
      ...buildExtra,
      ...(rawConfig.bun || {}),
      ...(rawConfig.bunBuild || {}),
    };

    return {
      root,
      srcDir,
      publicDir,
      outDir,
      port: server.port,
      host: server.host,
      server,
      proxyRules,
      rewrites,
      minify: cliOpts.minify ?? true,
      define: userDefine,
      plugins,
      bunPlugin,
      bunPlugins: bunConfig.bunPlugins || [],
      splitting: bunConfig.splitting,
      naming: bunConfig.naming,
      entrypoint: bunConfig.entrypoint,
      extraEntrypoints: bunConfig.extraEntrypoints || [],
      codeSplitGroups: bunConfig.codeSplitGroups || [],
      extraBuildProps,
      rawConfig,
    };
  }

  async function run(cliOpts?: CLIOptions) {
    let opts: CLIOptions = cliOpts || {};
    if (!cliOpts || Object.keys(cliOpts).length === 0) {
      const { parseCLIArgs, printHelp } = await import('./utils/cli-args');
      const parsed = parseCLIArgs();
      if (parsed.help) {
        printHelp();
        process.exit(0);
      }
      opts = parsed;
    }

    const resolved = await resolve(opts);
    switch (opts.mode) {
      case 'build':
        return runBuild(resolved);
      case 'preview':
        return runPreview(resolved);
      default:
        return runDev(resolved);
    }
  }

  return { run, resolve, getRawConfig };
}

export default defineConfig;
