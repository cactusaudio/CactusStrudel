import { describe, it, expect } from 'vitest';
import { buildSessionGraphFromBrief, parseBrief } from '@cactus/agent-runtime';
import type { AnalyzerFeatures } from '@cactus/ir';
import { checkCriticSelfConsistency } from './self-consistency.js';

describe('checkCriticSelfConsistency', () => {
  it('reports stable=true for the deterministic critic', async () => {
    const brief = parseBrief('peak time techno 132 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = {
      loudness: { lufs_integrated: -8, true_peak_db: -1.2 },
      stereo: { mono_low_compliance: 0.95, width_low: 0.05, width_mid: 0.4, width_high: 0.6 },
      rhythmic: { bpm: 132, bpm_confidence: 0.9, grid_regularity: 0.92, syncopation_proxy: 0.05, onset_density: { low: 4, mid: 3, high: 5 } },
    };
    const r = await checkCriticSelfConsistency({ graph, features, iterations: 3 });
    expect(r.iterations).toBe(3);
    expect(r.stable).toBe(true);
    expect(r.max_stddev).toBe(0);
    expect(r.top_target_overlap).toBe(1);
    expect(r.warning).toBeUndefined();
  });

  it('returns score_means with all expected axes', async () => {
    const brief = parseBrief('techno 130 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = { loudness: { lufs_integrated: -10, true_peak_db: -1 } };
    const r = await checkCriticSelfConsistency({ graph, features });
    const expectedAxes = ['genre_fit', 'groove', 'arrangement_arc', 'sound_design', 'mix_translation', 'memorability_hook', 'originality', 'user_taste_fit', 'technical_validity'];
    for (const a of expectedAxes) {
      expect(r.score_means[a as keyof typeof r.score_means]).toBeDefined();
      expect(r.score_stddevs[a as keyof typeof r.score_stddevs]).toBeDefined();
    }
  });
});
