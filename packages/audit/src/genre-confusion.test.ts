import { describe, it, expect } from 'vitest';
import { buildSessionGraphFromBrief, parseBrief } from '@cactus/agent-runtime';
import type { AnalyzerFeatures } from '@cactus/ir';
import { scoreGenreConfusion, aggregateConfusion, renderConfusionMarkdown } from './genre-confusion.js';
import { HOLDOUT_GENRE_PROFILES_PATH, loadHoldoutGenreProfiles } from './genre-holdout-profiles.js';

describe('scoreGenreConfusion', () => {
  it('ranks ambient highest for ambient-shaped features', async () => {
    const brief = parseBrief('ambient drone 60 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = {
      rhythmic: { bpm: 60, bpm_confidence: 0.5, grid_regularity: 0.3, syncopation_proxy: 0.1, onset_density: { low: 0, mid: 0, high: 0 } },
      loudness: { lufs_integrated: -16, lufs_short_max: -12, true_peak_db: -2 },
      spectral: { centroid: 800, rolloff: 2000, flatness: 0.1, flux: 0.05, mfcc_mean: [], mfcc_std: [], band_rms: {} },
    };
    const r = await scoreGenreConfusion({ intended_genre: 'ambient', graph, features });
    expect(r.top1).toBe('ambient');
    expect(r.intended_top1).toBe(true);
  });

  it('detects collapse: techno features rendered against ambient intent', async () => {
    const brief = parseBrief('ambient drone 60 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = {
      rhythmic: { bpm: 132, bpm_confidence: 0.9, grid_regularity: 0.92, syncopation_proxy: 0.05, onset_density: { low: 4, mid: 4, high: 5 } },
      loudness: { lufs_integrated: -8, lufs_short_max: -5, true_peak_db: -1 },
      spectral: { centroid: 2000, rolloff: 5000, flatness: 0.12, flux: 0.5, mfcc_mean: [], mfcc_std: [], band_rms: {} },
    };
    const r = await scoreGenreConfusion({ intended_genre: 'ambient', graph, features });
    expect(r.intended_top1).toBe(false);
    // top1 must NOT be ambient — anything more rhythmic is acceptable.
    expect(r.top1).not.toBe('ambient');
  });

  it('does not use graph.brief.bpm as analyzer evidence when features omit BPM', async () => {
    const brief = parseBrief('ambient drone 60 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = {
      rhythmic: { bpm_confidence: 0, grid_regularity: 0.9, syncopation_proxy: 0.05, onset_density: { low: 4, mid: 4, high: 4 } },
      loudness: { lufs_integrated: -8, lufs_short_max: -5, true_peak_db: -1 },
      spectral: { centroid: 2200, rolloff: 5000, flatness: 0.12, flux: 0.5, mfcc_mean: [], mfcc_std: [], band_rms: {} },
    };
    const r = await scoreGenreConfusion({ intended_genre: 'ambient', graph, features });
    const ambient = r.distances.find((d) => d.genre === 'ambient')!;
    expect(ambient.reasons.some((reason) => reason.includes('bpm 0'))).toBe(true);
  });

  it('uses audit-owned holdout profiles instead of producer genre specs', async () => {
    expect(HOLDOUT_GENRE_PROFILES_PATH).toContain('packages/audit/genre-holdout-profiles.yaml');
    const profiles = await loadHoldoutGenreProfiles();
    expect(Object.keys(profiles).sort()).toEqual(['ambient', 'dnb', 'dub_techno', 'house', 'idm', 'techno']);
    expect(profiles.techno!.bpm_range).toEqual([124, 140]);
  });
});

describe('aggregateConfusion + renderConfusionMarkdown', () => {
  it('builds a confusion matrix and renders markdown', async () => {
    const reports = [
      { intended_genre: 'techno', distances: [], top1: 'techno', top3: ['techno'], intended_top1: true, intended_top3: true, intended_distance: 0, best_alternative: null },
      { intended_genre: 'techno', distances: [], top1: 'house', top3: ['house'], intended_top1: false, intended_top3: false, intended_distance: 1, best_alternative: { genre: 'house', distance: 0.5 } },
      { intended_genre: 'ambient', distances: [], top1: 'ambient', top3: ['ambient'], intended_top1: true, intended_top3: true, intended_distance: 0, best_alternative: null },
    ];
    const m = aggregateConfusion(reports);
    expect(m.total_renders).toBe(3);
    expect(m.top1_correct).toBe(2);
    expect(m.matrix.techno!.techno).toBe(1);
    expect(m.matrix.techno!.house).toBe(1);
    const md = renderConfusionMarkdown(m);
    expect(md).toContain('top-1 correct: 2/3');
    expect(md).toContain('| techno |');
  });
});
