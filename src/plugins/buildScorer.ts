import type { BavPlugin, PluginContext, BuildCompleteContext } from '../types';
import { logBox, logGrid, colors } from '../utils/logger';

/**
 * Configuration options for the buildScorer plugin.
 */
export interface BuildScorerPluginOptions {
  /**
   * Maximum allowed size in kilobytes for individual JavaScript chunks before a warning is logged.
   * @default 800
   */
  budgetKb?: number;
  /**
   * Arbitrary additional scorer options.
   */
  [key: string]: any;
}

/**
 * Build quality audit and chunk scoring plugin for Bun-as-Vite.
 * Audits emitted bundle chunks upon build completion, calculates total bundle size,
 * build elapsed time, and highlights chunks exceeding the configured budget threshold.
 *
 * @param options Plugin options (budgetKb threshold).
 * @returns Bun-as-Vite build scorer plugin.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'bun-as-vite';
 * import { buildScorerPlugin } from 'bun-as-vite/build-scorer';
 *
 * export default defineConfig({
 *   plugins: [
 *     buildScorerPlugin({ budgetKb: 500 }),
 *   ],
 * });
 * ```
 */
export function buildScorerPlugin(options: BuildScorerPluginOptions = {}): BavPlugin {
  const budgetKb = options.budgetKb || 800;

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
          if (size > budgetKb * 1024) {
            largeChunks.push({
              name: out.path.split('/').pop() || out.path,
              kb: (size / 1024).toFixed(0),
            });
          }
        }
      }

      const mb = (totalBytes / (1024 * 1024)).toFixed(2);

      logBox(colors.bold('── Build Quality Report ──'), 'info');
      const rows: string[][] = [
        ['Total bundle', `${mb} MB`, `(${jsChunks} JS chunks, ${outputs.length} outputs)`],
        ['Build time',   `${elapsedMs}ms`, ''],
      ];
      logGrid('build-scorer', rows);

      if (largeChunks.length > 0) {
        logBox(`Oversized chunks (>${budgetKb} KB):`, 'warn');
        for (const ch of largeChunks) {
          logBox(`  → ${ch.name} — ${ch.kb} KB`, 'warn');
        }
      } else {
        logBox(`All chunks within the ${budgetKb} KB budget`, 'success');
      }
    },
  };
}

export default buildScorerPlugin;
