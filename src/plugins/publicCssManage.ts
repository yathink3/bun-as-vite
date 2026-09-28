import type { BavPlugin } from '../types';

export interface PublicCssManageOptions {
  [key: string]: any;
}

/**
 * Public CSS manage plugin.
 */
export function publicCssManagePlugin(_options: PublicCssManageOptions = {}): BavPlugin {
  return {
    name: 'bav:public-css-manage',
  };
}

export default publicCssManagePlugin;
