import { describe, it, expect } from 'vitest';
import type { CritiqueEntry, ScoreVector } from '@cactus/ir';
import type { QualityGatesReport } from '@cactus/analyzer';
import { decideWinner, summarize, type BackendRunSummary } from './champion-challenger.js';

function critiqueWith(scores: Partial<ScoreVector>, severeTargets = 0): CritiqueEntry {
  const full: ScoreVector = {
    genre_fit: 0.5, groove: 0.5, arrangement_arc: 0.5, sound_design: 0.5,
    mix_translation: 0.5, memorability_hook: 0.5, originality: 0.5,
    user_taste_fit: 0, technical_validity: 0.5, ...scores,
  };
  const targets = Array.from({ length: severeTargets }, (_, i) => ({
    target_id: `t-${i}-00000000-0000-4000-8000-000000000000`,
    severity: 0.85,
    agent: 'producer-mix-engineer',
    graph_paths: ['/mix_graph/master/gain'],
    problem: 'fake severe',
    evidence: {},
    revision_instruction: 'reduce gain',
  }));
  return { iteration: 0, scores: full, targets };
}

function gates(failCount: number): QualityGatesReport {
  const gs = Array.from({ length: failCount }, (_, i) => ({
    name: `g${i}`, passed: false, value: 0, threshold: 0, severity: 1,
  }));
  return { gates: gs, pass_count: 0, fail_count: failCount, overall_pass: failCount === 0 };
}

function summary(scores: Partial<ScoreVector>, opts: { hard?: number; intendedTop1?: boolean; failGates?: number; severe?: number } = {}): BackendRunSummary {
  return {
    result: { backend: 'rules', graph: {} as never, code: '', validator_issues: 0, warnings: [] },
    rendered: true,
    gates: gates(opts.failGates ?? 0),
    critique: critiqueWith(scores, opts.severe ?? 0),
    confusion: opts.intendedTop1 === false
      ? { intended_genre: 'techno', distances: [], top1: 'house', top3: ['house'], intended_top1: false, intended_top3: false, intended_distance: 1, best_alternative: { genre: 'house', distance: 0 } }
      : { intended_genre: 'techno', distances: [], top1: 'techno', top3: ['techno'], intended_top1: true, intended_top3: true, intended_distance: 0, best_alternative: null },
    hard_failures: opts.hard ? Array.from({ length: opts.hard }, (_, i) => `hard-${i}`) : [],
  };
}

describe('decideWinner', () => {
  it('challenger-not-run when challenger missing', () => {
    const v = decideWinner({ prompt_id: 'p1', seed: 1, champion: summary({}) });
    expect(v.winner).toBe('challenger-not-run');
  });

  it('champion wins if challenger has hard failures', () => {
    const v = decideWinner({
      prompt_id: 'p1', seed: 1,
      champion: summary({ technical_validity: 0.5 }),
      challenger: summary({ technical_validity: 0.9 }, { hard: 2 }),
    });
    expect(v.winner).toBe('champion');
    expect(v.reasons.some((r) => /hard failures/.test(r))).toBe(true);
  });

  it('champion wins if challenger lost intended top-1', () => {
    const v = decideWinner({
      prompt_id: 'p1', seed: 1,
      champion: summary({ technical_validity: 0.5 }, { intendedTop1: true }),
      challenger: summary({ technical_validity: 0.9 }, { intendedTop1: false }),
    });
    expect(v.winner).toBe('champion');
  });

  it('champion wins if challenger has more failed gates', () => {
    const v = decideWinner({
      prompt_id: 'p1', seed: 1,
      champion: summary({ technical_validity: 0.5 }, { failGates: 0 }),
      challenger: summary({ technical_validity: 0.9 }, { failGates: 2 }),
    });
    expect(v.winner).toBe('champion');
  });

  it('champion wins if challenger introduces new severe critique', () => {
    const v = decideWinner({
      prompt_id: 'p1', seed: 1,
      champion: summary({ technical_validity: 0.5 }, { severe: 0 }),
      challenger: summary({ technical_validity: 0.9 }, { severe: 2 }),
    });
    expect(v.winner).toBe('champion');
  });

  it('challenger wins on weighted score with strict gates met', () => {
    const v = decideWinner({
      prompt_id: 'p1', seed: 1,
      champion: summary({ groove: 0.4, sound_design: 0.4 }),
      challenger: summary({ groove: 0.9, sound_design: 0.9 }),
    });
    expect(v.winner).toBe('challenger');
  });

  it('tie when scores within 0.01', () => {
    const v = decideWinner({
      prompt_id: 'p1', seed: 1,
      champion: summary({ groove: 0.5, sound_design: 0.5 }),
      challenger: summary({ groove: 0.5, sound_design: 0.5 }),
    });
    expect(v.winner).toBe('tie');
  });
});

describe('summarize', () => {
  it('counts wins / ties / not-run', () => {
    const s = summarize([
      { prompt_id: 'a', seed: 1, winner: 'champion', reasons: [], champion_score: 0.5, challenger_score: 0.4 },
      { prompt_id: 'b', seed: 1, winner: 'challenger', reasons: [], champion_score: 0.4, challenger_score: 0.6 },
      { prompt_id: 'c', seed: 1, winner: 'tie', reasons: [], champion_score: 0.5, challenger_score: 0.5 },
      { prompt_id: 'd', seed: 1, winner: 'challenger-not-run', reasons: [], champion_score: 0.5, challenger_score: null },
    ]);
    expect(s.total).toBe(4);
    expect(s.champion_wins).toBe(1);
    expect(s.challenger_wins).toBe(1);
    expect(s.ties).toBe(1);
    expect(s.not_run).toBe(1);
  });
});
