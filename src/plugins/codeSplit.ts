import path from 'path';
import fs from 'fs';
import type { BavPlugin, CodeSplitGroup, PluginContext, BuildCompleteContext } from '../types';

export type { CodeSplitGroup };

// ─── Default Safe Extensions ──────────────────────────────────────────────────

const DEFAULT_SAFE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'ico', 'avif',
  'ttf', 'woff', 'eot', 'woff2', 'xlsx',
]);

// ─── Options ──────────────────────────────────────────────────────────────────

export interface CodeSplitPluginOptions {
  /**
   * Custom code splitting groups to match node_modules or source modules into named chunks.
   */
  groups?: CodeSplitGroup[];
  /**
   * Alternative codeSplitting object structure ({ groups: CodeSplitGroup[] }).
   */
  codeSplitting?: { groups?: CodeSplitGroup[] };
  /**
   * Output sub-directory name for JavaScript entry-point files.
   * NOTE: Bun only embeds the naming subdirectory in import URLs for entry-points,
   * NOT for auto-generated dynamic chunks. Do not set this if your app relies on
   * React.lazy() or other dynamic imports — chunk URLs will omit the prefix and 404.
   * Leave unset to use the default flat assets/ structure which is always safe.
   */
  jsDir?: string;
  /**
   * Output sub-directory name for CSS chunks.
   * @default 'c'
   */
  cssDir?: string;
  /**
   * Output sub-directory name for static asset files.
   * @default 'a'
   */
  assetDir?: string;
  /**
   * File extensions recognized as static assets moved into assetDir.
   * @default ['png','jpg','jpeg','svg','gif','webp','ico','avif','ttf','woff','eot','woff2','xlsx']
   */
  safeExtensions?: string[];
  /**
   * Maximum character length for asset chunk names.
   * @default 25
   */
  maxAssetChunkNameLength?: number;
  /**
   * Maximum character length for JS and CSS chunk names.
   * @default 20
   */
  maxJsChunkNameLength?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isGroupMatch(id: string, test: RegExp | string | ((id: string) => boolean)): boolean {
  if (typeof test === 'function') {
    try { return Boolean(test(id)); } catch { return false; }
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

/**
 * Scans node_modules against each group's test and returns a map of
 * groupName -> matched package names.
 */
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

// ─── Plugin ───────────────────────────────────────────────────────────────────

/**
 * Code-splitting plugin for Bun.build.
 *
 * - Enables Bun's native code splitting (`splitting: true`)
 * - Groups designated node_modules into named shared entry-point files via virtual
 *   re-export stubs (.bun-chunks/), mirroring Vite's manualChunks behaviour.
 *
 * ### Why no j/c/a directory naming for chunks?
 *
 * Bun embeds import() URLs at bundle time using:
 *   `publicPath + chunkFilename`  (filename only, no subdir prefix)
 *
 * So setting `naming.chunk = 'j/[name]-[hash].js'` writes the file to `j/` but
 * generates import URLs as `/[name]-[hash].js` (no j/) — causing 404s on deploy.
 * Entry-points ARE correctly prefixed because their URLs come from index.html, not
 * embedded imports. Chunks (React.lazy splits, dynamic import()) must stay flat.
 *
 * If you pass `jsDir`, it is applied only to the naming.entry pattern (group
 * entry-point files). Chunks always use the flat default from the shims config.
 */
export function codeSplitPlugin(options: CodeSplitPluginOptions = {}): BavPlugin {
  const groups: CodeSplitGroup[] = options.groups || options.codeSplitting?.groups || [];

  // Track chunk-dir path so buildComplete can clean it up
  let chunkDir = '';

  return {
    name: 'bav:code-split',

    // ── configBun ─────────────────────────────────────────────────────────────
    async configBun(ctx: PluginContext) {
      ctx.config.splitting = true;
      ctx.config.codeSplitGroups = groups;

      // NOTE: We deliberately do NOT override naming.chunk or naming.asset here.
      // Bun only propagates the naming subdirectory into the public URL for
      // entry-point files; dynamic chunk import() URLs omit the prefix, causing
      // the browser to fetch /chunk-HASH.js instead of /j/chunk-HASH.js.
      // The shims default (assets/[name]-[hash].[ext]) is always safe.

      if (groups.length === 0) return;

      // Create virtual re-export entry files per group so Bun emits them as
      // dedicated shared entry-point bundles — mirrors Vite manualChunks.
      chunkDir = path.resolve(ctx.root, '.bun-chunks');
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

      ctx.config.extraEntrypoints = [
        ...(ctx.config.extraEntrypoints || []),
        ...extraEntries,
      ];
    },

    // ── buildComplete ─────────────────────────────────────────────────────────
    buildComplete(_result: any, ctx: BuildCompleteContext) {
      // Only clean up the temporary .bun-chunks virtual entry directory.
      // We do NOT move any output files because Bun bakes import() URLs at
      // build time. Moving files post-build would break those embedded URLs.
      const resolvedChunkDir = chunkDir || path.resolve(
        ctx.outDir ? path.dirname(ctx.outDir) : process.cwd(),
        '.bun-chunks',
      );
      if (fs.existsSync(resolvedChunkDir)) {
        try { fs.rmSync(resolvedChunkDir, { recursive: true, force: true }); } catch {}
      }
    },
  };
}

export default codeSplitPlugin;
