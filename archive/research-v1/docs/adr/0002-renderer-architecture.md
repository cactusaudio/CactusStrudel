# ADR 0002 — Renderer: self-hosted vite page + Playwright

Date: 2026-05-10
Status: Accepted

## Context

Strudel ships no Node-headless renderer. Audio is generated through Web Audio in a browser. `strudel.cc` has an export tab but is UI-coupled, networked, and undeterministic for batch.

## Decision

`apps/renderer-page` is a Vite static page that:

1. Loads `@strudel/web` via npm.
2. Exposes `window.__cactusRender({ code, durationCycles, sampleRate, options })` returning a Promise that resolves to a Float32Array (or PCM buffer over a transferable channel).
3. Tries `OfflineAudioContext` first (faster than realtime, deterministic timing).
4. Falls back to a realtime `AudioContext` + `createMediaStreamDestination` + `MediaRecorder` capture for cases where Strudel's scheduler does not run inside `OfflineAudioContext`.

`packages/renderer` is a Node module that:

1. Boots the renderer-page either as a built static asset served from disk by Playwright's `route` handler or via a tiny in-process server.
2. Drives Playwright (chromium, headless, audio enabled via `--use-fake-ui-for-media-stream` and `--autoplay-policy=no-user-gesture-required`).
3. Calls `__cactusRender(...)` and decodes the result into WAV via `wavefile`.
4. Returns `RenderResult { wavPath, sampleRate, durationSec, channels, packageVersions, warnings }`.

## Consequences

- Pure static asset; no live web requests during render.
- Deterministic when offline path works; near-deterministic when realtime fallback used (jitter < 5ms).
- Stem export by orbit done by repeated renders with `solo: orbit_id` flag in the IR (see ADR 0004).
- No dependency on strudel.cc availability.
