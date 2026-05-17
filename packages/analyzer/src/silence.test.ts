// Gap1 (measurement trust): pin the hysteresis silence metric's two
// guarantees — (1) noise-immunity by construction, (2) semantic split
// matching the gate's stated intent ("a silent renderer is a broken
// renderer", not "the music is sparse").

import { describe, it, expect } from 'vitest';
import {
  nonSilentRatio, classifyNonSilent,
  BROKEN_RENDERER_NSR, SPARSE_OK_NSR,
  SILENCE_FLOOR_LOW_DB, SILENCE_FLOOR_HIGH_DB,
} from './silence.js';

const SR = 48000;

/** Build a mono buffer of N 50ms windows, each at a target dBFS. */
function buildAtDbfs(perWindowDbfs: number[]): Float32Array {
  const win = Math.floor(SR * 0.05);
  const out = new Float32Array(perWindowDbfs.length * win);
  for (let w = 0; w < perWindowDbfs.length; w++) {
    const amp = Math.pow(10, perWindowDbfs[w]! / 20);
    for (let j = 0; j < win; j++) out[w * win + j] = amp; // DC = RMS = amp
  }
  return out;
}

describe('hysteresis nonSilentRatio (Gap1)', () => {
  it('clearly-loud windows are all non-silent', () => {
    const buf = buildAtDbfs([-10, -10, -10, -10]);
    expect(nonSilentRatio(buf, SR)).toBe(1);
  });

  it('clearly-silent windows are all silent', () => {
    const buf = buildAtDbfs([-90, -90, -90, -90]);
    expect(nonSilentRatio(buf, SR)).toBe(0);
  });

  it('NOISE IMMUNITY: sub-perceptual jitter inside the dead-band cannot flip a window', () => {
    // A run of windows hovering around -55 dB (the historical hard floor),
    // jittering ±1.5 dB — exactly the sub-perceptual render noise that made
    // the old hard-threshold metric flap. Two "renders" of the same content
    // with different jitter signs must produce the SAME ratio.
    const mid = -55;
    const renderA = buildAtDbfs([-10, mid + 1.5, mid - 1.5, mid + 1.5, mid - 1.5, -10]);
    const renderB = buildAtDbfs([-10, mid - 1.5, mid + 1.5, mid - 1.5, mid + 1.5, -10]);
    // Both: window 0 = loud → state non-silent; windows 1-4 inside the
    // -57..-53 dead-band → state held at non-silent; window 5 loud.
    expect(nonSilentRatio(renderA, SR)).toBe(nonSilentRatio(renderB, SR));
    expect(nonSilentRatio(renderA, SR)).toBe(1); // sticky from the loud entry
  });

  it('dead-band entered from silence stays silent (conservative initial state)', () => {
    const mid = -55;
    // Starts in the band (no clear loud entry) → state stays silent until
    // a window clearly exceeds FLOOR_HIGH.
    const buf = buildAtDbfs([mid + 1, mid - 1, mid + 1, -40]);
    const r = nonSilentRatio(buf, SR);
    // first 3 windows: silent (held); last: clearly loud → non-silent.
    expect(r).toBeCloseTo(0.25, 5);
  });

  it('a window above FLOOR_HIGH then dropping below FLOOR_LOW flips back to silent', () => {
    const buf = buildAtDbfs([-40, -90, -40]);
    expect(nonSilentRatio(buf, SR)).toBeCloseTo(2 / 3, 5);
  });

  it('dead-band constants bracket the historical -55 floor with a 4 dB band', () => {
    expect(SILENCE_FLOOR_LOW_DB).toBeLessThan(-55);
    expect(SILENCE_FLOOR_HIGH_DB).toBeGreaterThan(-55);
    expect(SILENCE_FLOOR_HIGH_DB - SILENCE_FLOOR_LOW_DB).toBeGreaterThanOrEqual(4);
  });
});

describe('classifyNonSilent semantic split (Gap1)', () => {
  it('near-total silence is hard_fail (the G9B dnb nsr=0.000 case)', () => {
    expect(classifyNonSilent(0.0)).toEqual({ tier: 'hard_fail', passed: false });
    expect(classifyNonSilent(0.10)).toEqual({ tier: 'hard_fail', passed: false });
  });

  it('sparse-but-rendered is calibration_warning, NOT hard_fail, and does not block pass', () => {
    const r = classifyNonSilent(0.45); // dub_techno-typical sparse density
    expect(r.tier).toBe('calibration_warning');
    expect(r.passed).toBe(true); // <-- the key fix: sparse music does not fail the build
  });

  it('dense output passes as informational', () => {
    expect(classifyNonSilent(0.85)).toEqual({ tier: 'ok', passed: true });
  });

  it('the boundary constants are ordered sanely', () => {
    expect(BROKEN_RENDERER_NSR).toBeGreaterThan(0);
    expect(BROKEN_RENDERER_NSR).toBeLessThan(SPARSE_OK_NSR);
    expect(SPARSE_OK_NSR).toBeLessThan(1);
  });
});
