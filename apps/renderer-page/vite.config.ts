import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// The newer engine imports AudioWorklets as `*.mjs?audioworklet`; the
// monorepo's own vite plugin bundles those into a data-URL default
// export. Without it the page never boots ("does not provide an export
// named 'default'"). Same plugin packages/repl/vite.config.js uses.
// @ts-expect-error — JS plugin from the (gitignored) monorepo, no types.
import bundleAudioWorkletPlugin from '../../refs/strudel-monorepo/packages/vite-plugin-bundle-audioworklet/vite-plugin-bundle-audioworklet.js';

// Option-3 (Bowei 2026-05-18): the renderer-page consumes the LIVE
// strudel.cc engine from codeberg.org/uzu/strudel (refs/strudel-monorepo,
// ~2026-05-07 source — newer than npm 1.3.0), so unconstrained idiomatic
// Strudel (.stutter/.subdivide/.mod/gm_*/.bank()/super*) renders
// faithfully offline. Pinned compiler/validator packages untouched —
// only this app's @strudel resolves to the monorepo.
const APP = fileURLToPath(new URL('.', import.meta.url));
const REPO = path.resolve(APP, '..', '..');
const MONO = path.resolve(REPO, 'refs', 'strudel-monorepo', 'packages');

export default defineConfig({
  base: './',
  plugins: [bundleAudioWorkletPlugin()],
  resolve: {
    alias: [
      // @strudel/web + @strudel/sampler have NO package.json main — point
      // straight at the entry file. (ordered: specific before regex)
      { find: '@strudel/web', replacement: `${MONO}/web/web.mjs` },
      { find: '@strudel/sampler', replacement: `${MONO}/sampler/sample-server.mjs` },
      // every other @strudel/<pkg> resolves via package.json main=index.mjs
      { find: /^@strudel\/([^/]+)$/, replacement: `${MONO}/$1` },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    // vite refuses to serve files outside the project root by default;
    // the monorepo source lives outside apps/renderer-page.
    fs: { allow: [REPO] },
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
    sourcemap: true,
    rollupOptions: { output: { format: 'es' } },
  },
  // Source ESM consumed via alias — don't prebundle (avoids stale copies).
  optimizeDeps: {
    exclude: [
      '@strudel/core', '@strudel/mini', '@strudel/tonal', '@strudel/transpiler',
      '@strudel/webaudio', '@strudel/superdough', '@strudel/soundfonts', '@strudel/web',
    ],
  },
});
