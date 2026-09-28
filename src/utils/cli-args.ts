import type { CLIOptions } from '../types';

export interface ParsedCLIArgs extends CLIOptions {
  mode: 'dev' | 'build' | 'preview';
  port?: number;
  host?: string;
  proxy?: string;
  outdir: string;
  minify: boolean;
  configFile: string | null;
  help: boolean;
}

/**
 * Shared CLI argument parser for bun-as-vite.
 */
export function parseCLIArgs(argv: string[] = process.argv.slice(2)): ParsedCLIArgs {
  let mode: 'dev' | 'build' | 'preview' = 'dev';
  let port: number | undefined = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
  let host: string | undefined = process.env.HOST || undefined;
  let proxy: string | undefined = undefined;
  let outdir = 'build';
  let minify = true;
  let configFile: string | null = null;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case 'dev':
      case '--dev':
        mode = 'dev';
        break;
      case 'build':
      case '--build':
        mode = 'build';
        break;
      case 'preview':
      case '--preview':
      case 'serve':
      case '--serve':
        mode = 'preview';
        break;
      case '-p':
      case '--port':
        port = parseInt(argv[++i], 10);
        break;
      case '--host':
        host = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : '0.0.0.0';
        break;
      case '--proxy':
        proxy = argv[++i];
        break;
      case '--outdir':
      case '--dir':
        outdir = argv[++i];
        break;
      case '--no-minify':
        minify = false;
        break;
      case '--config':
      case '-c':
        configFile = argv[++i];
        break;
      case '-h':
      case '--help':
        help = true;
        break;
    }
  }

  return { mode, port, host, proxy, outdir, minify, configFile, help };
}

export function printHelp(scriptName = 'bun-as-vite'): void {
  console.log(`
\x1b[1m\x1b[36m${scriptName}\x1b[0m — Bun-powered Vite-compatible dev server & build tool

\x1b[1mUSAGE:\x1b[0m
  bun <config-file> [command] [options]
  bun-as-vite [command] [options]

\x1b[1mCOMMANDS:\x1b[0m
  dev, --dev           Start development server with live reload & proxy (default)
  build, --build       Build optimised production bundle
  preview, --preview   Serve the production build locally

\x1b[1mOPTIONS:\x1b[0m
  -p, --port <n>       Port to listen on (default: 4545)
  --host [host]        Bind address (default: 0.0.0.0)
  --proxy <url>        Upstream API proxy URL
  --outdir, --dir <d>  Output directory (default: build)
  --no-minify          Disable minification in production builds
  --config, -c <file>  Path to bun-as-vite config file
  -h, --help           Show this help message
`);
}
