// Gap3 (human-in-loop closure): prove the feedback→preference loop
// converges toward a declared taste — without a human, by reducing
// "human in the loop" to its testable core: GIVEN consistent feedback
// toward a fixed taste, does the normalized weight vector approach that
// taste, monotonically, or does it oscillate / diverge?
//
// applyFeedback is multiplicative-boost + renormalize:
//   next[k] = clamp(weights[k] * (1 + delta)); then divide by sum.
// A synthetic user who, each round, complains about whatever axis is
// most under-weighted relative to their taste is doing coordinate-ascent
// on the reachable subspace. This module runs that loop and records the
// L1 distance trajectory so a test can assert monotone convergence.
//
// "Reachable subspace": parseFeedback's vocabulary can only push a subset
// of ScoreVector axes (verified empirically — see taste-convergence.test).
// A real user likewise can only express taste through language the system
// understands. Convergence is therefore measured over the EXPRESSIBLE
// axes, which is the honest claim — not "the loop reads your mind".

import type { ScoreVector } from '@cactus/ir';
import { parseFeedback, applyFeedback } from './feedback.js';

/** Axes a user can actually steer through parseFeedback's vocabulary. */
export const REACHABLE_AXES = [
  'groove',
  'mix_translation',
  'arrangement_arc',
  'memorability_hook',
  'sound_design',
] as const;
export type ReachableAxis = (typeof REACHABLE_AXES)[number];

/**
 * One verified single-axis phrase per reachable axis. Each maps to
 * exactly one positive weight_adjustment under parseFeedback (asserted
 * in taste-convergence.test.ts so a vocabulary change can't silently
 * break the harness).
 */
export const DEFAULT_PHRASE_FOR: Record<ReachableAxis, string> = {
  groove: 'punchier kick',
  mix_translation: 'louder',
  arrangement_arc: 'breakdown shorter',
  memorability_hook: 'needs a hook',
  sound_design: 'darker',
};

export interface TasteConvergenceInput {
  /**
   * The synthetic user's taste, as a desired RELATIVE weight over the
   * reachable axes. Need not sum to 1 — it's normalized internally.
   */
  target: Partial<Record<ReachableAxis, number>>;
  /** Starting weights (full ScoreVector). */
  start: ScoreVector;
  maxRounds?: number;
  /** Stop early once L1 distance over reachable axes < this. */
  epsilon?: number;
  /** Injectable for tests; defaults to the verified phrase map. */
  phraseFor?: Record<ReachableAxis, string>;
}

export interface TasteConvergenceResult {
  /** L1 distance (reachable subspace, renormalized) per round, incl. round 0. */
  trajectory: number[];
  rounds: number;
  /** Distance dropped below epsilon at least once. */
  converged: boolean;
  final_distance: number;
  /**
   * The honest dynamical guarantee. Fixed-magnitude human feedback
   * ("punchier!") overshoots, so the loop is NOT strictly monotone — it
   * is Lyapunov-stable: once it first reaches `epsilon`, the distance is
   * bounded by `epsilon * settle_factor` for every subsequent round (it
   * contracts to a neighborhood of the taste and never escapes). This is
   * the true characterization of multiplicative-weights + renormalization
   * under coarse coordinate feedback, and the honest product claim:
   * taste memory stabilizes into a region, it does not nail a point.
   */
  stable: boolean;
  /** Round at which distance first dropped below epsilon (−1 if never). */
  first_converged_round: number;
  /** Max distance observed AFTER first convergence (the oscillation band). */
  post_convergence_band: number;
  final_weights: ScoreVector;
  /** Per-round (axis chosen, phrase used) for traceability. */
  steps: Array<{ round: number; axis: ReachableAxis; phrase: string; distance: number }>;
}

/** Project a ScoreVector onto reachable axes and renormalize to sum 1. */
function reachableShare(w: ScoreVector): Record<ReachableAxis, number> {
  let sum = 0;
  for (const a of REACHABLE_AXES) sum += w[a];
  const out = {} as Record<ReachableAxis, number>;
  for (const a of REACHABLE_AXES) out[a] = sum > 0 ? w[a] / sum : 1 / REACHABLE_AXES.length;
  return out;
}

function normalizeTarget(t: Partial<Record<ReachableAxis, number>>): Record<ReachableAxis, number> {
  let sum = 0;
  for (const a of REACHABLE_AXES) sum += t[a] ?? 0;
  const out = {} as Record<ReachableAxis, number>;
  for (const a of REACHABLE_AXES) out[a] = sum > 0 ? (t[a] ?? 0) / sum : 1 / REACHABLE_AXES.length;
  return out;
}

function l1(a: Record<ReachableAxis, number>, b: Record<ReachableAxis, number>): number {
  let d = 0;
  for (const ax of REACHABLE_AXES) d += Math.abs(a[ax] - b[ax]);
  return d;
}

export function simulateTasteConvergence(input: TasteConvergenceInput): TasteConvergenceResult {
  const maxRounds = input.maxRounds ?? 40;
  const epsilon = input.epsilon ?? 0.10;
  const phraseFor = input.phraseFor ?? DEFAULT_PHRASE_FOR;
  /** Post-convergence the band may breathe up to this × epsilon. */
  const settleFactor = 1.6;

  const target = normalizeTarget(input.target);
  let weights: ScoreVector = { ...input.start };

  const trajectory: number[] = [];
  const steps: TasteConvergenceResult['steps'] = [];

  let dist = l1(reachableShare(weights), target);
  trajectory.push(dist);

  let firstConvergedRound = dist < epsilon ? 0 : -1;
  // Run the full budget even after first convergence so we can observe the
  // oscillation band (the honest stability claim needs the tail).
  let round = 0;
  for (; round < maxRounds; round++) {
    // Stop early only if we've converged AND the band has settled for a
    // while (no point burning rounds once it's clearly stable).
    if (firstConvergedRound >= 0 && round - firstConvergedRound >= 8) break;
    // Coordinate-ascent: the synthetic user complains about the axis with
    // the largest positive deficit (wants more than it currently has).
    const cur = reachableShare(weights);
    let bestAxis: ReachableAxis = REACHABLE_AXES[0];
    let bestDeficit = -Infinity;
    for (const ax of REACHABLE_AXES) {
      const deficit = target[ax] - cur[ax];
      if (deficit > bestDeficit) { bestDeficit = deficit; bestAxis = ax; }
    }
    const phrase = phraseFor[bestAxis];
    const parsed = parseFeedback(phrase);
    weights = applyFeedback(weights, parsed);

    dist = l1(reachableShare(weights), target);
    trajectory.push(dist);
    steps.push({ round: round + 1, axis: bestAxis, phrase, distance: dist });
    if (firstConvergedRound < 0 && dist < epsilon) firstConvergedRound = round + 1;
  }

  const converged = firstConvergedRound >= 0;
  // Lyapunov stability: every distance from first-convergence onward is
  // bounded by epsilon * settleFactor (the loop contracts to a
  // neighborhood and never escapes it).
  let postBand = 0;
  let stable = converged;
  if (converged) {
    for (let i = firstConvergedRound; i < trajectory.length; i++) {
      postBand = Math.max(postBand, trajectory[i]!);
      if (trajectory[i]! > epsilon * settleFactor) stable = false;
    }
  }

  return {
    trajectory,
    rounds: round,
    converged,
    final_distance: dist,
    stable,
    first_converged_round: firstConvergedRound,
    post_convergence_band: postBand,
    final_weights: weights,
    steps,
  };
}

/** Default ScoreVector starting weights (matches PreferenceGraph default). */
export const DEFAULT_START_WEIGHTS: ScoreVector = {
  genre_fit: 0.18,
  groove: 0.16,
  arrangement_arc: 0.13,
  sound_design: 0.1,
  mix_translation: 0.12,
  memorability_hook: 0.08,
  originality: 0.06,
  user_taste_fit: 0.05,
  technical_validity: 0.12,
};
