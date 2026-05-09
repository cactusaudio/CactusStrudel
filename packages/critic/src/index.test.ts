import { describe, it, expect } from 'vitest';
import { critique } from './index.js';
import { buildSessionGraphFromBrief, parseBrief } from '@cactus/agent-runtime';
import type { AnalyzerFeatures } from '@cactus/ir';

describe('critique', () => {
  it('produces ScoreVector with all axes 0..1', async () => {
    const brief = parseBrief('peak time techno 134 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = {
      loudness: { lufs_integrated: -8, lufs_short_max: -5, true_peak_db: -1.2 },
      rhythmic: { bpm: 134, bpm_confidence: 0.9, grid_regularity: 0.92, syncopation_proxy: 0.05, onset_density: { low: 4, mid: 3, high: 5 } },
      stereo: { width_low: 0.05, width_mid: 0.4, width_high: 0.6, mono_low_compliance: 0.95 },
      spectral: { centroid: 2200, rolloff: 6000, flatness: 0.12, flux: 0.5, mfcc_mean: [], mfcc_std: [], band_rms: {} },
    };
    const c = await critique({ graph, features });
    for (const k of Object.keys(c.scores) as Array<keyof typeof c.scores>) {
      expect(c.scores[k]).toBeGreaterThanOrEqual(0);
      expect(c.scores[k]).toBeLessThanOrEqual(1);
    }
  });

  it('emits a true-peak target when peak > -0.5 dBTP', async () => {
    const brief = parseBrief('techno 130 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = {
      loudness: { lufs_integrated: -9, lufs_short_max: -5, true_peak_db: 0.2 },
    };
    const c = await critique({ graph, features });
    expect(c.targets.some((t) => /true peak/.test(t.problem))).toBe(true);
  });

  it('emits a LUFS target when far from genre target', async () => {
    const brief = parseBrief('peak time techno 134 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = {
      loudness: { lufs_integrated: -22, lufs_short_max: -18, true_peak_db: -3 },
    };
    const c = await critique({ graph, features });
    expect(c.targets.some((t) => /LUFS/i.test(t.problem))).toBe(true);
  });

  it('emits arrangement target when energy is too flat', async () => {
    const brief = parseBrief('techno 130 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    // Force flat energy
    for (const sec of graph.song.sections) sec.energy = 0.5;
    const features: AnalyzerFeatures = {
      loudness: { lufs_integrated: -8, true_peak_db: -1.5 },
    };
    const c = await critique({ graph, features });
    expect(c.targets.some((t) => /arc too flat/.test(t.problem))).toBe(true);
  });

  it('targets cite numeric evidence and graph_paths', async () => {
    const brief = parseBrief('peak time techno 134 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = {
      loudness: { lufs_integrated: -22, lufs_short_max: -18, true_peak_db: 0.2 },
      stereo: { mono_low_compliance: 0.5, width_low: 0.5, width_mid: 0.5, width_high: 0.5 },
    };
    const c = await critique({ graph, features });
    for (const t of c.targets) {
      expect(t.graph_paths.length).toBeGreaterThan(0);
      expect(Object.keys(t.evidence).length).toBeGreaterThan(0);
      expect(t.revision_instruction.length).toBeGreaterThan(5);
    }
  });
});
