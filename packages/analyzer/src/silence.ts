// Gap1 (measurement trust): single source of truth for silence detection.
//
// Before this module, non_silent_ratio was computed in two places
// (quality-gates.ts + section-diagnostics.ts) with a duplicated window
// loop and a HARD threshold: `db > -55 ? non-silent : silent`. The
// renderer's offline WebAudio path is byte-nondeterministic at the
// sub-perceptual level (verified: same graph + same seed, 4 renders →
// identical LUFS/centroid/onset to 4 decimals, but different WAV bytes).
// For sparse content (dub_techno chord tails, reverb decay, breakdown
// space) many 50 ms windows sit within ~2-4 dB of the -55 floor, so the
// sub-perceptual jitter flips ~12% of windows per render → non_silent_ratio
// swings by up to 0.12 → the hard_fail verdict flaps PASS/FAIL on identical
// input.
//
// Fix: a Schmitt-trigger (hysteresis) decision. A window is non-silent
// once RMS exceeds FLOOR_HIGH and stays non-silent until RMS drops below
// FLOOR_LOW. Jitter inside the band cannot flip a window because the
// decision is sticky. The band (4 dB) is wider than the measured render
// noise, so the metric is stable by construction — not by chasing
// Chromium audio-thread determinism.

/** Decision band, in dBFS. Centered on the historical -55 dB floor. */
export const SILENCE_FLOOR_LOW_DB = -57;
export const SILENCE_FLOOR_HIGH_DB = -53;

/** Window length: 50 ms, clamped to a sane minimum. */
export function silenceWindow(sampleRate: number): number {
  return Math.max(64, Math.floor(sampleRate * 0.05));
}

/**
 * Fraction of 50 ms windows that are "non-silent" under hysteresis.
 *
 * Hysteresis: a window is non-silent if its RMS dB > FLOOR_HIGH; silent
 * if < FLOOR_LOW; otherwise it inherits the previous window's state.
 * Initial state is silent (a track that starts in the band counts as
 * silent until it clearly rises — the conservative choice).
 *
 * Deterministic for any input whose per-window RMS differs from a
 * neighbouring render by less than the 4 dB band — i.e. immune to the
 * sub-perceptual render noise that made the old hard-threshold metric
 * flap.
 */
export function nonSilentRatio(mono: Float32Array, sampleRate: number): number {
  if (mono.length === 0) return 0;
  const win = silenceWindow(sampleRate);
  let nonSilent = 0;
  let total = 0;
  let state = false; // false = silent, true = non-silent
  for (let i = 0; i + win <= mono.length; i += win) {
    let sumSq = 0;
    for (let j = 0; j < win; j++) {
      const v = mono[i + j]!;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / win);
    const db = 20 * Math.log10(Math.max(1e-12, rms));
    if (db > SILENCE_FLOOR_HIGH_DB) state = true;
    else if (db < SILENCE_FLOOR_LOW_DB) state = false;
    // else: keep previous state (the hysteresis dead-band)
    if (state) nonSilent++;
    total++;
  }
  return total > 0 ? nonSilent / total : 0;
}

/**
 * Semantic split for the non_silent_ratio quality gate.
 *
 * The gate's stated intent (verbatim from its comment) is "a silent
 * renderer is a broken renderer". That is a near-total-silence check,
 * NOT a density check. Penalizing intentionally-sparse music
 * (dub_techno, ambient) with a hard_fail at <60% density is a category
 * error: it conflates "the renderer broke" with "the music is sparse".
 *
 *   nsr < BROKEN_RENDERER  → renderer produced essentially nothing →
 *                            hard_fail (this is the G9B dnb nsr=0.000 case)
 *   BROKEN ≤ nsr < SPARSE  → sparse but rendered → calibration_warning
 *                            (logged, does NOT block overall_pass)
 *   nsr ≥ SPARSE           → dense → pass / informational
 */
export const BROKEN_RENDERER_NSR = 0.15;
export const SPARSE_OK_NSR = 0.6;

export type NonSilentTier = 'hard_fail' | 'calibration_warning' | 'ok';

export function classifyNonSilent(ratio: number): { tier: NonSilentTier; passed: boolean } {
  if (ratio < BROKEN_RENDERER_NSR) return { tier: 'hard_fail', passed: false };
  if (ratio < SPARSE_OK_NSR) return { tier: 'calibration_warning', passed: true };
  return { tier: 'ok', passed: true };
}
