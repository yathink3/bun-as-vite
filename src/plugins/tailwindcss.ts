import path from 'path';
import { logBox } from '../utils/logger';
import type { BavPlugin, PluginContext } from '../types';

/**
 * Configuration options for the Tailwind CSS v4 JIT compilation plugin.
 */
export interface TailwindcssPluginOptions {
  /**
   * Additional glob patterns for scanning source files for Tailwind candidate classes.
   * By default, scans `${srcDir}/**\/*.{jsx,js,tsx,ts,html}` and root `index.html`.
   */
  sources?: string[];
  /**
   * Custom filter predicate to determine if a CSS file should be transformed by Tailwind CSS.
   *
   * @param filePath Absolute path of the CSS file.
   * @param rawCss The raw CSS file content.
   * @returns `true` if the file should be compiled by Tailwind, `false` otherwise.
   */
  filter?: (filePath: string, rawCss: string) => boolean;
  /**
   * Arbitrary additional options forwarded to the Tailwind compiler.
   */
  [key: string]: any;
}

/**
 * Resolves @tailwindcss/node and @tailwindcss/oxide from the project root or bun-as-vite.
 */
async function loadTailwindModules(projectRoot: string) {
  // 1. Try direct import first
  try {
    const [m1, m2] = await Promise.all([
      // @ts-ignore
      import('@tailwindcss/node'),
      // @ts-ignore
      import('@tailwindcss/oxide'),
    ]);
    return { compile: (m1 as any).compile, Scanner: (m2 as any).Scanner };
  } catch {}

  // 2. Try resolving from project root (node_modules of target application)
  try {
    const { createRequire } = await import('module');
    const req = createRequire(path.join(projectRoot, 'package.json'));
    const nodePath = req.resolve('@tailwindcss/node');
    const oxidePath = req.resolve('@tailwindcss/oxide');
    const [m1, m2] = await Promise.all([
      import(nodePath),
      import(oxidePath),
    ]);
    return { compile: (m1 as any).compile, Scanner: (m2 as any).Scanner };
  } catch (err: any) {
    logBox(`Could not load @tailwindcss/node or @tailwindcss/oxide from ${projectRoot}: ${err.message}`, 'warn');
    return null;
  }
}

/**
 * Checks whether a given CSS file / content should be processed by Tailwind CSS.
 */
function isTailwindCss(filePath: string, rawCss: string): boolean {
  if (
    filePath.endsWith('globals.css') ||
    filePath.endsWith('global.css') ||
    filePath.endsWith('tailwind.css')
  ) {
    return true;
  }
  return (
    rawCss.includes('tailwindcss') ||
    rawCss.includes('@theme') ||
    rawCss.includes('@utility') ||
    rawCss.includes('@custom-variant') ||
    rawCss.includes('@tailwind')
  );
}

/**
 * Tailwind CSS v4 JIT compilation plugin for Bun-as-Vite.
 *
 * Automatically detects Tailwind CSS imports and directives (`@theme`, `@utility`, `@import "tailwindcss"`),
 * scans source code using `@tailwindcss/oxide` Scanner, and generates JIT compiled utility CSS
 * using `@tailwindcss/node` compile API during dev and production build.
 *
 * @param options Optional configuration for source scanning and file filtering.
 * @returns Bun-as-Vite plugin instance.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'bun-as-vite';
 * import tailwindcss from 'bun-as-vite/tailwindcss';
 *
 * export default defineConfig({
 *   plugins: [tailwindcss()],
 * });
 * ```
 */
export function tailwindcss(options: TailwindcssPluginOptions = {}): BavPlugin {
  let _compile: any = null;
  let _Scanner: any = null;
  let _compiler: any = null;
  let _lastRawCss = '';
  let _scanner: any = null;

  return {
    name: 'bav:tailwindcss',

    async configBun(ctx: PluginContext) {
      const modules = await loadTailwindModules(ctx.root);
      if (!modules) return;

      _compile = modules.compile;
      _Scanner = modules.Scanner;

      const { srcDir, root } = ctx;

      // Initialize scanner with source files and root index.html
      _scanner = new _Scanner({
        sources: [
          { base: srcDir, pattern: '**/*.{jsx,js,tsx,ts,html}', negated: false },
          { base: root, pattern: 'index.html', negated: false },
          ...(options.sources || []).map((s) => ({ base: root, pattern: s, negated: false })),
        ],
      });

      ctx.config.cssTransformChain.push(async (rawCss: string, filePath: string) => {
        const matches = options.filter
          ? options.filter(filePath, rawCss)
          : isTailwindCss(filePath, rawCss);

        if (!matches) return null;

        try {
          const base = path.dirname(filePath);

          // Recompile AST only when raw CSS or directory changes
          if (!_compiler || _lastRawCss !== rawCss) {
            _compiler = await _compile(rawCss, { base, onDependency: () => {} });
            _lastRawCss = rawCss;
          }

          // Scan source files for candidate classes and build CSS
          const candidates = _scanner ? _scanner.scan() : [];
          return _compiler.build(candidates);
        } catch (err: any) {
          logBox(`[bav:tailwindcss] Compile error (${filePath}): ${err.message}`, 'error');
          return rawCss;
        }
      });
    },
  };
}

export default tailwindcss;
