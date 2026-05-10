import { defineConfig } from 'vite';
import path from 'node:path';
import { artifactApi } from './src/server/artifact-api.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

export default defineConfig({
  base: './',
  plugins: [artifactApi({ repoRoot: REPO_ROOT })],
  server: {
    port: 5174,
    fs: {
      allow: [REPO_ROOT],
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
  },
});
