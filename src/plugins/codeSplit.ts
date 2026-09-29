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
   * Output sub-directory name for JavaScript chunks.
   * @default 'j'
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
 * Code-splitting & structured output plugin for Bun.build.
 *
 * Produces output layout matching vite-plugins-library's codeSplitPlugin:
 *   - JS chunks  ->  <outDir>/<jsDir>/     (default: j/)
 *   - CSS chunks ->  <outDir>/<cssDir>/    (default: c/)
 *   - Assets     ->  <outDir>/<assetDir>/  (default: a/)
 *
 * Groups node_modules into named shared chunks via virtual entry files,
 * mirroring Vite's manualChunks behaviour.
 */
export function codeSplitPlugin(options: CodeSplitPluginOptions = {}): BavPlugin {
  const jsDir    = (options.jsDir    || 'j').replace(/\/+$/, '');
  const cssDir   = (options.cssDir   || 'c').replace(/\/+$/, '');
  const assetDir = (options.assetDir || 'a').replace(/\/+$/, '');

  const safeExts    = options.safeExtensions ? new Set(options.safeExtensions) : DEFAULT_SAFE_EXTS;
  const maxAssetLen = options.maxAssetChunkNameLength ?? 25;
  const maxJsLen    = options.maxJsChunkNameLength    ?? 20;

  const groups: CodeSplitGroup[] = options.groups || options.codeSplitting?.groups || [];

  // Track chunk-dir path so buildComplete can clean it up
  let chunkDir = '';

  return {
    name: 'bav:code-split',

    // ── configBun ─────────────────────────────────────────────────────────────
    async configBun(ctx: PluginContext) {
      ctx.config.splitting = true;
      ctx.config.codeSplitGroups = groups;

      // Set Bun naming patterns to place files in sub-directories.
      // Bun naming tokens: [name], [hash], [ext]
      ctx.config.naming = {
        entry: `${jsDir}/[name]-[hash].[ext]`,
        chunk: `${jsDir}/[name]-[hash].[ext]`,
        asset: `${assetDir}/[name]-[hash].[ext]`,
      };

      if (groups.length === 0) return;

      // Create virtual entry files per group so Bun emits them as dedicated
      // shared chunks — mirrors Vite manualChunks.
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
    buildComplete(result: any, ctx: BuildCompleteContext) {
      const outDir = ctx.outDir || path.resolve(process.cwd(), 'build');

      // ── Reorganise output files into j / c / a sub-directories ─────────────
      try {
        const allOutputs: Array<{ path: string; kind: string }> =
          result?.outputs ?? ctx.outputs ?? [];

        for (const out of allOutputs) {
          if (!out?.path) continue;
          const filePath = out.path;
          if (!fs.existsSync(filePath)) continue;

          const ext    = path.extname(filePath).slice(1).toLowerCase();
          const curDir = path.dirname(filePath);

          // Skip files already in the right sub-directory
          const relDir = path.relative(outDir, curDir);
          if (relDir === jsDir || relDir === cssDir || relDir === assetDir) continue;

          let targetSubDir: string;
          let targetName: string;

          if (ext === 'css') {
            // CSS -> cssDir/<name>-<hash>.css
            const nameRaw  = path.basename(filePath, '.css');
            const hash     = nameRaw.match(/-([A-Z0-9]{8})$/i)?.[1] ?? '';
            const namePart = nameRaw
              .replace(/-[A-Z0-9]{8}$/i, '')
              .slice(0, maxJsLen)
              .toLowerCase();
            targetSubDir = cssDir;
            targetName   = hash ? `${namePart}-${hash}.css` : `${namePart}.css`;

          } else if (ext === 'js' || ext === 'mjs') {
            // JS -> jsDir/<name>-<hash>.js
            const nameRaw  = path.basename(filePath, `.${ext}`);
            const hash     = nameRaw.match(/-([A-Z0-9]{8})$/i)?.[1] ?? '';
            const namePart = nameRaw
              .replace(/-[A-Z0-9]{8}$/i, '')
              .slice(0, maxJsLen)
              .toLowerCase();
            targetSubDir = jsDir;
            targetName   = hash ? `${namePart}-${hash}.${ext}` : `${namePart}.${ext}`;

          } else if (ext === 'map') {
            // Source maps stay alongside their source — skip
            continue;

          } else if (safeExts.has(ext)) {
            // Static assets -> assetDir/<name>.<ext>
            const namePart = path
              .basename(filePath, path.extname(filePath))
              .replace(/-[A-Z0-9]{8}$/i, '')
              .slice(0, maxAssetLen)
              .toLowerCase();
            targetSubDir = assetDir;
            targetName   = `${namePart}.${ext}`;

          } else {
            continue; // unknown type — leave in place
          }

          const targetDirAbs = path.join(outDir, targetSubDir);
          fs.mkdirSync(targetDirAbs, { recursive: true });

          let dest = path.join(targetDirAbs, targetName);
          // Avoid clobbering if names collide
          if (fs.existsSync(dest)) {
            dest = dest.replace(`.${ext}`, `-1.${ext}`);
          }

          fs.renameSync(filePath, dest);
        }

        // Clean up empty leftover directories inside outDir
        _cleanEmptyDirs(outDir, outDir);
      } catch {
        // Non-fatal — reorganisation is best-effort
      }

      // ── Remove temporary .bun-chunks dir ───────────────────────────────────
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

/** Recursively remove empty directories inside `root`, leaving `root` itself. */
function _cleanEmptyDirs(dir: string, root: string): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  for (const entry of fs.readdirSync(dir)) {
    _cleanEmptyDirs(path.join(dir, entry), root);
  }
  if (dir !== root) {
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {}
  }
}

export default codeSplitPlugin;
