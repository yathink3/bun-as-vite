import type { BavPlugin, PluginContext } from '../types';

export interface CustomConfigPluginOptions {
  alias?: Record<string, string>;
  [key: string]: any;
}

/**
 * Custom config plugin.
 * Merges path aliases and configuration into the Bun module resolver.
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
