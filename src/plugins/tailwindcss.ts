import path from 'path';
import type { BavPlugin, PluginContext } from '../types';

export interface TailwindcssPluginOptions {
  [key: string]: any;
}

/**
 * Tailwind CSS v4 JIT compilation plugin.
 */
export function tailwindcss(_options: TailwindcssPluginOptions = {}): BavPlugin {
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

export default tailwindcss;
