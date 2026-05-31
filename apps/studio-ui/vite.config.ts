import { defineConfig } from 'vite';
import path from 'node:path';
import { artifactApi } from './src/server/artifact-api.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const PORT = Number.parseInt(process.env.STUDIO_UI_PORT || '5174', 10);

export default defineConfig({
  base: './',
  plugins: [artifactApi({ repoRoot: REPO_ROOT })],
  server: {
    port: Number.isFinite(PORT) && PORT > 0 ? PORT : 5174,
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
