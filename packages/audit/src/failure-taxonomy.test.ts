import { describe, it, expect } from 'vitest';
import type { QualityGatesReport } from '@cactus/analyzer';
import { classifyFailure } from './failure-taxonomy.js';

function gate(name: string, passed: boolean, value = 0, severity = passed ? 0 : 1): QualityGatesReport['gates'][number] {
  return { name, passed, value, threshold: 0, severity };
}

function gates(list: QualityGatesReport['gates']): QualityGatesReport {
  const fail_count = list.filter((g) => !g.passed).length;
  return { gates: list, pass_count: list.length - fail_count, fail_count, overall_pass: fail_count === 0 };
}

describe('classifyFailure', () => {
  it('all gates pass + intended top1 → empty categories', () => {
    const r = classifyFailure({
      gates: gates([gate('non_silent_ratio', true), gate('lufs_target_distance', true)]),
      confusion: { intended_genre: 'techno', distances: [], top1: 'techno', top3: ['techno'], intended_top1: true, intended_top3: true, intended_distance: 0, best_alternative: null },
    });
    expect(r.categories).toEqual([]);
  });

  it('silent WAV → silence_or_near_silence', () => {
    const r = classifyFailure({ gates: gates([gate('non_silent_ratio', false, 0.0)]) });
    expect(r.categories).toContain('silence_or_near_silence');
  });

  it('failed onset_count_floor → musically_empty', () => {
    const r = classifyFailure({ gates: gates([gate('onset_count_floor', false, 0.1)]) });
    expect(r.categories).toContain('technically_valid_but_musically_empty');
  });

  it('loop_fatigue_score fail → loop_fatigue', () => {
    const r = classifyFailure({ gates: gates([gate('loop_fatigue_score', false, 0.99)]) });
    expect(r.categories).toContain('loop_fatigue');
  });

  it('arrangement_arc fail → no_arrangement_arc', () => {
    const r = classifyFailure({ gates: gates([gate('arrangement_arc_score', false, 0.5)]) });
    expect(r.categories).toContain('no_arrangement_arc');
  });

  it('intended_top1=false → genre_collapse', () => {
    const r = classifyFailure({
      confusion: { intended_genre: 'ambient', distances: [], top1: 'techno', top3: ['techno', 'house', 'dnb'], intended_top1: false, intended_top3: false, intended_distance: 5, best_alternative: { genre: 'techno', distance: 0 } },
    });
    expect(r.categories).toContain('genre_collapse');
  });

  it('low+sub band rms near zero → weak_kick_bass_relationship', () => {
    const r = classifyFailure({
      features: { spectral: { band_rms: { sub: 0.001, low: 0.001, mid: 0.05 } } },
    });
    expect(r.categories).toContain('weak_kick_bass_relationship');
  });

  it('high stereo width across mid+high → over_reverb', () => {
    const r = classifyFailure({
      features: { stereo: { width_mid: 0.85, width_high: 0.85, width_low: 0.05, mono_low_compliance: 0.9 } },
    });
    expect(r.categories).toContain('over_reverb');
  });

  it('locality unrelated drift → revision_drift', () => {
    const r = classifyFailure({
      locality: {
        changed_paths: [], requested_paths: [],
        unrelated_change_ratio: 0.8,
        target_changed_count: 1,
        unrelated_changed_count: 4,
        invariant_violations: [],
        drift_severity: 0.9,
      },
    });
    expect(r.categories).toContain('revision_drift');
  });

  it('critic instability → critic_instability', () => {
    const r = classifyFailure({
      consistency: { iterations: 3, score_means: {} as never, score_stddevs: {} as never, max_stddev: 0.2, top_target_overlap: 0.3, stable: false, warning: 'unstable' },
    });
    expect(r.categories).toContain('critic_instability');
  });

  it('validator issues > 0 → strudel_validation_gap', () => {
    const r = classifyFailure({ validatorIssues: 5 });
    expect(r.categories).toContain('strudel_validation_gap');
  });
});
