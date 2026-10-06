import type { BavPlugin, PluginContext } from '../types';

/**
 * Configuration options for the envLoader plugin.
 */
export interface EnvLoaderPluginOptions {
  /**
   * Environment variable prefixes to expose to client-side code via `import.meta.env`.
   * @default ['VITE_', 'BASE_']
   */
  prefixes?: string[];
}

/**
 * Environment variable loader plugin for Bun-as-Vite.
 * Registers environment variable prefixes to be loaded from `.env` files and exposed via `import.meta.env`.
 *
 * @param options Plugin options defining allowed environment variable prefixes.
 * @returns Bun-as-Vite env loader plugin.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'bun-as-vite';
 * import { envLoaderPlugin } from 'bun-as-vite/env-loader';
 *
 * export default defineConfig({
 *   plugins: [
 *     envLoaderPlugin({
 *       prefixes: ['VITE_', 'REACT_APP_', 'MY_PREFIX_'],
 *     }),
 *   ],
 * });
 * ```
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

export default envLoaderPlugin;
