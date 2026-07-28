# ADR 0005 — Quality gate calibration after Phase 14 + 15 measurement

Date: 2026-05-10
Status: Accepted

## Context

Phase 14 introduced 11 quality gates with thresholds chosen from intuition.
Phase 15 ran them against rendered deterministic-baseline audio and surfaced
two calibration miscalibrations:

1. **`low_mid_to_mid_ratio > 1.5` is wrong for kick-led genres.** The Phase 14
   smoke run measured a ratio of 13.2 and flagged `mix_mud`. Phase 15 cleaned
   the chord layer (HPF 400 Hz, gain 0.25) and the ratio dropped to 8.86 —
   *but the per-section diagnostic shows this 8.86 comes from intro where the
   only active layer is kick.* The dirt-samples 909 kick has body energy
   centered at 200-400 Hz (low_mid band), not 500-2000 Hz (mid band). For any
   techno/house/dnb track where the kick dominates, low_mid > mid by design.

2. **`arrangement_arc_score ≥ 1 dB` is too strict for sub-12-bar tracks.** The
   gate compares mean energy_db of drop/main vs intro/outro. A 6-bar compact
   arrangement (1 intro + 4 main + 1 outro) has only one section per role,
   measured over 1-2 seconds each. The metric uses p95 windowed RMS, which is
   biased toward peaky-sparse signals (kick alone in intro produces high p95).
   On the captured smoke, main with full mix measured -18.8 dB mean RMS vs
   intro at -17.3 dB — the kick-only intro literally measured louder per-window
   because the full-mix bass + chord raised the floor without raising peaks.

## Decision

### Threshold updates

- `low_mid_to_mid_ratio` mud trigger: **1.5 → 8.0**.
  Justification: even on a clean techno mix, kick body alone produces ratios
  in the 6-10 range (measured: per-section diagnostic showed intro=8.86,
  main=10.56 with only the kick in intro and full mix in main). `mix_mud` should
  fire when low_mid is overwhelming mid (>8×), not when mid is correctly
  thinner than low which is genre-typical.

- `arrangement_arc_score` gate: **skip when `graph.song.total_bars < 12`.**
  Justification: an arrangement of 6-8 bars cannot meaningfully demonstrate
  intro→drop→outro contrast in mean-RMS terms when the kick pattern is
  identical across sections. Audit reports continue to surface the per-section
  diagnostic so the operator sees energy contour even when the gate is skipped.

### Severity tiers (Phase 15.7)

Each gate now reports a `severity_tier`:
- `hard` — production-blocking; audit cannot pass.
- `severe` — audit fails by default but warning-only with `--allow-severe`.
- `warning` — surfaced in report but does not fail the audit.
- `info` — diagnostic only.

Initial tier assignments:
- `non_silent_ratio` < 0.6 → **hard** (a silent renderer is a broken renderer)
- `true_peak_guard` > -1.0 dBTP → **severe** (post-render guard normally fixes; if it didn't, structural)
- `lufs_target_distance` > 4 LU → **severe**
- `lufs_target_distance` > 8 LU → **hard** (reasonable upper bound after post-render mix)
- `loop_fatigue_score` > 0.95 → **severe**
- `arrangement_arc_score` < threshold → **warning** (shape signal, not pass/fail)
- `section_energy_delta` < 3 dB → **warning** (same reason)
- `low_band_energy_floor` failing → **severe**
- `active_band_count` < 3 → **severe**
- `onset_count_floor` failing → **severe** for non-ambient genres, `warning` for ambient
- `feature_novelty_per_8_bars` failing → **warning**
- `stereo_low_mono_guard` failing → **severe**

Failure taxonomy categories inherit the worst tier of any gate that triggered them.

## Consequences

- The Phase 14 smoke `mix_mud` flag becomes a **warning** at the new ratio threshold,
  and the band-balance + gain-staging fixes still measurably reduce the ratio
  (12.5 → 6.2). The improvement is real even when the gate stops firing.
- `arrangement_arc` stops false-positive on smoke audits. Long-form audits
  (`genre-core` × 3 seeds with full-template arrangements) continue to gate on it.
- Audit reports gain a new "warnings" section separate from "hard failures".
- Audit pass/fail counts now treat warnings as soft. `audit:repair` shows both.

## Non-decision: post-render normalize stays strict

`masterNormalize` still refuses when LUFS gap requires gain that would push
peak above ceiling (`refuseStructuralFailure`). That refusal surfaces as
`hard_failures` and is the right behavior — it's the gate that tells us the
upstream gain-staging needs more work, not a knob to silence.
