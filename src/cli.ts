#!/usr/bin/env bun
import path from 'path';
import fs from 'fs';
import { parseCLIArgs, printHelp } from './utils/cli-args';
import { logBox } from './utils/logger';

export async function runCLI(argv: string[] = process.argv.slice(2)): Promise<void> {
  const cliArgs = parseCLIArgs(argv);

  if (cliArgs.help) {
    printHelp('bun-as-vite');
    process.exit(0);
  }

  const root = process.cwd();
  const candidates = cliArgs.configFile
    ? [path.resolve(root, cliArgs.configFile)]
    : [
        path.join(root, 'bun-as-vite.config.ts'),
        path.join(root, 'bun-as-vite.config.js'),
        path.join(root, 'bun.config.ts'),
        path.join(root, 'bun.config.js'),
        path.join(root, 'vite.config.ts'),
        path.join(root, 'vite.config.js'),
      ];

  let found: string | null = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      found = candidate;
      break;
    }
  }

  if (!found) {
    logBox('[bun-as-vite:cli] No config file found.', 'error');
    logBox('Expected bun.config.js, bun-as-vite.config.ts, or vite.config.js in project root.', 'error');
    process.exit(1);
  }

  const mod = await import(found);
  const config = mod.default || mod;

  // If the config object has .run and was not already executed:
  if (config && typeof config.run === 'function' && !config.__alreadyRun) {
    config.__alreadyRun = true;
    await config.run(cliArgs);
  }
}

if (import.meta.main || process.argv[1]?.includes('cli')) {
  runCLI().catch((err) => {
    logBox(`[bun-as-vite] Error: ${err?.message || err}`, 'error');
    process.exit(1);
  });
}
