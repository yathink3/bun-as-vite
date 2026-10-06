/**
 * bun-as-vite
 *
 * Run Vite-configured React and web apps on Bun natively with zero config rewrite.
 * Full drop-in replacement for Vite defineConfig with Bun.build and Bun.serve.
 *
 * @module bun-as-vite
 */

export {
  defineConfig,
  default as default,
  runDev,
  runBuild,
  runPreview,
} from './define-config';

export {
  bunAsVite,
  createBunConfig,
  tailwindcss,
  codeSplitPlugin,
  proxyRedirectsPlugin,
  customConfigPlugin,
  envLoaderPlugin,
  buildScorerPlugin,
  wrapPlugin,
} from './plugins/index';

export {
  default as logger,
  logBox,
  logStep,
  logGrid,
  createSpinner,
  colors,
} from './utils/logger';
export type { LogType } from './utils/logger';

export type {
  BunConfig,
  UserConfig,
  ConfigFactory,
  CLIOptions,
  ResolvedConfig,
  BavPlugin,
  PluginContext,
  BuildCompleteContext,
  ServerRequestContext,
  CodeSplitGroup,
  ProxyRule,
  BunAsViteConfigResult,
} from './types';

