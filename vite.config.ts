import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    target: 'node18',
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        'plugins/index': resolve(import.meta.dirname, 'src/plugins/index.ts'),
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
