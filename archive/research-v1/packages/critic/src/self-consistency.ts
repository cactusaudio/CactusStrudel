// Critic self-consistency: re-run the critic N times on the same artifact and
// measure agreement. The current critic is deterministic, so it returns
// stability=1 by construction — but this surface stays in place so that when
// claude-shadow critique paths are wired, instability is detected and surfaced.

import type { CritiqueEntry, ScoreVector } from '@cactus/ir';
import { critique, type CritiqueInput } from './index.js';

export interface SelfConsistencyInput extends CritiqueInput {
  iterations?: number;
}

export interface SelfConsistencyReport {
  iterations: number;
  /** Mean score per axis across runs. */
  score_means: ScoreVector;
  /** Standard deviation per axis. */
  score_stddevs: ScoreVector;
  /** Maximum stddev across all axes. */
  max_stddev: number;
  /** Fraction of (run_i, run_j) pairs that share the same set of top-3 critique target paths. */
  top_target_overlap: number;
  /** Boolean: stable enough to drive a revision loop? */
  stable: boolean;
  /** If unstable, an actionable explanation. */
  warning?: string;
}

const STABILITY_STDDEV_CEIL = 0.05;
const STABILITY_OVERLAP_FLOOR = 0.7;

export async function checkCriticSelfConsistency(input: SelfConsistencyInput): Promise<SelfConsistencyReport> {
  const N = Math.max(2, input.iterations ?? 3);
  const runs: CritiqueEntry[] = [];
  for (let i = 0; i < N; i++) {
    runs.push(await critique({ graph: input.graph, features: input.features, iteration: i }));
  }
  const score_means = meanScores(runs.map((r) => r.scores));
  const score_stddevs = stddevScores(runs.map((r) => r.scores), score_means);
  const max_stddev = Math.max(...Object.values(score_stddevs));

  // Top-target overlap: pairwise Jaccard on top-3 target paths.
  const topPaths = runs.map((r) =>
    new Set(
      [...r.targets]
        .sort((a, b) => b.severity - a.severity)
        .slice(0, 3)
        .flatMap((t) => t.graph_paths),
    ),
  );
  let pairs = 0;
  let sumJ = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const a = topPaths[i]!;
      const b = topPaths[j]!;
      const inter = new Set([...a].filter((x) => b.has(x))).size;
      const union = new Set([...a, ...b]).size;
      const jacc = union === 0 ? 1 : inter / union;
      sumJ += jacc;
      pairs++;
    }
  }
  const top_target_overlap = pairs > 0 ? sumJ / pairs : 1;

  const stable = max_stddev <= STABILITY_STDDEV_CEIL && top_target_overlap >= STABILITY_OVERLAP_FLOOR;
  const warning = stable
    ? undefined
    : `critic instability: max stddev=${max_stddev.toFixed(3)} (≤${STABILITY_STDDEV_CEIL}) top-target overlap=${top_target_overlap.toFixed(2)} (≥${STABILITY_OVERLAP_FLOOR})`;

  return { iterations: N, score_means, score_stddevs, max_stddev, top_target_overlap, stable, warning };
}

function meanScores(runs: ScoreVector[]): ScoreVector {
  const keys = Object.keys(runs[0]!) as Array<keyof ScoreVector>;
  const out: Partial<ScoreVector> = {};
  for (const k of keys) {
    let s = 0;
    for (const r of runs) s += r[k];
    out[k] = s / runs.length;
  }
  return out as ScoreVector;
}

function stddevScores(runs: ScoreVector[], means: ScoreVector): ScoreVector {
  const keys = Object.keys(runs[0]!) as Array<keyof ScoreVector>;
  const out: Partial<ScoreVector> = {};
  for (const k of keys) {
    let s = 0;
    for (const r of runs) s += (r[k] - means[k]) ** 2;
    out[k] = Math.sqrt(s / runs.length);
  }
  return out as ScoreVector;
}
