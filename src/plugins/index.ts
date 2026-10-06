/**
 * Plugin suite for bun-as-vite.
 *
 * Includes plugins for:
 * - Code splitting (`codeSplitPlugin` / `codeSplit`)
 * - Proxy redirects (`proxyRedirectsPlugin` / `proxyRedirects`)
 * - Custom configurations and path aliases (`customConfigPlugin` / `customConfig`)
 * - Environment variable prefix loading (`envLoaderPlugin` / `envLoader`)
 * - Build quality and chunk size scoring (`buildScorerPlugin` / `buildScorer`)
 * - Tailwind CSS v4 JIT compilation (`tailwindcss`)
 * - Core Bun resolver & CSS injection (`bunAsVite` / `bunPlugin`)
 * - Build log modification (`buildLogModifierPlugin` / `buildLogModifier`)
 * - Legacy Vite/CRA configuration (`legacyConfigPlugin` / `legacyConfig`)
 * - Public CSS management (`publicCssManagePlugin` / `publicCssManage`)
 * - Config creation & plugin wrapping helpers (`createBunConfig`, `wrapPlugin`)
 *
 * @module plugins
 */

export { default as codeSplitPlugin, codeSplitPlugin as codeSplit, type CodeSplitPluginOptions, type CodeSplitGroup } from './codeSplit';
export {
  default as proxyRedirectsPlugin,
  proxyRedirectsPlugin as proxyRedirects,
  type ProxyRedirectsPluginOptions,
  type ProxyRedirectsOptions,
  type DeployPlatform,
} from './proxyRedirects';
export { default as customConfigPlugin, customConfigPlugin as customConfig, type CustomConfigPluginOptions } from './customConfig';
export { default as envLoaderPlugin, envLoaderPlugin as envLoader, type EnvLoaderPluginOptions } from './envLoader';
export { default as buildScorerPlugin, buildScorerPlugin as buildScorer, type BuildScorerPluginOptions } from './buildScorer';
export { default as tailwindcss, type TailwindcssPluginOptions } from './tailwindcss';
export { default as bunAsVite, bunAsVite as bunPlugin, type BunAsViteOptions } from './bunPlugin';
export { default as buildLogModifierPlugin, buildLogModifierPlugin as buildLogModifier, type BuildLogModifierOptions } from './buildLogModifier';
export { default as legacyConfigPlugin, legacyConfigPlugin as legacyConfig } from './legacyConfig';
export { default as publicCssManagePlugin, publicCssManagePlugin as publicCssManage, type PublicCssManageOptions } from './publicCssManage';
export { createBunConfig, wrapPlugin } from './shims';

