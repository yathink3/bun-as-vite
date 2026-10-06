import type { BavPlugin } from '../types';

/**
 * Legacy configuration compatibility plugin for Bun-as-Vite.
 * Preserves compatibility for legacy Vite and CRA configuration setups.
 *
 * @returns Bun-as-Vite legacy config plugin.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'bun-as-vite';
 * import { legacyConfigPlugin } from 'bun-as-vite/legacy-config';
 *
 * export default defineConfig({
 *   plugins: [legacyConfigPlugin()],
 * });
 * ```
 */
export function legacyConfigPlugin(): BavPlugin {
  return {
    name: 'bav:legacy-config',
  };
}

export default legacyConfigPlugin;
