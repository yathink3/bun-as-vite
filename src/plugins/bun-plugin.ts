import path from 'path';
import fs from 'fs';
import type { BunPlugin } from 'bun';
import { rewriteCssUrls } from '../utils/assets';

const JS_EXTENSIONS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.json', '.css'];
const INDEX_EXTENSIONS = [
  '/index.js',
  '/index.jsx',
  '/index.ts',
  '/index.tsx',
  '/index.mjs',
  '/index.json',
];

function resolveWithExtensions(candidate: string): string | null {
  for (const ext of JS_EXTENSIONS) {
    const file = candidate + ext;
    if (fs.existsSync(file)) {
      try {
        if (!fs.statSync(file).isDirectory()) return file;
      } catch {}
    }
  }
  for (const ext of INDEX_EXTENSIONS) {
    const file = candidate + ext;
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function resolveAliasTarget(replacement: string, root: string): string {
  if (path.isAbsolute(replacement)) return replacement;
  if (replacement.startsWith('.') || replacement.startsWith('/')) {
    return path.resolve(root, replacement);
  }
  try {
    return (Bun as any).resolveSync(replacement, root);
  } catch {}
  return path.resolve(root, replacement);
}

function buildNormalizedAliases(aliasMap: Record<string, string>, root: string): Array<{ find: string; target: string }> {
  const result: Array<{ find: string; target: string }> = [];
  for (const [find, replacement] of Object.entries(aliasMap)) {
    const target = resolveAliasTarget(replacement, root);
    result.push({ find, target });
  }
  return result;
}

function discoverSrcFolders(srcDir: string): Set<string> {
  const set = new Set<string>();
  if (!fs.existsSync(srcDir)) return set;
  try {
    for (const d of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (d.isDirectory() && d.name !== '@') set.add(d.name);
    }
  } catch {}
  return set;
}

function readBaseUrl(root: string, srcDir: string): string | null {
  for (const configFile of ['tsconfig.json', 'jsconfig.json']) {
    const configPath = path.join(root, configFile);
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const stripped = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
        const json = JSON.parse(stripped);
        const baseUrl = json?.compilerOptions?.baseUrl;
        if (baseUrl) {
          return path.resolve(root, baseUrl);
        }
      } catch {}
    }
  }
  return srcDir;
}

export interface BunAsViteOptions {
  root?: string;
  srcDir?: string;
  publicDir?: string;
  alias?: Record<string, string>;
  autoMapSrcFolders?: boolean;
  injectCss?: boolean;
  cssTransform?: ((rawCss: string, filePath: string) => Promise<string | null> | string | null) | null;
}

/**
 * Creates the composable Bun plugin that handles Vite-compatible
 * module resolution, alias expansion, and CSS injection behaviour.
 */
export function bunAsVite(options: BunAsViteOptions = {}): BunPlugin {
  const root = path.resolve(options.root || process.cwd());
  const srcDir = path.resolve(options.srcDir || path.join(root, 'src'));
  const publicDir = path.resolve(options.publicDir || path.join(root, 'public'));
  const aliasMap = options.alias || {};
  const autoMapSrcFolders = options.autoMapSrcFolders ?? false;
  const injectCss = options.injectCss ?? true;
  const cssTransform = options.cssTransform || null;

  const normalizedAliases = buildNormalizedAliases(aliasMap, root);
  const srcFolders = autoMapSrcFolders ? discoverSrcFolders(srcDir) : new Set<string>();
  const baseUrlDir = readBaseUrl(root, srcDir);

  return {
    name: 'bun-as-vite',

    setup(build) {
      // ── React Compiler Runtime resolution (universal React 17 / 18 / 19 support) ──
      build.onResolve({ filter: /^(?:react\/compiler-runtime|react-compiler-runtime)$/ }, (args) => {
        // 1. In React 19: native 'react/compiler-runtime' exists
        try {
          return { path: (Bun as any).resolveSync('react/compiler-runtime', root) };
        } catch {}

        // 2. In React 17/18: 'react-compiler-runtime' standalone package
        try {
          return { path: (Bun as any).resolveSync('react-compiler-runtime', root) };
        } catch {}

        // 3. Fallback: virtual compiler-runtime shim if neither is present
        return { path: args.path, namespace: 'react-compiler-shim' };
      });

      build.onLoad({ filter: /.*/, namespace: 'react-compiler-shim' }, () => {
        return {
          contents: `
            import React from 'react';
            var $empty = Symbol.for("react.memo_cache_sentinel");
            export function c(size) {
              return React.useMemo(function() {
                var arr = new Array(size);
                for (var i = 0; i < size; i++) arr[i] = $empty;
                return arr;
              }, []);
            }
            export function $empty() { return $empty; }
            export function $reset() {}
            export function $makeReadOnly(x) { return x; }
            export function $structuralCheck() {}
            export function useRenderCounter() {}
          `,
          loader: 'js',
        };
      });

      // ── 1. Module resolve hook ─────────────────────────────────────────────
      build.onResolve({ filter: /.*/ }, (args) => {
        // Let node_modules resolve themselves unless they use project aliases
        if (args.importer && args.importer.includes('node_modules')) {
          if (!args.path.startsWith('src/') && !args.path.startsWith('@/')) {
            return undefined;
          }
        }

        // Relative imports (./ or ../)
        if (args.path.startsWith('.')) {
          if (args.importer) {
            const resolved = resolveWithExtensions(
              path.resolve(path.dirname(args.importer), args.path)
            );
            if (resolved) return { path: resolved };
          }
          return undefined;
        }

        // Root-relative imports (/some/path)
        if (args.path.startsWith('/')) {
          const fromPublic = path.join(publicDir, args.path);
          if (fs.existsSync(fromPublic)) return { path: fromPublic };
          const fromRoot = resolveWithExtensions(path.join(root, args.path));
          if (fromRoot) return { path: fromRoot };
          return undefined;
        }

        // Configured aliases (exact match or prefix)
        for (const { find, target } of normalizedAliases) {
          if (args.path === find) {
            const resolved = resolveWithExtensions(target);
            if (resolved) return { path: resolved };
          } else if (args.path.startsWith(find + '/')) {
            const sub = args.path.slice(find.length + 1);
            const resolved = resolveWithExtensions(path.join(target, sub));
            if (resolved) return { path: resolved };
          }
        }

        // Explicit `src/...` imports
        if (args.path === 'src' || args.path.startsWith('src/')) {
          const resolved = resolveWithExtensions(path.join(root, args.path));
          if (resolved) return { path: resolved };
        }

        // Auto-mapped top-level src folders
        if (autoMapSrcFolders) {
          const firstSegment = args.path.split('/')[0];
          if (srcFolders.has(firstSegment)) {
            const resolved = resolveWithExtensions(path.join(srcDir, args.path));
            if (resolved) return { path: resolved };
          }
        }

        // General baseUrl fallback (mirrors tsconfig / jsconfig baseUrl resolution)
        if (baseUrlDir && fs.existsSync(baseUrlDir)) {
          const resolved = resolveWithExtensions(path.join(baseUrlDir, args.path));
          if (resolved) return { path: resolved };
        }

        return undefined;
      });

      // ── 2. CSS injection hook ──────────────────────────────────────────────
      if (injectCss) {
        build.onLoad({ filter: /\.css$/ }, async (args) => {
          let rawCss = await fs.promises.readFile(args.path, 'utf-8');

          // Optional transform hook (Tailwind, PostCSS, …)
          if (typeof cssTransform === 'function') {
            try {
              const transformed = await cssTransform(rawCss, args.path);
              if (typeof transformed === 'string') rawCss = transformed;
            } catch (err) {
              console.error(`[bun-as-vite] CSS transform error (${args.path}):`, err);
            }
          }

          // Rewrite relative asset URLs (fonts, background-image, …) to root-relative
          rawCss = rewriteCssUrls(rawCss, args.path, root);

          // Produce a JS module that injects the CSS as a <style> tag
          const relPath = path.relative(root, args.path);
          const styleId = 'bav-css-' + relPath.replace(/[^a-zA-Z0-9_-]/g, '_');
          const jsModule = `
if (typeof document !== 'undefined') {
  let el = document.getElementById(${JSON.stringify(styleId)});
  if (!el) {
    el = document.createElement('style');
    el.id = ${JSON.stringify(styleId)};
    el.setAttribute('data-bav-style', ${JSON.stringify(relPath)});
    document.head.appendChild(el);
  }
  el.textContent = ${JSON.stringify(rawCss)};
}
export default ${JSON.stringify(rawCss)};
`;
          return { contents: jsModule, loader: 'js' };
        });
      }
    },
  };
}

export default bunAsVite;
