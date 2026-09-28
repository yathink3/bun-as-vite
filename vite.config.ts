import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    target: 'node18',
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        'plugins/index': resolve(import.meta.dirname, 'src/plugins/index.ts'),
        'plugins/codeSplit': resolve(import.meta.dirname, 'src/plugins/codeSplit.ts'),
        'plugins/proxyRedirects': resolve(import.meta.dirname, 'src/plugins/proxyRedirects.ts'),
        'plugins/customConfig': resolve(import.meta.dirname, 'src/plugins/customConfig.ts'),
        'plugins/envLoader': resolve(import.meta.dirname, 'src/plugins/envLoader.ts'),
        'plugins/buildScorer': resolve(import.meta.dirname, 'src/plugins/buildScorer.ts'),
        'plugins/tailwindcss': resolve(import.meta.dirname, 'src/plugins/tailwindcss.ts'),
        'plugins/bunPlugin': resolve(import.meta.dirname, 'src/plugins/bunPlugin.ts'),
        'plugins/legacyConfig': resolve(import.meta.dirname, 'src/plugins/legacyConfig.ts'),
        'plugins/publicCssManage': resolve(import.meta.dirname, 'src/plugins/publicCssManage.ts'),
        'plugins/buildLogModifier': resolve(import.meta.dirname, 'src/plugins/buildLogModifier.ts'),
        cli: resolve(import.meta.dirname, 'src/cli.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [
        'bun',
        /^node:.*/,
        'fs',
        'path',
        'url',
        'crypto',
        'http',
        'https',
        'events',
        'stream',
        'os',
        'child_process',
        'buffer',
        'net',
        'tls',
        'zlib',
        '@tailwindcss/node',
        '@tailwindcss/oxide',
      ],
    },
    sourcemap: false,
    minify: false,
    emptyOutDir: true,
  },
});
