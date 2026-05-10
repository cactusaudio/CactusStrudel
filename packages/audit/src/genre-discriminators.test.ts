import { describe, it, expect } from 'vitest';
import { buildSessionGraphFromBrief, parseBrief } from '@cactus/agent-runtime';
import type { AnalyzerFeatures } from '@cactus/ir';
import { scoreGenreConfusion } from './genre-confusion.js';
import { applyGenreDiscriminators } from './genre-discriminators.js';

async function tunedGraph(brief: string, seed = 1) {
  return buildSessionGraphFromBrief(parseBrief(brief), { seed });
}

describe('applyGenreDiscriminators — techno regression', () => {
  it('peak_time techno features pull techno to top1 over IDM', async () => {
    const graph = await tunedGraph('peak time techno 130 BPM');
    const features: AnalyzerFeatures = {
      rhythmic: { bpm: 130, bpm_confidence: 0.9, grid_regularity: 0.99, syncopation_proxy: 0, onset_density: { low: 2, mid: 3, high: 3 } },
      stereo: { mono_low_compliance: 0.99, width_low: 0.05, width_mid: 0.4, width_high: 0.6 },
      loudness: { lufs_integrated: -8, lufs_short_max: -5, true_peak_db: -1 },
      spectral: { centroid: 1500, rolloff: 4000, flatness: 0.12, flux: 0.5, mfcc_mean: [], mfcc_std: [], band_rms: { sub: 0.05, low: 0.05, low_mid: 0.04, mid: 0.06, high_mid: 0.05, high: 0.04, air: 0.02 } },
    };
    const base = await scoreGenreConfusion({ intended_genre: 'techno', graph, features });
    const adj = applyGenreDiscriminators(base, features, graph);
    expect(adj.top1).toBe('techno');
    expect(adj.intended_top1).toBe(true);
  });

  it('idm features (high syncopation, low grid) pull idm to top1 over techno', async () => {
    const graph = await tunedGraph('fractured idm 138 BPM');
    const features: AnalyzerFeatures = {
      rhythmic: { bpm: 138, bpm_confidence: 0.7, grid_regularity: 0.5, syncopation_proxy: 0.7, onset_density: { low: 4, mid: 5, high: 6 } },
      loudness: { lufs_integrated: -10, true_peak_db: -2 },
      spectral: { centroid: 2200, flatness: 0.15, flux: 1.5, mfcc_mean: [], mfcc_std: [], band_rms: {} } as never,
    };
    const base = await scoreGenreConfusion({ intended_genre: 'idm', graph, features });
    const adj = applyGenreDiscriminators(base, features, graph);
    expect(adj.top1).toBe('idm');
  });

  it('ambient features (low onsets, low flux) pull ambient to top1', async () => {
    const graph = await tunedGraph('ambient drone 60 BPM');
    const features: AnalyzerFeatures = {
      rhythmic: { bpm: 60, bpm_confidence: 0.4, grid_regularity: 0.4, syncopation_proxy: 0.1, onset_density: { low: 0, mid: 0.2, high: 0.3 } },
      loudness: { lufs_integrated: -16, true_peak_db: -2 },
      spectral: { centroid: 800, flatness: 0.1, flux: 0.1, mfcc_mean: [], mfcc_std: [], band_rms: {} } as never,
    };
    const base = await scoreGenreConfusion({ intended_genre: 'ambient', graph, features });
    const adj = applyGenreDiscriminators(base, features, graph);
    expect(adj.top1).toBe('ambient');
  });

  it('dnb features (high BPM, break density) pull dnb to top1', async () => {
    const graph = await tunedGraph('rolling neurofunk dnb 174 BPM');
    const features: AnalyzerFeatures = {
      rhythmic: { bpm: 174, bpm_confidence: 0.95, grid_regularity: 0.9, syncopation_proxy: 0.2, onset_density: { low: 6, mid: 7, high: 8 } },
      loudness: { lufs_integrated: -7, true_peak_db: -1 },
      spectral: { centroid: 2000, flatness: 0.14, flux: 1.0, mfcc_mean: [], mfcc_std: [], band_rms: { sub: 0.06, low: 0.05, low_mid: 0.04, mid: 0.05, high_mid: 0.05, high: 0.04, air: 0.02 } },
    };
    const base = await scoreGenreConfusion({ intended_genre: 'dnb', graph, features });
    const adj = applyGenreDiscriminators(base, features, graph);
    expect(adj.top1).toBe('dnb');
  });

  it('discriminator records reasons in the distance object', async () => {
    const graph = await tunedGraph('peak time techno 132 BPM');
    const features: AnalyzerFeatures = {
      rhythmic: { bpm: 132, grid_regularity: 0.95, syncopation_proxy: 0.05, bpm_confidence: 0.9, onset_density: { low: 4, mid: 4, high: 4 } },
      stereo: { mono_low_compliance: 0.95, width_low: 0.05, width_mid: 0.5, width_high: 0.5 },
      loudness: { lufs_integrated: -8, true_peak_db: -1 },
      spectral: { centroid: 1800, flatness: 0.12, flux: 0.5, mfcc_mean: [], mfcc_std: [], band_rms: {} } as never,
    };
    const base = await scoreGenreConfusion({ intended_genre: 'techno', graph, features });
    const adj = applyGenreDiscriminators(base, features, graph);
    const techno = adj.distances.find((d) => d.genre === 'techno')!;
    expect(techno.reasons.some((r) => /discriminator/.test(r))).toBe(true);
    expect(techno.reasons.some((r) => /peak_time/.test(r))).toBe(true);
  });
});
