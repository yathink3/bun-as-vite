import path from 'path';
import fs from 'fs';
import type { BavPlugin, CodeSplitGroup, PluginContext, BuildCompleteContext } from '../types';

export type { CodeSplitGroup };

// ─── Options ──────────────────────────────────────────────────────────────────

export interface CodeSplitPluginOptions {
  /**
   * Code splitting group definitions.
   *
   * NOTE: In Bun.build, true `manualChunks`-style grouping (as in Vite/Rollup) is
   * not available. Bun's code splitter automatically deduplicates shared modules
   * across dynamic import() boundaries. The `groups` array is accepted for config
   * compatibility and forward-compatibility, but does not force named chunk grouping.
   *
   * Use React.lazy() / dynamic import() in your app code to create code-split points.
   * Bun will automatically bundle each split point into a separate chunk.
   */
  groups?: CodeSplitGroup[];
  /**
   * Alternative codeSplitting object structure ({ groups: CodeSplitGroup[] }).
   */
  codeSplitting?: { groups?: CodeSplitGroup[] };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

/**
 * Code-splitting plugin for Bun.build.
 *
 * Enables Bun's native `splitting: true` so that dynamic `import()` calls and
 * React.lazy() produce separate JS chunks, reducing initial bundle size.
 *
 * ### Netlify / production deployment
 *
 * Bun generates chunk import URLs as:
 *   `publicPath + chunkFilename`
 * where `publicPath` is automatically derived from the naming.entry directory
 * prefix (e.g. 'assets/' → publicPath '/assets/'). This ensures chunks are
 * fetched from the correct location on the CDN.
 *
 * ### Why no manualChunks / virtual entries?
 *
 * Bun's code splitter does not have a `manualChunks` equivalent. A previous
 * approach created virtual re-export entry files (.bun-chunks/) to mimic
 * Vite's manualChunks, but this caused Bun to generate incorrect export
 * bindings in shared chunks ("Export '$X' is not defined in module") under
 * minification due to how Bun handles namespace imports across multiple
 * entry-points. The virtual entry approach has been removed.
 */
export function codeSplitPlugin(options: CodeSplitPluginOptions = {}): BavPlugin {
  const groups: CodeSplitGroup[] = options.groups || options.codeSplitting?.groups || [];

  return {
    name: 'bav:code-split',

    configBun(ctx: PluginContext) {
      ctx.config.splitting = true;

      // Store groups on config for informational use (e.g. entry-point selection)
      // even though they are not enforced as named chunks in Bun.
      ctx.config.codeSplitGroups = groups;
    },

    buildComplete(_result: any, ctx: BuildCompleteContext) {
      // Clean up any leftover .bun-chunks directory from older plugin versions
      const legacyChunkDir = path.resolve(
        ctx.outDir ? path.dirname(ctx.outDir) : process.cwd(),
        '.bun-chunks',
      );
      if (fs.existsSync(legacyChunkDir)) {
        try { fs.rmSync(legacyChunkDir, { recursive: true, force: true }); } catch {}
      }
    },
  };
}

export default codeSplitPlugin;
