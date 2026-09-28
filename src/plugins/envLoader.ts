import type { BavPlugin, PluginContext } from '../types';

export interface EnvLoaderPluginOptions {
  prefixes?: string[];
}

/**
 * Env loader plugin.
 * Registers environment variable prefixes to be exposed via import.meta.env.
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
