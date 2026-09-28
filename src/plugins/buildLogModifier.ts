import type { BavPlugin } from '../types';

export interface BuildLogModifierOptions {
  [key: string]: any;
}

/**
 * Build log modifier plugin.
 */
export function buildLogModifierPlugin(_options: BuildLogModifierOptions = {}): BavPlugin {
  return {
    name: 'bav:build-log-modifier',
  };
}

export default buildLogModifierPlugin;
