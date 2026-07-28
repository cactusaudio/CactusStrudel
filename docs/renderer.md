# Production renderer

## Current path

```text
Strudel source
  → apps/render-worker/src/auto-render.ts
  → Acorn AST timing extraction
  → packages/renderer
  → apps/renderer-page
  → Strudel realtime scheduler capture
  → temporary capture WAV
  → FFmpeg peak normalization + 256 kbps MP3
  → decode that final MP3 to a temporary WAV
  → optional packages/analyzer descriptive features
  → immutable asset promotion + SQLite registration
```

Production explicitly uses `realtime: true` so capture follows the same
cyclist/superdough scheduling path as live Strudel playback. Offline rendering
is not the production-quality authority. Peak normalization does not trim the
timeline: authored opening rests remain in the delivered audio.

## Browser page

`apps/renderer-page` loads pinned npm `@strudel/*` source entrypoints through
Vite aliases. This avoids duplicated WebAudio controller instances and lets
capture tap the live superdough output graph.

The renderer driver previews `apps/renderer-page/dist/` only when current task
inputs and the complete output tree match its controlled build receipt. After
Vite preview starts, the driver also compares the served bytes with that
receipt. Missing, stale, malformed or drifted evidence selects current-source
Vite instead. A failed preview is fully stopped before the same port can be
reused for source fallback.

## Driver lifecycle

`packages/renderer`:

- starts Vite on a strict, collision-resistant port;
- verifies build and served identities before using preview output;
- prefers installed Chrome and falls back to Playwright Chromium;
- disables background timer throttling for realtime scheduling;
- reuses a warmed browser/page where requested;
- writes a WAV and returns duration/channel metadata plus transient
  `packageVersions`;
- shuts down browser and Vite processes explicitly.

Concurrent workers use separate temporary WAV paths and renderer ports.
`packageVersions` is returned by `packages/renderer`, but the render worker does
not currently persist it in the immutable asset or model-run receipt. Treat it
as in-process diagnostic metadata, not durable revision provenance.

## Worker post-processing

The render worker:

- parses JavaScript with Acorn and extracts one unconditional
  `setcps()`/`setcpm()` authority without evaluating model code;
- accepts numeric literals, decimals, parentheses and simple `+`, `-`, `*`,
  `/` arithmetic for tempo and `arrange()` durations;
- ignores comments and strings naturally through the AST;
- uses `0.5` cps or 48 cycles only when the corresponding construct is absent;
- fails explicitly when present tempo or `arrange()` timing is dynamic or
  ambiguous instead of silently rendering with a fallback;
- captures realtime WAV;
- peak-normalizes to `-1 dB` and encodes 256 kbps MP3 without removing leading
  silence;
- decodes the exact final MP3 to a temporary WAV, then attempts descriptive
  features as optional evidence;
- probes duration and prints diagnostics.

Durable truth does not parse success from a friendly log line. The API verifies
process exit, non-empty MP3, features when present, hashes and duration before
asset promotion. Feature-analysis failure is surfaced as unavailable but does
not invalidate otherwise usable audio. Capture and final-MP3 analysis WAVs are
temporary and are cleaned on both success and handled failure.

The Python render owner writes worker stdout/stderr to bounded staging logs
instead of unread pipes. It enforces a 600-second wall deadline by default
(`CACTUS_RENDER_WALL_TIMEOUT_SECONDS` may explicitly override it), and every
cancel/timeout path terminates the process group, waits for it, and removes
staging/log residue.

## Verification

For source-only changes:

```bash
pnpm vitest run packages/strudel-validator packages/renderer packages/analyzer
pnpm --filter @cactus/strudel-validator typecheck
pnpm --filter @cactus/renderer-page build
node scripts/build-receipt.mjs check renderer-page
pnpm --filter @cactus/render-worker typecheck
```

When scheduler, capture tap, browser boot, FFmpeg chain or dependency versions
change, add one short non-silent real render. That proves mechanics only;
Bowei still judges the music.

Focused smoke input: `tests/fixtures/render-smoke.strudel.js`. Keep the
generated MP3/features out of source after readback.
