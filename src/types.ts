import type { BunPlugin } from 'bun';

export interface CodeSplitGroup {
  name: string;
  test: RegExp | ((id: string) => boolean);
}

export interface ProxyRule {
  prefix?: string;
  target?: string;
  targetBase?: string;
  pathPart?: string;
  displayKey?: string;
  displayTarget?: string;
  isRegex?: boolean;
  regex?: RegExp | null;
  changeOrigin?: boolean;
  rewrite?: ((path: string) => string) | null;
  headers?: Record<string, string> | null;
  secure?: boolean;
  ws?: boolean;
  rewriteWsOrigin?: boolean;
  configure?: ((proxy: any, options: any) => void) | null;
}

export interface BunConfig {
  alias: Record<string, string>;
  autoMapSrcFolders: boolean;
  injectCss: boolean;
  cssTransformChain: Array<(rawCss: string, filePath: string, root: string) => Promise<string | null> | string | null>;
  server: {
    proxy: Record<string, any>;
  };
  entrypoint: string | null;
  extraEntrypoints: string[];
  codeSplitGroups: CodeSplitGroup[];
  splitting: boolean;
  sourcemap: { dev: 'inline' | 'none'; prod: 'external' | 'inline' | 'none' };
  naming: {
    entry: string;
    chunk: string;
    asset: string;
  };
  enableBuildScorer: boolean;
  bunPlugins: BunPlugin[];
  bunBuild: Record<string, any>;
  envPrefixes?: string[];
}

export interface PluginContext {
  config: BunConfig;
  root: string;
  srcDir: string;
  publicDir: string;
  mode: string;
  command: string;
}

export interface BuildCompleteContext {
  outputs: Array<{ path: string; size: number; kind: string }>;
  elapsedMs: number;
  mode: string;
  outDir: string;
}

export interface ServerRequestContext {
  mode: 'dev' | 'preview';
  srcDir: string;
  root: string;
}

export interface BavPlugin {
  name: string;
  configBun?: (ctx: PluginContext) => void | Promise<void>;
  cssTransform?: (rawCss: string, filePath: string, root: string) => Promise<string | null> | string | null;
  buildComplete?: (result: any, ctx: BuildCompleteContext) => void | Promise<void>;
  serverRequest?: (req: Request, ctx: ServerRequestContext) => Promise<Response | null> | Response | null;
  [key: string]: any;
}

export interface UserConfig {
  root?: string;
  base?: string;
  mode?: string;
  publicDir?: string;
  logLevel?: string;
  assetsInclude?: string[];
  define?: Record<string, any>;
  plugins?: Array<BavPlugin | any>;
  resolve?: {
    alias?: Record<string, string> | Array<{ find: string | RegExp; replacement: string }>;
  };
  server?: {
    port?: number;
    host?: string;
    proxy?: Record<string, any>;
    [key: string]: any;
  };
  build?: {
    outDir?: string;
    sourcemap?: boolean | 'inline' | 'external' | 'none';
    minify?: boolean;
    [key: string]: any;
  };
  packages?: 'bundle' | 'external';
  format?: 'esm' | 'cjs' | 'iife';
  bun?: Record<string, any>;
  bunBuild?: Record<string, any>;
  [key: string]: any;
}

export type ConfigFactory = (env: { mode: string; command: string }) => UserConfig | Promise<UserConfig>;

export interface CLIOptions {
  mode?: 'dev' | 'build' | 'preview';
  port?: number;
  host?: string;
  proxy?: string;
  minify?: boolean;
  help?: boolean;
}

export interface ResolvedConfig {
  root: string;
  srcDir: string;
  publicDir: string;
  outDir: string;
  port: number;
  host: string;
  server: {
    port: number;
    host: string;
    proxy: Record<string, any>;
  };
  proxyRules: ProxyRule[];
  minify: boolean;
  define: Record<string, any>;
  plugins: BavPlugin[];
  bunPlugin: BunPlugin;
  bunPlugins: BunPlugin[];
  splitting: boolean;
  naming: { entry: string; chunk: string; asset: string };
  entrypoint: string | null;
  extraEntrypoints: string[];
  codeSplitGroups: CodeSplitGroup[];
  extraBuildProps: Record<string, any>;
  rawConfig: UserConfig;
}
