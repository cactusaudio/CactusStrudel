import type { PreferenceGraph, ScoreVector, PreferenceDecision } from '@cactus/ir';

export function recordDecision(
  graph: PreferenceGraph,
  decision: PreferenceDecision,
): PreferenceGraph {
  return {
    ...graph,
    decisions: [...graph.decisions, decision],
  };
}

export function weightedScore(scores: ScoreVector, weights: ScoreVector): number {
  const keys = Object.keys(scores) as Array<keyof ScoreVector>;
  let total = 0;
  let normalizer = 0;
  for (const k of keys) {
    total += scores[k] * weights[k];
    normalizer += weights[k];
  }
  return normalizer === 0 ? 0 : total / normalizer;
}

export { parseFeedback, applyFeedback, type ParsedFeedback } from './feedback.js';
