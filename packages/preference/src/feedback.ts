// Feedback text parser. Maps natural-language phrases to score-axis bias and
// preferred attributes. No LLM — keyword-driven for deterministic behavior.

import type { ScoreVector } from '@cactus/ir';

export interface ParsedFeedback {
  /** Multiplicative adjustment to score weights, applied as: weight *= 1 + adjust. */
  weight_adjustments: Partial<ScoreVector>;
  /** Free-text attribute preferences logged for future ranking priors. */
  attribute_preferences: Record<string, number>;
  /** Targeted revision instructions (graph_path → instruction). */
  revision_hints: Array<{ graph_path: string; instruction: string }>;
}

const KEYWORD_RULES: Array<{
  re: RegExp;
  weight_axis?: keyof ScoreVector;
  weight_delta?: number;
  attribute?: { key: string; delta: number };
  revision?: { graph_path: string; instruction: string };
}> = [
  // groove
  { re: /punch(y|ier)|tighter\s+(groove|kick)/i, weight_axis: 'groove', weight_delta: 0.4, attribute: { key: 'punchy_kick', delta: 0.5 } },
  { re: /loose|swing/i, attribute: { key: 'swing_groove', delta: 0.5 } },
  // mix
  { re: /louder|more\s+loud|too\s+quiet/i, weight_axis: 'mix_translation', weight_delta: 0.3, revision: { graph_path: '/mix_graph/master/gain', instruction: 'increase master gain by 2 dB' } },
  { re: /quieter|too\s+loud/i, weight_axis: 'mix_translation', weight_delta: 0.3, revision: { graph_path: '/mix_graph/master/gain', instruction: 'reduce master gain by 2 dB' } },
  { re: /muddy|cloudy|murky/i, weight_axis: 'mix_translation', weight_delta: 0.5, attribute: { key: 'avoid_low_mid_buildup', delta: 0.7 } },
  { re: /bright(er)?|airier|crispy/i, weight_axis: 'sound_design', weight_delta: 0.3, attribute: { key: 'high_band_emphasis', delta: 0.5 } },
  { re: /dark(er)?|warmer/i, weight_axis: 'sound_design', weight_delta: 0.3, attribute: { key: 'high_band_rolloff', delta: 0.5 } },
  // sound design
  { re: /more\s+(reverb|space|space[\s-]y|spacious)/i, weight_axis: 'sound_design', weight_delta: 0.3, attribute: { key: 'wider_reverb', delta: 0.5 } },
  { re: /dry(er)?|less\s+reverb/i, weight_axis: 'sound_design', weight_delta: 0.3, attribute: { key: 'less_reverb', delta: 0.5 } },
  // arrangement
  { re: /boring|monotonous|too\s+repetitive/i, weight_axis: 'arrangement_arc', weight_delta: 0.5, attribute: { key: 'more_variation', delta: 0.7 } },
  { re: /chaotic|too\s+busy/i, weight_axis: 'groove', weight_delta: 0.3, attribute: { key: 'simpler_arrangement', delta: 0.5 } },
  // hook
  { re: /needs?\s+a?\s*hook|catchier|memorable/i, weight_axis: 'memorability_hook', weight_delta: 0.6, attribute: { key: 'add_hook', delta: 0.7 } },
  // user_taste explicit
  { re: /\b(love|amazing|exactly|perfect|nailed)\b/i, weight_axis: 'user_taste_fit', weight_delta: 0.6 },
  { re: /\b(hate|wrong|nope|no)\b/i, weight_axis: 'user_taste_fit', weight_delta: -0.4 },
];

export function parseFeedback(text: string): ParsedFeedback {
  const adjustments: Partial<ScoreVector> = {};
  const attributes: Record<string, number> = {};
  const hints: ParsedFeedback['revision_hints'] = [];

  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(text)) {
      if (rule.weight_axis && rule.weight_delta !== undefined) {
        adjustments[rule.weight_axis] = (adjustments[rule.weight_axis] ?? 0) + rule.weight_delta;
      }
      if (rule.attribute) {
        attributes[rule.attribute.key] = (attributes[rule.attribute.key] ?? 0) + rule.attribute.delta;
      }
      if (rule.revision) {
        hints.push(rule.revision);
      }
    }
  }

  return {
    weight_adjustments: adjustments,
    attribute_preferences: attributes,
    revision_hints: hints,
  };
}

/**
 * Apply parsed feedback to a PreferenceGraph: shift weights, update preferences.
 * Weights are renormalized so they sum to 1 after adjustments.
 */
export function applyFeedback(
  weights: ScoreVector,
  parsed: ParsedFeedback,
): ScoreVector {
  const next: ScoreVector = { ...weights };
  for (const [k, delta] of Object.entries(parsed.weight_adjustments) as Array<[keyof ScoreVector, number]>) {
    next[k] = Math.max(0, Math.min(1, next[k] * (1 + delta)));
  }
  // Renormalize.
  const total = Object.values(next).reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (const k of Object.keys(next) as Array<keyof ScoreVector>) {
      next[k] = next[k] / total;
    }
  }
  return next;
}
