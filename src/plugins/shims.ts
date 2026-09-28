import path from 'path';
import fs from 'fs';
import type { BunConfig, BavPlugin, CodeSplitGroup, PluginContext, BuildCompleteContext } from '../types';

/**
 * Creates the mutable BunConfig object passed to every `configBun` hook.
 */
export function createBunConfig(): BunConfig {
  return {
    alias: {},
    autoMapSrcFolders: true,
    injectCss: true,
    cssTransformChain: [],
    server: {
      proxy: {},
    },
    entrypoint: null,
    extraEntrypoints: [],
    codeSplitGroups: [],
    splitting: true,
    sourcemap: { dev: 'inline', prod: 'external' },
    naming: {
      entry: 'assets/[name]-[hash].[ext]',
      chunk: 'assets/chunk-[name]-[hash].[ext]',
      asset: 'assets/[name]-[hash].[ext]',
    },
    enableBuildScorer: false,
    bunPlugins: [],
    bunBuild: {},
  };
}

/**
 * Tailwind CSS v4 plugin.
 */
export function tailwindcss(_options: Record<string, any> = {}): BavPlugin {
  let _compile: any = null;
  let _Scanner: any = null;
  let _cache: any = null;
  let _lastBuild = 0;

  return {
    name: 'bav:tailwindcss',

    async configBun(ctx: PluginContext) {
      try {
        // @ts-ignore
        const m1: any = await import('@tailwindcss/node');
        // @ts-ignore
        const m2: any = await import('@tailwindcss/oxide');
        _compile = m1.compile;
        _Scanner = m2.Scanner;
      } catch {
        return;
      }

      const { srcDir, root } = ctx;

      ctx.config.cssTransformChain.push(async (rawCss: string, filePath: string) => {
        if (!filePath.endsWith('globals.css')) return null;

        const now = Date.now();
        if (!_cache || now - _lastBuild > 2000) {
          try {
            const base = path.dirname(filePath);
            const compiler = await _compile(rawCss, { base, onDependency: () => {} });
            const scanner = new _Scanner({
              sources: [
                { base: srcDir, pattern: '**/*.{jsx,js,tsx,ts,html}', negated: false },
                { base: root, pattern: 'index.html', negated: false },
              ],
            });
            _cache = compiler.build(scanner.scan());
            _lastBuild = now;
          } catch (err: any) {
            console.error('[bav:tailwindcss] Compile error:', err.message);
            return rawCss;
          }
        }
        return _cache;
      });
    },
  };
}

function isGroupMatch(id: string, test: RegExp | string | ((id: string) => boolean)): boolean {
  if (typeof test === 'function') {
    try {
      return Boolean(test(id));
    } catch {
      return false;
    }
  }
  if (typeof test === 'string') return id.includes(test);
  if (test instanceof RegExp) return test.test(id);
  return false;
}

function canResolvePackage(pkgName: string, root: string): boolean {
  try {
    (Bun as any).resolveSync(pkgName, root);
    return true;
  } catch {
    try {
      require.resolve(pkgName, { paths: [root] });
      return true;
    } catch {
      return false;
    }
  }
}

function findMatchingPackagesForGroups(groups: CodeSplitGroup[], root: string): Map<string, string[]> {
  const nmPath = path.resolve(root, 'node_modules');
  const pkgPath = path.resolve(root, 'package.json');

  const candidatePackages = new Set<string>();
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      for (const d of Object.keys(pkg.dependencies || {})) candidatePackages.add(d);
      for (const d of Object.keys(pkg.devDependencies || {})) candidatePackages.add(d);
    } catch {}
  }

  if (fs.existsSync(nmPath)) {
    try {
      for (const entry of fs.readdirSync(nmPath)) {
        if (entry.startsWith('.')) continue;
        if (entry.startsWith('@')) {
          const scopePath = path.join(nmPath, entry);
          try {
            for (const sub of fs.readdirSync(scopePath)) {
              if (!sub.startsWith('.')) candidatePackages.add(`${entry}/${sub}`);
            }
          } catch {}
        } else {
          candidatePackages.add(entry);
        }
      }
    } catch {}
  }

  const assigned = new Set<string>();
  const groupMap = new Map<string, string[]>();

  for (const group of groups) {
    if (!group || !group.name || !group.test) continue;
    const matched: string[] = [];

    for (const pkgName of candidatePackages) {
      if (assigned.has(pkgName)) continue;

      const fakePaths = [
        path.join(nmPath, ...pkgName.split('/'), 'index.js'),
        path.join(nmPath, ...pkgName.split('/')),
        path.join('node_modules', ...pkgName.split('/')),
        pkgName,
      ];

      if (fakePaths.some((fp) => isGroupMatch(fp, group.test)) && canResolvePackage(pkgName, root)) {
        matched.push(pkgName);
        assigned.add(pkgName);
      }
    }

    if (matched.length > 0) {
      groupMap.set(group.name, matched);
    }
  }

  return groupMap;
}

export interface CodeSplitPluginOptions {
  groups?: CodeSplitGroup[];
  codeSplitting?: { groups?: CodeSplitGroup[] };
  jsDir?: string;
  cssDir?: string;
  assetDir?: string;
}

/**
 * Code-splitting plugin for Bun.build.
 */
export function codeSplitPlugin(options: CodeSplitPluginOptions = {}): BavPlugin {
  const groups = options.groups || options.codeSplitting?.groups || [];

  return {
    name: 'bav:code-split',

    async configBun(ctx: PluginContext) {
      ctx.config.splitting = true;
      if (groups.length === 0) return;

      ctx.config.codeSplitGroups = groups;

      if (options.jsDir || options.cssDir || options.assetDir) {
        const jsDir = (options.jsDir || 'assets').replace(/\/+$/, '');
        const assetDir = (options.assetDir || 'assets').replace(/\/+$/, '');
        ctx.config.naming = {
          entry: `${jsDir}/[name]-[hash].[ext]`,
          chunk: `${jsDir}/chunk-[name]-[hash].[ext]`,
          asset: `${assetDir}/[name]-[hash].[ext]`,
        };
      }

      const chunkDir = path.resolve(ctx.root, '.bun-chunks');
      if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });

      const groupMap = findMatchingPackagesForGroups(groups, ctx.root);
      const extraEntries: string[] = [];

      for (const [groupName, packages] of groupMap.entries()) {
        const chunkFile = path.join(chunkDir, `${groupName}.js`);
        const code = packages
          .map((pkg, idx) => `import * as _${idx} from ${JSON.stringify(pkg)};\nexport { _${idx} };`)
          .join('\n');
        fs.writeFileSync(chunkFile, code, 'utf8');
        extraEntries.push(chunkFile);
      }

      ctx.config.extraEntrypoints = extraEntries;
    },

    buildComplete(_result: any, ctx: BuildCompleteContext) {
      const chunkDir = path.resolve(ctx.outDir ? path.dirname(ctx.outDir) : process.cwd(), '.bun-chunks');
      if (fs.existsSync(chunkDir)) {
        try {
          fs.rmSync(chunkDir, { recursive: true, force: true });
        } catch {}
      }
    },
  };
}

export interface ProxyRedirectsPluginOptions {
  templateFile?: string;
  templateString?: string;
  proxy?: Record<string, any> | null;
  envMap?: Record<string, string>;
  ignoreBuild?: boolean;
}

/**
 * Proxy redirects plugin.
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

export interface CustomConfigPluginOptions {
  alias?: Record<string, string>;
  [key: string]: any;
}

/**
 * Custom config plugin.
 */
export function customConfigPlugin(options: CustomConfigPluginOptions = {}): BavPlugin {
  return {
    name: 'bav:custom-config',

    configBun(ctx: PluginContext) {
      Object.assign(ctx.config.alias, options.alias || {});
    },
  };
}

export interface EnvLoaderPluginOptions {
  prefixes?: string[];
}

/**
 * Env loader plugin.
 */
export function envLoaderPlugin(options: EnvLoaderPluginOptions = {}): BavPlugin {
  return {
    name: 'bav:env-loader',

    configBun(ctx: PluginContext) {
      const prefixes = options.prefixes || ['VITE_', 'BASE_'];
      ctx.config.envPrefixes = [...(ctx.config.envPrefixes || []), ...prefixes];
    },
  };
}

/**
 * Build scorer plugin.
 */
export function buildScorerPlugin(_options: Record<string, any> = {}): BavPlugin {
  return {
    name: 'bav:build-scorer',

    configBun(ctx: PluginContext) {
      ctx.config.enableBuildScorer = true;
    },

    buildComplete(_result: any, ctx: BuildCompleteContext) {
      const { outputs, elapsedMs } = ctx;
      let totalBytes = 0;
      let jsChunks = 0;
      const largeChunks: Array<{ name: string; kb: string }> = [];

      for (const out of outputs) {
        if (out.kind === 'sourcemap') continue;
        const size = out.size ?? 0;
        totalBytes += size;
        if (out.kind === 'chunk' || out.kind === 'entry-point') {
          jsChunks++;
          if (size > 800 * 1024) {
            largeChunks.push({
              name: out.path.split('/').pop() || out.path,
              kb: (size / 1024).toFixed(0),
            });
          }
        }
      }

      const mb = (totalBytes / (1024 * 1024)).toFixed(2);
      const [c, r, g, y, b] = ['\x1b[36m', '\x1b[0m', '\x1b[32m', '\x1b[33m', '\x1b[1m'];

      console.log(`\n${b}${c}  ── Build Quality Report ──────────────────────────────────────${r}`);
      console.log(`  ${g}✔${r}  ${b}Total bundle${r}: ${b}${mb} MB${r}  (${jsChunks} JS chunks, ${outputs.length} outputs)`);
      console.log(`  ${g}✔${r}  ${b}Build time${r}:   ${b}${elapsedMs}ms${r}`);
      if (largeChunks.length > 0) {
        console.log(`  ${y}⚠${r}  ${y}Oversized chunks (>800 KB):${r}`);
        for (const ch of largeChunks) console.log(`       ${y}→${r} ${ch.name} — ${ch.kb} KB`);
      } else {
        console.log(`  ${g}✔${r}  All chunks within the 800 KB budget`);
      }
      console.log(`${b}${c}  ──────────────────────────────────────────────────────────────${r}\n`);
    },
  };
}

/**
 * Wraps any arbitrary object as a bun-as-vite plugin.
 */
export function wrapPlugin(plugin: any): BavPlugin {
  if (!plugin || typeof plugin !== 'object') {
    throw new TypeError('[bun-as-vite] wrapPlugin: argument must be an object');
  }
  const hooks = ['configBun', 'cssTransform', 'buildComplete', 'serverRequest'];
  const forwarded: Record<string, any> = {};
  for (const h of hooks) {
    if (typeof plugin[h] === 'function') forwarded[h] = plugin[h].bind(plugin);
  }
  return { name: plugin.name || 'bav:wrapped-plugin', ...forwarded };
}
