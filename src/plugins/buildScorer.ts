import type { BavPlugin, PluginContext, BuildCompleteContext } from '../types';

export interface BuildScorerPluginOptions {
  budgetKb?: number;
  [key: string]: any;
}

/**
 * Build scorer plugin.
 * Audits total bundle size and flags oversized chunks after build completion.
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
      const [c, r, g, y, b] = ['\x1b[36m', '\x1b[0m', '\x1b[32m', '\x1b[33m', '\x1b[1m'];

      console.log(`\n${b}${c}  ── Build Quality Report ──────────────────────────────────────${r}`);
      console.log(`  ${g}✔${r}  ${b}Total bundle${r}: ${b}${mb} MB${r}  (${jsChunks} JS chunks, ${outputs.length} outputs)`);
      console.log(`  ${g}✔${r}  ${b}Build time${r}:   ${b}${elapsedMs}ms${r}`);
      if (largeChunks.length > 0) {
        console.log(`  ${y}⚠${r}  ${y}Oversized chunks (>${budgetKb} KB):${r}`);
        for (const ch of largeChunks) console.log(`       ${y}→${r} ${ch.name} — ${ch.kb} KB`);
      } else {
        console.log(`  ${g}✔${r}  All chunks within the ${budgetKb} KB budget`);
      }
      console.log(`${b}${c}  ──────────────────────────────────────────────────────────────${r}\n`);
    },
  };
}

export default buildScorerPlugin;
