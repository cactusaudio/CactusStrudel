import { describe, it, expect } from 'vitest';
import { parseFeedback, applyFeedback, recordDecision, weightedScore } from './index.js';
import type { PreferenceDecision, ScoreVector } from '@cactus/ir';

describe('parseFeedback', () => {
  it('extracts punchy-kick → groove weight bump', () => {
    const f = parseFeedback('the kick needs to be punchier');
    expect(f.weight_adjustments.groove).toBeGreaterThan(0);
    expect(f.attribute_preferences.punchy_kick).toBeGreaterThan(0);
  });

  it('extracts louder → revision hint on master gain', () => {
    const f = parseFeedback('make it louder, more presence');
    expect(f.revision_hints.find((r) => r.graph_path.includes('master/gain'))).toBeDefined();
  });

  it('extracts hook need', () => {
    const f = parseFeedback('it needs a memorable hook');
    expect(f.weight_adjustments.memorability_hook).toBeGreaterThan(0);
    expect(f.attribute_preferences.add_hook).toBeGreaterThan(0);
  });

  it('returns no adjustments for neutral text', () => {
    const f = parseFeedback('this is a session graph');
    expect(Object.keys(f.weight_adjustments).length).toBe(0);
  });
});

describe('applyFeedback', () => {
  it('renormalizes weights to sum to 1', () => {
    const weights: ScoreVector = {
      genre_fit: 0.18, groove: 0.16, arrangement_arc: 0.13, sound_design: 0.1,
      mix_translation: 0.12, memorability_hook: 0.08, originality: 0.06,
      user_taste_fit: 0.05, technical_validity: 0.12,
    };
    const f = parseFeedback('punchier kick, more reverb, brighter');
    const next = applyFeedback(weights, f);
    const sum = Object.values(next).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.0001);
    // groove should have grown relative to other axes
    expect(next.groove / weights.groove).toBeGreaterThan(next.originality / weights.originality);
  });

  it('does not cap a concentrated boost before renormalizing', () => {
    const weights: ScoreVector = {
      genre_fit: 0.05, groove: 0.85, arrangement_arc: 0.02, sound_design: 0.02,
      mix_translation: 0.02, memorability_hook: 0.01, originality: 0.01,
      user_taste_fit: 0.01, technical_validity: 0.01,
    };
    const next = applyFeedback(weights, {
      weight_adjustments: { groove: 1 },
      attribute_preferences: {},
      revision_hints: [],
      synthetic_targets: [],
      invariants: [],
      language: 'en',
    });
    expect(next.groove).toBeCloseTo(1.7 / 1.85, 4);
  });
});

describe('recordDecision', () => {
  it('appends to decisions immutably', () => {
    const pg = {
      decisions: [],
      weights: {} as ScoreVector,
      motif_likes: [],
      sound_likes: [],
      arrangement_likes: [],
    };
    const d: PreferenceDecision = {
      decision_id: '00000000-0000-4000-8000-000000000000',
      timestamp: '2026-05-10T00:00:00.000Z',
      kind: 'accept',
      iteration_a: 0,
      inferred_attributes: {},
    };
    const next = recordDecision(pg as never, d);
    expect(next.decisions.length).toBe(1);
    expect(pg.decisions.length).toBe(0); // original unchanged
  });
});

describe('weightedScore', () => {
  it('matches expected linear combination', () => {
    const scores: ScoreVector = {
      genre_fit: 1, groove: 0.5, arrangement_arc: 0, sound_design: 0,
      mix_translation: 0, memorability_hook: 0, originality: 0,
      user_taste_fit: 0, technical_validity: 1,
    };
    const weights: ScoreVector = {
      genre_fit: 0.4, groove: 0.2, arrangement_arc: 0.05, sound_design: 0.05,
      mix_translation: 0.05, memorability_hook: 0.05, originality: 0.05,
      user_taste_fit: 0.05, technical_validity: 0.1,
    };
    const s = weightedScore(scores, weights);
    // (1*0.4 + 0.5*0.2 + 1*0.1) / 1.0 = 0.6
    expect(s).toBeCloseTo(0.6, 3);
  });
});
