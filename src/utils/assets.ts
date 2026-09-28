import path from 'path';
import fs from 'fs';

/**
 * Rewrites relative url(...) values inside a CSS string to root-relative web paths.
 */
export function rewriteCssUrls(css: string, cssFilePath: string, rootDir: string): string {
  const cssDir = path.dirname(cssFilePath);
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g, (match, _quote, urlValue) => {
    const trimmed = urlValue.trim();
    if (
      trimmed.startsWith('data:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('#')
    ) {
      return match;
    }
    const [cleanUrl, queryOrHash] = trimmed.split(/([?#].*)/);
    const resolvedPath = path.resolve(cssDir, cleanUrl);
    if (fs.existsSync(resolvedPath)) {
      const relToRoot = '/' + path.relative(rootDir, resolvedPath).replace(/\\/g, '/');
      const finalUrl = queryOrHash ? relToRoot + queryOrHash : relToRoot;
      return `url("${finalUrl}")`;
    }
    return match;
  });
}

export interface ResolveStaticAssetOptions {
  root?: string;
  srcDir?: string;
  publicDir?: string;
}

/**
 * Resolves a static asset (font, image, …) that may be requested at a path
 * unrelated to where the file physically lives on disk.
 */
export function resolveStaticAsset(
  pathname: string,
  { root, srcDir, publicDir }: ResolveStaticAssetOptions = {}
): string | null {
  const rootDir = root || process.cwd();
  const src = srcDir || path.join(rootDir, 'src');
  const pub = publicDir || path.join(rootDir, 'public');

  function tryFile(candidate: string): string | null {
    if (fs.existsSync(candidate)) {
      try {
        if (!fs.statSync(candidate).isDirectory()) return candidate;
      } catch {}
    }
    return null;
  }

  return (
    tryFile(path.join(rootDir, pathname)) ||
    tryFile(path.join(pub, pathname)) ||
    tryFile(path.join(src, pathname)) ||
    (() => {
      const fontIdx = pathname.indexOf('/fonts/');
      if (fontIdx !== -1) return tryFile(path.join(src, 'fonts', pathname.slice(fontIdx + 7)));
      return null;
    })() ||
    (() => {
      const assetIdx = pathname.indexOf('/assets/');
      if (assetIdx !== -1) return tryFile(path.join(src, 'assets', pathname.slice(assetIdx + 8)));
      return null;
    })() ||
    (() => {
      const ext = path.extname(pathname).toLowerCase();
      const FONT_EXTS = new Set(['.woff', '.woff2', '.ttf', '.eot', '.otf', '.svg']);
      if (FONT_EXTS.has(ext)) return tryFile(path.join(src, 'fonts', path.basename(pathname)));
      return null;
    })() ||
    null
  );
}
