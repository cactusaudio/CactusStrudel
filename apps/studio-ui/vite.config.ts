import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  base: './',
  server: {
    port: 5174,
    fs: {
      allow: [path.resolve(import.meta.dirname, '..', '..')],
    },
    proxy: {
      // Serve session bundles from sessions/ directory.
      '/sessions': {
        target: `file://${path.resolve(import.meta.dirname, '..', '..', 'sessions')}`,
        rewrite: (p) => p.replace(/^\/sessions/, ''),
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
