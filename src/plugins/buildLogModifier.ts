import type { BavPlugin } from '../types';

/**
 * Configuration options for the buildLogModifier plugin.
 */
export interface BuildLogModifierOptions {
  /**
   * Arbitrary additional build log modifier settings.
   */
  [key: string]: any;
}

/**
 * Build log modifier plugin for Bun-as-Vite.
 * Intercepts and customizes build output reporting format.
 *
 * @param _options Plugin configuration options.
 * @returns Bun-as-Vite build log modifier plugin.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'bun-as-vite';
 * import { buildLogModifierPlugin } from 'bun-as-vite/build-log-modifier';
 *
 * export default defineConfig({
 *   plugins: [buildLogModifierPlugin()],
 * });
 * ```
 */
export function buildLogModifierPlugin(_options: BuildLogModifierOptions = {}): BavPlugin {
  return {
    name: 'bav:build-log-modifier',
  };
}

export default buildLogModifierPlugin;
