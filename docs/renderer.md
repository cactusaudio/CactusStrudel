# Renderer

## Overview

Two pieces:

1. `apps/renderer-page` — Vite static page that imports `@strudel/web` and exposes `window.__cactusRender`.
2. `packages/renderer` — Node module that boots the page in headless chromium via Playwright and harvests PCM through `page.evaluate`.

## Render path (offline)

1. Page boot calls `initStrudel()` which warms up samples + worklets in the live `AudioContext`.
2. `__cactusRender({code, durationCycles, cps, sampleRate})` is called by the driver.
3. Page evaluates the user code via `evaluate(code, false)` (autoplay disabled) → Pattern.
4. Page closes the live context, swaps in `OfflineAudioContext(2, frames, sampleRate)`, calls `setAudioContext` + reinstantiates `SuperdoughAudioController` + `initAudio`.
5. Page queries the pattern's haps in `[0, durationCycles]`, sorted by onset, and dispatches each through `superdough()`.
6. `offlineCtx.startRendering()` returns the rendered AudioBuffer.
7. Page extracts interleaved Float32 PCM and base64-encodes for transport.

The driver decodes the base64 → Float32Array → WAV via `wavefile` (32-bit float WAV).

This is **adapted from `@strudel/webaudio`'s `renderPatternAudio`** (AGPL-3.0-or-later) — same scheduling logic, but it returns the raw buffer instead of triggering a browser download.

## Realtime fallback

Not yet implemented. If `OfflineAudioContext` rendering fails for a particular Strudel feature (rare but possible for time-varying audio worklets), the planned fallback is `AudioContext` + `MediaStreamAudioDestinationNode` + an AudioWorkletNode that captures interleaved Float32 PCM. Tracked as a TODO; falls in scope only if a Phase-9 stress test surfaces it.

## Stem export (orbit-isolated re-renders)

Per ADR 0004, stems are produced by N renders with the IR's `solo` option set to each orbit. The compiler emits `.gain(0)` on every layer except the soloed orbit. The driver loops over orbits and writes one WAV per stem.

## Determinism

`OfflineAudioContext` is deterministic per browser version. WAV output for the same input is byte-equal across runs of the same chromium build. Different chromium versions can produce sample-level differences in audio worklet behavior; we record `chromium-1217` as the pinned version (see `~/Library/Caches/ms-playwright`).

## Run conformance tests

```bash
CACTUS_RENDER_E2E=1 pnpm test
```

This boots the renderer once, runs each test against the shared handle, and tears down at the end. Without the env flag, conformance tests are skipped (so day-to-day pnpm test stays fast).

## Headless flags

`--no-sandbox` (CI / containers), `--use-fake-ui-for-media-stream`, `--autoplay-policy=no-user-gesture-required`. SharedArrayBuffer requires COOP+COEP headers — the vite config sets them.
