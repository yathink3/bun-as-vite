import path from 'path';
import fs from 'fs';
import type { BavPlugin, CodeSplitGroup, PluginContext, BuildCompleteContext } from '../types';

export type { CodeSplitGroup };

function isGroupMatch(id: string, test: RegExp | string | ((id: string) => boolean)): boolean {
  if (typeof test === 'function') {
    try {
      return Boolean(test(id));
    } catch {
      return false;
    }
  }
  if (typeof test === 'string') return id.includes(test);
  if (test instanceof RegExp) return test.test(id);
  return false;
}

function canResolvePackage(pkgName: string, root: string): boolean {
  try {
    (Bun as any).resolveSync(pkgName, root);
    return true;
  } catch {
    try {
      require.resolve(pkgName, { paths: [root] });
      return true;
    } catch {
      return false;
    }
  }
}

function findMatchingPackagesForGroups(groups: CodeSplitGroup[], root: string): Map<string, string[]> {
  const nmPath = path.resolve(root, 'node_modules');
  const pkgPath = path.resolve(root, 'package.json');

  const candidatePackages = new Set<string>();
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      for (const d of Object.keys(pkg.dependencies || {})) candidatePackages.add(d);
      for (const d of Object.keys(pkg.devDependencies || {})) candidatePackages.add(d);
    } catch {}
  }

  if (fs.existsSync(nmPath)) {
    try {
      for (const entry of fs.readdirSync(nmPath)) {
        if (entry.startsWith('.')) continue;
        if (entry.startsWith('@')) {
          const scopePath = path.join(nmPath, entry);
          try {
            for (const sub of fs.readdirSync(scopePath)) {
              if (!sub.startsWith('.')) candidatePackages.add(`${entry}/${sub}`);
            }
          } catch {}
        } else {
          candidatePackages.add(entry);
        }
      }
    } catch {}
  }

  const assigned = new Set<string>();
  const groupMap = new Map<string, string[]>();

  for (const group of groups) {
    if (!group || !group.name || !group.test) continue;
    const matched: string[] = [];

    for (const pkgName of candidatePackages) {
      if (assigned.has(pkgName)) continue;

      const fakePaths = [
        path.join(nmPath, ...pkgName.split('/'), 'index.js'),
        path.join(nmPath, ...pkgName.split('/')),
        path.join('node_modules', ...pkgName.split('/')),
        pkgName,
      ];

      if (fakePaths.some((fp) => isGroupMatch(fp, group.test)) && canResolvePackage(pkgName, root)) {
        matched.push(pkgName);
        assigned.add(pkgName);
      }
    }

    if (matched.length > 0) {
      groupMap.set(group.name, matched);
    }
  }

  return groupMap;
}

export interface CodeSplitPluginOptions {
  groups?: CodeSplitGroup[];
  codeSplitting?: { groups?: CodeSplitGroup[] };
  jsDir?: string;
  cssDir?: string;
  assetDir?: string;
}

/**
 * Code-splitting plugin for Bun.build.
 * Extracts designated groups into dedicated shared chunks.
 */
export function codeSplitPlugin(options: CodeSplitPluginOptions = {}): BavPlugin {
  const groups = options.groups || options.codeSplitting?.groups || [];

  return {
    name: 'bav:code-split',

    async configBun(ctx: PluginContext) {
      ctx.config.splitting = true;
      if (groups.length === 0) return;

      ctx.config.codeSplitGroups = groups;

      if (options.jsDir || options.cssDir || options.assetDir) {
        const jsDir = (options.jsDir || 'assets').replace(/\/+$/, '');
        const assetDir = (options.assetDir || 'assets').replace(/\/+$/, '');
        ctx.config.naming = {
          entry: `${jsDir}/[name]-[hash].[ext]`,
          chunk: `${jsDir}/chunk-[name]-[hash].[ext]`,
          asset: `${assetDir}/[name]-[hash].[ext]`,
        };
      }

      const chunkDir = path.resolve(ctx.root, '.bun-chunks');
      if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });

      const groupMap = findMatchingPackagesForGroups(groups, ctx.root);
      const extraEntries: string[] = [];

      for (const [groupName, packages] of groupMap.entries()) {
        const chunkFile = path.join(chunkDir, `${groupName}.js`);
        const code = packages
          .map((pkg, idx) => `import * as _${idx} from ${JSON.stringify(pkg)};\nexport { _${idx} };`)
          .join('\n');
        fs.writeFileSync(chunkFile, code, 'utf8');
        extraEntries.push(chunkFile);
      }

      ctx.config.extraEntrypoints = extraEntries;
    },

    buildComplete(_result: any, ctx: BuildCompleteContext) {
      const chunkDir = path.resolve(ctx.outDir ? path.dirname(ctx.outDir) : process.cwd(), '.bun-chunks');
      if (fs.existsSync(chunkDir)) {
        try {
          fs.rmSync(chunkDir, { recursive: true, force: true });
        } catch {}
      }
    },
  };
}

export default codeSplitPlugin;
