import type { BunConfig, BavPlugin } from '../types';

/**
 * Creates the mutable BunConfig object passed to every `configBun` hook.
 */
export function createBunConfig(): BunConfig {
  return {
    alias: {},
    autoMapSrcFolders: true,
    injectCss: true,
    cssTransformChain: [],
    server: {
      proxy: {},
      rewrites: [],
    },
    entrypoint: null,
    extraEntrypoints: [],
    codeSplitGroups: [],
    splitting: true,
    sourcemap: { dev: 'inline', prod: 'external' },
    naming: {
      entry: 'assets/[name]-[hash].[ext]',
      chunk: 'assets/chunk-[name]-[hash].[ext]',
      asset: 'assets/[name]-[hash].[ext]',
    },
    enableBuildScorer: false,
    bunPlugins: [],
    bunBuild: {},
  };
}

/**
 * Wraps any arbitrary object as a bun-as-vite plugin.
 * Forwards only the recognised lifecycle hooks.
 */
export function wrapPlugin(plugin: any): BavPlugin {
  if (!plugin || typeof plugin !== 'object') {
    throw new TypeError('[bun-as-vite] wrapPlugin: argument must be an object');
  }
  const hooks = ['configBun', 'cssTransform', 'buildComplete', 'serverRequest'];
  const forwarded: Record<string, any> = {};
  for (const h of hooks) {
    if (typeof plugin[h] === 'function') forwarded[h] = plugin[h].bind(plugin);
  }
  return { name: plugin.name || 'bav:wrapped-plugin', ...forwarded };
}

// ── Re-exports for backward-compat (consumers who imported from shims directly) ──
export { default as tailwindcss, type TailwindcssPluginOptions } from './tailwindcss';
export {
  default as proxyRedirectsPlugin,
  type ProxyRedirectsPluginOptions,
  type ProxyRedirectsOptions,
  type DeployPlatform,
} from './proxyRedirects';
export {
  default as codeSplitPlugin,
  type CodeSplitPluginOptions,
  type CodeSplitGroup,
} from './codeSplit';
export { default as customConfigPlugin, type CustomConfigPluginOptions } from './customConfig';
export { default as envLoaderPlugin, type EnvLoaderPluginOptions } from './envLoader';
export { default as buildScorerPlugin, type BuildScorerPluginOptions } from './buildScorer';
