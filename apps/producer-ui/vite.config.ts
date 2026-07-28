import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const API_TARGET = process.env.CACTUS_API_TARGET || 'http://127.0.0.1:8765';

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/runtime/app/',
  plugins: [preact()],
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': API_TARGET,
      '/producer-brain': API_TARGET,
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    outDir: '../../runtime/app',
    emptyOutDir: true,
  },
}));
