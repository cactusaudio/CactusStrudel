# SessionGraph operations (historical research)

These commands exercise the TypeScript research substrate. They are not the
live v3 Producer UI or `/api/v2` operating surface. Current operations are in
`docs/operations.md`.

## Run modes (CLI)

```bash
# Generate a track
pnpm cactus produce -b 'dark dub techno 130 BPM'           # render + analyze + report
pnpm cactus produce -b 'dark dub techno 130 BPM' --no-render  # graph + code only

# Multiple candidates with seed fan-out
pnpm cactus sketch -b 'peak time techno 134 BPM' -n 5

# Revise via natural-language feedback
pnpm cactus revise -s <session_uuid> -f 'punchier kick, brighter hats'

# Per-orbit stems (one WAV per orbit)
pnpm cactus stems -s <session_uuid>

# Show why the system made choices
pnpm cactus explain -s <session_uuid>

# Inspect taste memory across all sessions
pnpm cactus taste

# Studio UI (read-only viewer)
pnpm dev:renderer    # renderer-page on :5173 (used by render flow)
pnpm --filter @cactus/studio-ui dev   # studio UI on :5174
```

## Session bundle layout

```
sessions/<session_uuid>/
├── iter_0000.json          ← canonical SessionGraph
├── iter_0000.strudel.js    ← compiled deterministic Strudel
├── iter_0000.wav           ← rendered audio (32-bit float, stereo)
├── iter_0000.features.json ← AnalyzerFeatures (spectral / rhythmic / loudness / stereo)
├── iter_0000.report.md     ← human-readable summary
├── iter_0001.json          ← (after revise/loop)
└── stems/
    ├── stem_orbit_0__kick.wav
    ├── stem_orbit_1__hat.wav
    └── ...
```

## Render performance

- OfflineAudioContext path: ~3.5s per 4-second render (faster than realtime).
- Browser process is shared across renders within a single invocation (refcount-managed).
- 5-sketch + 4-revision loop ≈ 30 renders × 3.5s ≈ 105s wall clock.

## Network requirements

- Renderer-page bundles `@strudel/web` locally; no live strudel.cc dependency.
- Default sample bank (`bd`, `hh`, `cp`, etc.) loads via `samples('github:tidalcycles/dirt-samples')`
  on first init. Without network, synth-based patterns (`note(...).s('sawtooth')`) still work.

## Determinism

- Same `--seed` + same brief → byte-equal `pattern_bank` (verified by tests).
- Same SessionGraph → byte-equal Strudel code (compiler is deterministic).
- Same Strudel code → near-deterministic WAV (chromium-1217 OfflineAudioContext; jitter < 1ms).

## License obligations (AGPL-3.0-or-later)

- Distributing this code as a network service triggers AGPL §13.
- Internal Cactus use (Bowei's machines, private servers) is unaffected.
- See ADR 0001 for context.
