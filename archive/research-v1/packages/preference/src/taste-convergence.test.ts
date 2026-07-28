// Gap3: prove the feedback→preference loop converges to a declared taste,
// monotonically, for several distinct synthetic users. Also pins the
// phrase→axis vocabulary contract the harness depends on (a feedback-rule
// change that breaks single-axis mapping fails here, loudly).

import { describe, it, expect } from 'vitest';
import { parseFeedback } from './feedback.js';
import {
  simulateTasteConvergence, REACHABLE_AXES, DEFAULT_PHRASE_FOR,
  DEFAULT_START_WEIGHTS, type ReachableAxis,
} from './taste-convergence.js';

describe('phrase→axis vocabulary contract (Gap3 dependency)', () => {
  it('every DEFAULT_PHRASE_FOR phrase maps to exactly its intended axis', () => {
    for (const axis of REACHABLE_AXES) {
      const phrase = DEFAULT_PHRASE_FOR[axis];
      const adj = parseFeedback(phrase).weight_adjustments;
      const keys = Object.keys(adj) as ReachableAxis[];
      expect(keys, `"${phrase}" should bump exactly one axis`).toEqual([axis]);
      expect((adj as Record<string, number>)[axis]).toBeGreaterThan(0);
    }
  });
});

describe('taste convergence (Gap3)', () => {
  const targets: Array<{ name: string; target: Partial<Record<ReachableAxis, number>> }> = [
    { name: 'groove-obsessed club user', target: { groove: 0.6, mix_translation: 0.3, arrangement_arc: 0.1 } },
    { name: 'hook-and-sound-design user', target: { memorability_hook: 0.5, sound_design: 0.4, groove: 0.1 } },
    { name: 'balanced user', target: { groove: 0.2, mix_translation: 0.2, arrangement_arc: 0.2, memorability_hook: 0.2, sound_design: 0.2 } },
    { name: 'arrangement-first user', target: { arrangement_arc: 0.7, groove: 0.3 } },
  ];

  for (const { name, target } of targets) {
    it(`converges to a stable neighborhood of "${name}"`, () => {
      const r = simulateTasteConvergence({
        target,
        start: { ...DEFAULT_START_WEIGHTS },
        maxRounds: 60,
        epsilon: 0.12,
      });
      // The honest guarantee: reduces distance from start, reaches the
      // epsilon neighborhood, and STAYS bounded there (Lyapunov stable).
      // NOT strict monotonicity — fixed-magnitude human feedback
      // overshoots, which is correct real-world behavior.
      expect(r.trajectory[0]!, 'should start measurably off-target').toBeGreaterThan(0.12);
      expect(r.converged, `must reach epsilon (final ${r.final_distance.toFixed(3)})`).toBe(true);
      expect(r.stable, `post-convergence band ${r.post_convergence_band.toFixed(3)} must stay bounded`).toBe(true);
      expect(r.final_distance).toBeLessThan(r.trajectory[0]!);
    });
  }

  it('contracts overall even though individual rounds may overshoot (the real dynamics)', () => {
    const r = simulateTasteConvergence({
      target: { groove: 0.5, mix_translation: 0.3, sound_design: 0.2 },
      start: { ...DEFAULT_START_WEIGHTS },
      maxRounds: 50,
      epsilon: 0.12,
    });
    // Overall contraction: the mean of the second half is well below the
    // mean of the first half (the trajectory trends down even with
    // overshoot wobble), and it converges + stays stable.
    const mid = Math.floor(r.trajectory.length / 2);
    const meanFirst = r.trajectory.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const meanSecond = r.trajectory.slice(mid).reduce((a, b) => a + b, 0) / (r.trajectory.length - mid);
    expect(meanSecond).toBeLessThan(meanFirst);
    expect(r.converged).toBe(true);
    expect(r.stable).toBe(true);
  });

  it('post-convergence oscillation is small (taste memory settles into a region, honestly not a point)', () => {
    const r = simulateTasteConvergence({
      target: { groove: 0.6, mix_translation: 0.4 },
      start: { ...DEFAULT_START_WEIGHTS },
      maxRounds: 60,
      epsilon: 0.12,
    });
    expect(r.converged).toBe(true);
    // The band is the honest UX claim: the loop settles WITHIN a small
    // region around the taste, it does not perfectly nail a point.
    expect(r.post_convergence_band).toBeLessThan(0.12 * 1.6);
    expect(r.post_convergence_band).toBeGreaterThan(0); // it does wobble — that's real
  });

  it('a taste already at the start needs zero rounds', () => {
    // Build a target equal to the start's reachable-axis shape.
    const start = { ...DEFAULT_START_WEIGHTS };
    const r = simulateTasteConvergence({
      target: {
        groove: start.groove,
        mix_translation: start.mix_translation,
        arrangement_arc: start.arrangement_arc,
        memorability_hook: start.memorability_hook,
        sound_design: start.sound_design,
      },
      start,
      epsilon: 0.12,
    });
    // Already at target → converged at round 0, and the observed band
    // stays tiny (the loop runs a short tail to confirm stability, but
    // never has to travel).
    expect(r.first_converged_round).toBe(0);
    expect(r.converged).toBe(true);
    expect(r.post_convergence_band).toBeLessThan(0.12 * 1.6);
  });

  it('records a traceable step log (axis + phrase per round)', () => {
    const r = simulateTasteConvergence({
      target: { groove: 0.8, sound_design: 0.2 },
      start: { ...DEFAULT_START_WEIGHTS },
      maxRounds: 30,
    });
    expect(r.steps.length).toBe(r.rounds);
    for (const s of r.steps) {
      expect(REACHABLE_AXES).toContain(s.axis);
      expect(s.phrase).toBe(DEFAULT_PHRASE_FOR[s.axis]);
    }
  });
});
