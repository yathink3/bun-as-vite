import type { BavPlugin, PluginContext } from '../types';

/**
 * Configuration options for the customConfig plugin.
 */
export interface CustomConfigPluginOptions {
  /**
   * Additional path alias mappings to merge into the Bun resolver (e.g. `{ '@': './src' }`).
   */
  alias?: Record<string, string>;
  /**
   * Arbitrary additional custom configuration options.
   */
  [key: string]: any;
}

/**
 * Custom configuration plugin for Bun-as-Vite.
 * Merges path aliases and custom settings into the Bun module resolver configuration.
 *
 * @param options Plugin configuration options (alias mappings).
 * @returns Bun-as-Vite custom config plugin.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'bun-as-vite';
 * import { customConfigPlugin } from 'bun-as-vite/custom-config';
 *
 * export default defineConfig({
 *   plugins: [
 *     customConfigPlugin({
 *       alias: { '@components': './src/components' },
 *     }),
 *   ],
 * });
 * ```
 */
export function customConfigPlugin(options: CustomConfigPluginOptions = {}): BavPlugin {
  return {
    name: 'bav:custom-config',

    configBun(ctx: PluginContext) {
      Object.assign(ctx.config.alias, options.alias || {});
    },
  };
}

export default customConfigPlugin;
