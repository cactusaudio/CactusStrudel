# Phase 14 smoke failure — captured baseline

This document preserves the failure modes the Phase 14 adversarial harness
surfaced against the deterministic rules champion at commit `8ea8af8`. Phase 15
is the response.

## Prompt

```
peak time techno 130 BPM, 10 seconds
```

Suite: `smoke`. Seed: 1. Backend: `rules`. Renderer: OfflineAudioContext via
self-hosted Strudel page.

## Captured artifacts

`tests/fixtures/regressions/phase14-smoke-techno/`:

| File | Source |
|---|---|
| `session-graph.json` | `buildSessionGraphFromBrief(parseBrief(brief), {seed: 1})` |
| `compiled.strudel.js` | `compileSessionGraph(graph)` |
| `features.json` | `analyzeWav(rendered.wav)` |
| `quality-gates.json` | `runQualityGates({...})` against rendered WAV |
| `audit-report.md` | `pnpm cactus audit --suite smoke --seeds 1` |
| `audit-summary.json` | as above |
| `genre-confusion.json` | as above |
| `failure.json` | per-render failure dossier |

The rendered WAV itself is *not* checked in (4 layer × ~30s × 32-bit float
stereo = 11.3 MB). Replays should regenerate it from `compiled.strudel.js`
through `packages/renderer`.

## Measured failure modes

| Gate / signal | Value | Threshold | Tier |
|---|---|---|---|
| `non_silent_ratio` | 0.383 | ≥ 0.6 | **hard** |
| `true_peak_guard` | -0.06 dBTP | ≤ -1 dBTP | **severe** |
| `lufs_target_distance` | 10.3 LU | ≤ 4 LU | **severe** |
| low_mid / mid band-RMS | 13.2 | < 1.5 | **severe** (mix_mud) |
| genre confusion top1 | `idm` | `techno` | **severe** (genre_collapse) |

## Root causes (recorded for accountability)

1. **`buildSong` over-allocates total_bars for short briefs.** A 10-second
   brief at 130 BPM needs ~5.4 cycles, but `buildSessionGraphFromBrief` clamps
   the section-template scale to a 0.5 minimum, producing a 64-bar arrangement
   regardless. The audit then renders the first 16 bars (~30 s of audio), which
   is dominated by `intro` (8 bars) + `build_a` (4 bars), where most layers
   are inactive by activation policy. Intro is sparse kick only.

2. **`activationFor` makes intro a single-layer event.** `kick` is the only
   layer active during `function: intro`. The kick pattern from the techno
   cookbook is `bd ~ ~ ~ bd ~ ~ ~` (25% step density). Combined with kick body
   decay (~150-300 ms), that produces a non-silent ratio well below 0.6.

3. **No master limiter / loudness normalizer is wired into the audit render
   path.** `packages/mastering` exists with a working `masterTrack`, but
   `runAudit` calls `render(...)` and then analyzes the raw WAV. True peak and
   LUFS land wherever superdough's gain staging put them, not at genre target.

4. **No deterministic mix gain staging at the graph level.** Layer gains are
   genre-defaulted only via `defaultEffectsForRole` (filters) and orbit `gain`
   set in `buildMixGraph`, but no balancing logic prevents sub + low + low_mid
   pile-up. The chord layer ('stab') uses a square wave through `lpf(1200)`,
   which dumps energy in the 250-500 Hz band on top of the kick body.

5. **Genre confusion uses pure rubric distance.** Without one-vs-rest
   discriminators, IDM (BPM range 120-160, broad centroid 1500-3500) absorbs
   any techno-like rendering whose spectral profile drifted bright. The
   captured render hit centroid ≈ 1900 Hz which IDM's rubric fits as well as
   techno's.

## Phase 15 acceptance contract

| Check | Target |
|---|---|
| `non_silent_ratio` for techno smoke | ≥ 0.6 |
| `true_peak_guard` | ≤ -1 dBTP |
| `lufs_target_distance` | ≤ 3 LU |
| Genre top-1 for techno smoke | `techno` (or non-IDM with cited evidence) |
| Audit report | still surfaces *real* failures; does not rubber-stamp |
| `pnpm test` | green |
| `pnpm cactus audit:repair` | runnable from fresh shell |

If a measurement seems wrong (false positive on a working render), the change
must go through an ADR — not a quiet threshold tweak.
