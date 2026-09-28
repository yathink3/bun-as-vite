import type { BavPlugin } from '../types';

/**
 * Legacy config plugin.
 */
export function legacyConfigPlugin(): BavPlugin {
  return {
    name: 'bav:legacy-config',
  };
}

export default legacyConfigPlugin;
