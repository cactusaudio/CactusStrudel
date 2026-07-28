import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// The newer engine imports AudioWorklets as `*.mjs?audioworklet`; the
// monorepo's own vite plugin bundles those into a data-URL default
// export. Without it the page never boots ("does not provide an export
// named 'default'"). Same plugin packages/repl/vite.config.js uses.
// @ts-expect-error — upstream plugin ships JavaScript without declarations.
import bundleAudioWorkletPlugin from 'vite-plugin-bundle-audioworklet';

const APP = fileURLToPath(new URL('.', import.meta.url));
const STRUDEL = path.resolve(APP, 'node_modules', '@strudel');

export default defineConfig({
  base: './',
  plugins: [bundleAudioWorkletPlugin()],
  // Consume the source entrypoints shipped inside the pinned npm packages.
  // The published dist bundles otherwise create a second webaudio/controller
  // instance when @strudel/web and @strudel/webaudio are imported together,
  // leaving realtime capture attached to a silent graph.
  resolve: {
    alias: [
      { find: /^@strudel\/web$/, replacement: path.join(STRUDEL, 'web', 'web.mjs') },
      { find: /^@strudel\/webaudio$/, replacement: path.join(STRUDEL, 'webaudio', 'index.mjs') },
      { find: /^@strudel\/core$/, replacement: path.join(STRUDEL, 'core', 'index.mjs') },
      { find: /^@strudel\/mini$/, replacement: path.join(STRUDEL, 'mini', 'index.mjs') },
      { find: /^@strudel\/tonal$/, replacement: path.join(STRUDEL, 'tonal', 'index.mjs') },
      { find: /^@strudel\/transpiler$/, replacement: path.join(STRUDEL, 'transpiler', 'index.mjs') },
      { find: /^@strudel\/soundfonts$/, replacement: path.join(STRUDEL, 'soundfonts', 'index.mjs') },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: { output: { format: 'es' } },
  },
});
