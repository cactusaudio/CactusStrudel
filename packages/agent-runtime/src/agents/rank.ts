import type { CritiqueEntry, ScoreVector, SessionGraph } from '@cactus/ir';
import { weightedScore } from '@cactus/preference';

export interface RankedCandidate {
  index: number;
  graph: SessionGraph;
  critique: CritiqueEntry;
  weighted_score: number;
  reasons: string[];
}

export function rankCandidates(
  graphs: SessionGraph[],
  critiques: CritiqueEntry[],
  weights?: ScoreVector,
): RankedCandidate[] {
  if (graphs.length !== critiques.length) {
    throw new Error('rankCandidates: graphs and critiques must have same length');
  }
  const candidates: RankedCandidate[] = graphs.map((graph, i) => {
    const critique = critiques[i]!;
    const w = weights ?? graph.preference_graph.weights;
    const score = weightedScore(critique.scores, w);
    const reasons = explainScore(critique.scores, w);
    return { index: i, graph, critique, weighted_score: score, reasons };
  });
  return candidates.sort((a, b) => b.weighted_score - a.weighted_score);
}

function explainScore(scores: ScoreVector, weights: ScoreVector): string[] {
  // Highlight 3 highest weight × score and 2 lowest.
  const entries = (Object.keys(scores) as Array<keyof ScoreVector>).map((k) => ({
    axis: k,
    score: scores[k],
    weight: weights[k],
    contribution: scores[k] * weights[k],
  }));
  entries.sort((a, b) => b.contribution - a.contribution);
  const out: string[] = [];
  for (const e of entries.slice(0, 3)) {
    out.push(`${e.axis}=${e.score.toFixed(2)} (×${e.weight.toFixed(2)} → +${e.contribution.toFixed(3)})`);
  }
  const weak = entries.filter((e) => e.score < 0.5).slice(0, 2);
  for (const e of weak) {
    out.push(`weak: ${e.axis}=${e.score.toFixed(2)}`);
  }
  return out;
}
