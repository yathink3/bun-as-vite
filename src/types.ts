import type { BunPlugin } from 'bun';

/**
 * Definition for code-splitting chunk grouping.
 * Allows defining a group name and a matching pattern (RegExp or predicate).
 */
export interface CodeSplitGroup {
  /**
   * The name identifier for this split group / chunk.
   */
  name: string;
  /**
   * Pattern or predicate function matching module IDs that belong to this group.
   */
  test: RegExp | ((id: string) => boolean);
}

/**
 * Configuration options for an individual proxy forwarding rule.
 */
export interface ProxyRule {
  /**
   * URL route prefix to match (e.g. `/api`).
   */
  prefix?: string;
  /**
   * Target URL to proxy requests to (e.g. `http://localhost:8080`).
   */
  target?: string;
  /**
   * Base URL origin of the target host.
   */
  targetBase?: string;
  /**
   * Specific path part of the target URL to forward to.
   */
  pathPart?: string;
  /**
   * Display name or route key used in server console logs.
   */
  displayKey?: string;
  /**
   * Human-readable target string for terminal reporting.
   */
  displayTarget?: string;
  /**
   * Whether the route match is a regex pattern.
   */
  isRegex?: boolean;
  /**
   * Optional regular expression used for route matching.
   */
  regex?: RegExp | null;
  /**
   * Changes the origin of the host header to the target URL.
   * @default true
   */
  changeOrigin?: boolean;
  /**
   * Path rewrite function called on request paths before forwarding.
   */
  rewrite?: ((path: string) => string) | null;
  /**
   * Additional HTTP request headers to attach when forwarding to the target.
   */
  headers?: Record<string, string> | null;
  /**
   * Whether to verify SSL certificate of the target. Set to false to allow self-signed certs.
   * @default false
   */
  secure?: boolean;
  /**
   * Whether WebSocket upgrade requests should be proxied.
   */
  ws?: boolean;
  /**
   * Whether to rewrite the Origin header for WebSocket proxying.
   */
  rewriteWsOrigin?: boolean;
  /**
   * Hook to configure proxy instance directly.
   */
  configure?: ((proxy: any, options: any) => void) | null;
}

/**
 * Local file system rewrite rule for SPA routing and sub-app serving.
 */
export interface LocalRewriteRule {
  /**
   * Source route pattern to match (e.g. `/sub-app/*`).
   */
  from: string;
  /**
   * Target file or local path to resolve to (e.g. `/sub-app/index.html`).
   */
  to: string;
  /**
   * Route prefix identifier for the rule.
   */
  prefix: string;
  /**
   * HTTP status code to return when serving this rewrite.
   * @default 200
   */
  status?: number;
}

/**
 * Mutable internal configuration object accumulated across `configBun` plugin hooks.
 */
export interface BunConfig {
  /**
   * Map of module import aliases to file system paths or package names.
   */
  alias: Record<string, string>;
  /**
   * Automatically detect and map top-level directories in `src/` as path aliases.
   * @default true
   */
  autoMapSrcFolders: boolean;
  /**
   * Whether CSS imports in JS modules should be converted into runtime style injection tags.
   * @default true
   */
  injectCss: boolean;
  /**
   * Array of sequential CSS transform functions applied during build and development.
   */
  cssTransformChain: Array<(rawCss: string, filePath: string, root: string) => Promise<string | null> | string | null>;
  /**
   * Development server proxy and rewrite configurations.
   */
  server: {
    /**
     * Map of path prefixes to proxy target definitions.
     */
    proxy: Record<string, any>;
    /**
     * Local SPA rewrite rules.
     */
    rewrites?: LocalRewriteRule[];
  };
  /**
   * Primary entrypoint file path (e.g. `src/index.tsx` or `index.html`).
   */
  entrypoint: string | null;
  /**
   * Additional entrypoint file paths to include in the bundle.
   */
  extraEntrypoints: string[];
  /**
   * Code-splitting chunk groups for module boundary separation.
   */
  codeSplitGroups: CodeSplitGroup[];
  /**
   * Enable code splitting across dynamic `import()` boundaries.
   * @default true
   */
  splitting: boolean;
  /**
   * Sourcemap generation strategy for development and production modes.
   */
  sourcemap: { dev: 'inline' | 'none'; prod: 'external' | 'inline' | 'none' };
  /**
   * Asset naming templates for entries, chunks, and static assets.
   */
  naming: {
    /** Pattern for entry JavaScript files */
    entry: string;
    /** Pattern for code-split JavaScript chunks */
    chunk: string;
    /** Pattern for emitted static assets (images, fonts, css) */
    asset: string;
  };
  /**
   * Whether to output a detailed bundle quality and chunk budget report after build.
   * @default false
   */
  enableBuildScorer: boolean;
  /**
   * Low-level Bun native plugins registered for the build pipeline.
   */
  bunPlugins: BunPlugin[];
  /**
   * Extra options directly passed through to `Bun.build(...)`.
   */
  bunBuild: Record<string, any>;
  /**
   * Allowed environment variable prefixes exposed to `import.meta.env`.
   */
  envPrefixes?: string[];
}

/**
 * Context object provided to the `configBun` lifecycle hook in `BavPlugin`.
 */
export interface PluginContext {
  /**
   * The shared mutable Bun configuration object.
   */
  config: BunConfig;
  /**
   * Project root directory (absolute path).
   */
  root: string;
  /**
   * Project `src/` directory (absolute path).
   */
  srcDir: string;
  /**
   * Project public directory for static files (absolute path).
   */
  publicDir: string;
  /**
   * Current execution mode (e.g. `'development'`, `'production'`, `'dev'`, `'build'`).
   */
  mode: string;
  /**
   * Current command being executed (`'serve'` or `'build'`).
   */
  command: string;
}

/**
 * Context object provided to the `buildComplete` lifecycle hook in `BavPlugin`.
 */
export interface BuildCompleteContext {
  /**
   * Emitted build artifact outputs with file path, size in bytes, and artifact kind.
   */
  outputs: Array<{ path: string; size: number; kind: string }>;
  /**
   * Total elapsed build duration in milliseconds.
   */
  elapsedMs: number;
  /**
   * Build execution mode (e.g. `'production'`).
   */
  mode: string;
  /**
   * Destination output directory where build artifacts were emitted.
   */
  outDir: string;
}

/**
 * Context object provided to the `serverRequest` lifecycle hook in `BavPlugin`.
 */
export interface ServerRequestContext {
  /**
   * Server operation mode: `'dev'` (development server) or `'preview'` (preview server).
   */
  mode: 'dev' | 'preview';
  /**
   * Absolute path to the project's `src/` directory.
   */
  srcDir: string;
  /**
   * Absolute path to the project root directory.
   */
  root: string;
  /**
   * Full resolved output directory — available in preview mode.
   */
  outDir?: string;
  /**
   * Full resolved public static assets directory.
   */
  publicDir?: string;
}

/**
 * A bun-as-vite plugin definition with lifecycle hooks for config customization,
 * CSS transformation, build audits, and dev-server request handling.
 */
export interface BavPlugin {
  /**
   * Unique name identifier of the plugin.
   */
  name: string;
  /**
   * Hook called before build or dev server starts to mutate the Bun build & server configuration.
   * @param ctx Plugin execution context containing root, directories, and config.
   */
  configBun?: (ctx: PluginContext) => void | Promise<void>;
  /**
   * Hook to transform raw CSS content before bundling or injecting into the document.
   * @param rawCss The raw CSS source string.
   * @param filePath The absolute path of the CSS file being processed.
   * @param root The project root directory.
   * @returns Transformed CSS string, or null/undefined to leave unchanged.
   */
  cssTransform?: (rawCss: string, filePath: string, root: string) => Promise<string | null> | string | null;
  /**
   * Hook called immediately after production build completes.
   * @param result Bun.build result object.
   * @param ctx Build summary context including outputs and elapsed time.
   */
  buildComplete?: (result: any, ctx: BuildCompleteContext) => void | Promise<void>;
  /**
   * Hook called for incoming HTTP requests on the development or preview server.
   * Return a `Response` to handle the request, or `null`/`undefined` to fall through to default handlers.
   * @param req The incoming web Request.
   * @param ctx The server request context.
   */
  serverRequest?: (req: Request, ctx: ServerRequestContext) => Promise<Response | null> | Response | null;
  /**
   * Arbitrary additional plugin properties or custom Vite plugin compatibility fields.
   */
  [key: string]: any;
}

/**
 * Vite-compatible user configuration object accepted by `defineConfig`.
 */
export interface UserConfig {
  /**
   * Project root directory. Defaults to `process.cwd()`.
   */
  root?: string;
  /**
   * Base public path when served in development or production (e.g. `'/'` or `'/my-app/'`).
   * @default '/'
   */
  base?: string;
  /**
   * Explicit mode setting (e.g. `'development'`, `'production'`).
   */
  mode?: string;
  /**
   * Directory to serve as plain static assets. Defaults to `'public'`.
   */
  publicDir?: string;
  /**
   * Logging verbosity level.
   */
  logLevel?: string;
  /**
   * Additional file glob patterns to treat as static assets.
   */
  assetsInclude?: string[];
  /**
   * Global variable defines replaced during build/dev (e.g. `{ 'process.env.NODE_ENV': '"production"' }`).
   */
  define?: Record<string, any>;
  /**
   * Array of bun-as-vite or compatible Vite plugins.
   */
  plugins?: Array<BavPlugin | any>;
  /**
   * Module resolution options, including path alias mappings.
   */
  resolve?: {
    /**
     * Import aliases mapping path prefixes to targets.
     */
    alias?: Record<string, string> | Array<{ find: string | RegExp; replacement: string }>;
  };
  /**
   * Development server options, including port, host, and proxy rules.
   */
  server?: {
    /**
     * Port number to listen on. Defaults to 4545 or 3000.
     */
    port?: number;
    /**
     * Host IP or hostname to bind to. Defaults to `'0.0.0.0'`.
     */
    host?: string;
    /**
     * Proxy rules for forwarding API requests to backend services.
     */
    proxy?: Record<string, any>;
    /**
     * Additional server options.
     */
    [key: string]: any;
  };
  /**
   * Production build options.
   */
  build?: {
    /**
     * Directory to emit production build artifacts to. Defaults to `'build'`.
     */
    outDir?: string;
    /**
     * Sourcemap generation strategy.
     */
    sourcemap?: boolean | 'inline' | 'external' | 'none';
    /**
     * Whether to minify the output bundle.
     * @default true
     */
    minify?: boolean;
    /**
     * Additional build options.
     */
    [key: string]: any;
  };
  /**
   * How packages should be handled: `'bundle'` to bundle node_modules or `'external'` to preserve imports.
   */
  packages?: 'bundle' | 'external';
  /**
   * Output module format: `'esm'`, `'cjs'`, or `'iife'`.
   */
  format?: 'esm' | 'cjs' | 'iife';
  /**
   * Bun-specific configuration overrides.
   */
  bun?: Record<string, any>;
  /**
   * Pass-through options directly forwarded to `Bun.build(...)`.
   */
  bunBuild?: Record<string, any>;
  /**
   * Arbitrary additional user configuration options.
   */
  [key: string]: any;
}

/**
 * Configuration factory function signature for dynamic configuration based on mode and command.
 * @param env Execution environment information containing `mode` and `command`.
 * @returns UserConfig or Promise resolving to UserConfig.
 */
export type ConfigFactory = (env: { mode: string; command: string }) => UserConfig | Promise<UserConfig>;

/**
 * Command-line options passed to bun-as-vite CLI or runner functions.
 */
export interface CLIOptions {
  /**
   * Execution mode: `'dev'`, `'build'`, or `'preview'`.
   */
  mode?: 'dev' | 'build' | 'preview';
  /**
   * Port number override for the server.
   */
  port?: number;
  /**
   * Host interface to bind to.
   */
  host?: string;
  /**
   * Target backend proxy URL override.
   */
  proxy?: string;
  /**
   * Enable or disable bundle minification during build.
   */
  minify?: boolean;
  /**
   * Display help and usage information.
   */
  help?: boolean;
  /**
   * Path to custom configuration file.
   */
  configFile?: string | null;
  /**
   * Enable watch mode and HMR.
   */
  watch?: boolean;
  /**
   * Additional CLI arguments.
   */
  [key: string]: any;
}

/**
 * Fully resolved configuration object consumed by `runDev`, `runBuild`, and `runPreview`.
 */
export interface ResolvedConfig {
  /** Project root directory */
  root: string;
  /** Project source directory (typically `root/src`) */
  srcDir: string;
  /** Project public assets directory (typically `root/public`) */
  publicDir: string;
  /** Build output directory (typically `root/build`) */
  outDir: string;
  /** Resolved server port */
  port: number;
  /** Resolved server host */
  host: string;
  /** Whether watch mode and HMR are enabled */
  watch: boolean;
  /** Server options container */
  server: {
    port: number;
    host: string;
    proxy: Record<string, any>;
  };
  /** Array of active backend proxy rules */
  proxyRules: ProxyRule[];
  /** Array of local SPA rewrite rules */
  rewrites: LocalRewriteRule[];
  /** Whether minification is enabled for the build */
  minify: boolean;
  /** Global define replacements */
  define: Record<string, any>;
  /** Active bun-as-vite plugins */
  plugins: BavPlugin[];
  /** Primary Bun native plugin handling resolution and CSS */
  bunPlugin: BunPlugin;
  /** All registered Bun native plugins */
  bunPlugins: BunPlugin[];
  /** Whether code splitting is enabled */
  splitting: boolean;
  /** Naming pattern for emitted bundles */
  naming: { entry: string; chunk: string; asset: string };
  /** Primary entrypoint file path */
  entrypoint: string | null;
  /** Additional entrypoints */
  extraEntrypoints: string[];
  /** Code splitting groups */
  codeSplitGroups: CodeSplitGroup[];
  /** Extra properties passed to Bun.build */
  extraBuildProps: Record<string, any>;
  /** The original raw user configuration */
  rawConfig: UserConfig;
}

/**
 * Result object returned by `defineConfig(...)`.
 * Provides execution methods for running dev, build, and preview workflows,
 * resolving the configuration, or retrieving the raw configuration object.
 */
export interface BunAsViteConfigResult {
  /**
   * Runs the appropriate workflow (dev, build, or preview) based on CLI arguments.
   * @param cliOpts Optional command-line options.
   */
  run: (cliOpts?: CLIOptions) => Promise<void>;
  /**
   * Resolves and normalizes the configuration for the specified CLI options and mode.
   * @param cliOpts Optional command-line options.
   * @returns Fully resolved configuration ready for dev, build, or preview.
   */
  resolve: (cliOpts?: CLIOptions) => Promise<ResolvedConfig>;
  /**
   * Retrieves the raw underlying UserConfig object.
   * @param env Optional environment object containing `mode` and `command`.
   */
  getRawConfig: (env?: { mode: string; command: string }) => UserConfig;
}
