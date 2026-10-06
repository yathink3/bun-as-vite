import type { BavPlugin } from '../types';

/**
 * Configuration options for the publicCssManage plugin.
 */
export interface PublicCssManageOptions {
  /**
   * Arbitrary options for managing public CSS files.
   */
  [key: string]: any;
}

/**
 * Public CSS management plugin for Bun-as-Vite.
 * Coordinates static CSS assets located in public directory.
 *
 * @param _options Plugin configuration options.
 * @returns Bun-as-Vite public CSS management plugin.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'bun-as-vite';
 * import { publicCssManagePlugin } from 'bun-as-vite/public-css-manage';
 *
 * export default defineConfig({
 *   plugins: [publicCssManagePlugin()],
 * });
 * ```
 */
export function publicCssManagePlugin(_options: PublicCssManageOptions = {}): BavPlugin {
  return {
    name: 'bav:public-css-manage',
  };
}

export default publicCssManagePlugin;
