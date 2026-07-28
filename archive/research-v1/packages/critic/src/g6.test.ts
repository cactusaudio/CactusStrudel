// G6: critic upgrade tests — section / band / spectrogram targets.

import { describe, it, expect } from 'vitest';
import { critique } from './index.js';
import { buildSessionGraphFromBrief, parseBrief } from '@cactus/agent-runtime';
import type { AnalyzerFeatures } from '@cactus/ir';

describe('critique — G6 section + band + spectrogram', () => {
  it('emits a per-section target when a drop section is silent', async () => {
    const brief = parseBrief('peak time techno 130 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    // Pick the first drop / main section to mark as silent in diagnostics.
    const dropSec = graph.song.sections.find((s) => s.function === 'drop' || s.function === 'main');
    if (!dropSec) return;
    const features: AnalyzerFeatures = {
      loudness: { lufs_integrated: -10, true_peak_db: -2 },
    };
    const c = await critique({
      graph, features,
      sectionDiagnostics: [
        {
          section_id: dropSec.id,
          section_name: dropSec.name,
          non_silent_ratio: 0.1,
          rms_db: -50,
          band_rms: { low: 0.001, mid: 0.001, high: 0.001 },
          active_layers: 0,
        },
      ],
    });
    const sectionTarget = c.targets.find(
      (t) => /mostly silent/.test(t.problem) && (t.evidence as Record<string, unknown>).section_id === dropSec.id,
    );
    expect(sectionTarget).toBeDefined();
    expect(sectionTarget!.severity).toBeGreaterThan(0.5);
  });

  it('does NOT emit a section target when intro is quiet (intros are allowed quiet)', async () => {
    const brief = parseBrief('techno 130 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const introSec = graph.song.sections.find((s) => s.function === 'intro');
    if (!introSec) return;
    const features: AnalyzerFeatures = { loudness: { lufs_integrated: -10, true_peak_db: -2 } };
    const c = await critique({
      graph, features,
      sectionDiagnostics: [
        { section_id: introSec.id, section_name: introSec.name, non_silent_ratio: 0.1 },
      ],
    });
    const introTarget = c.targets.find((t) => (t.evidence as Record<string, unknown>).section_id === introSec.id);
    expect(introTarget).toBeUndefined();
  });

  it('emits a low-band-mud target when low_db overpowers mid+high by >12 dB', async () => {
    const brief = parseBrief('techno 130 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = {
      loudness: { lufs_integrated: -10, true_peak_db: -2 },
      spectral: {
        centroid: 200, rolloff: 800, flatness: 0.1, flux: 0.3,
        mfcc_mean: [], mfcc_std: [],
        // low+sub = 0.5 → -6 dB; mid+high = 0.05 → -26 dB; delta = 20 dB > 12
        band_rms: { sub: 0.25, low: 0.25, mid: 0.05, high: 0.05 },
      },
    };
    const c = await critique({ graph, features });
    expect(c.targets.some((t) => /mud/.test(t.problem))).toBe(true);
  });

  it('emits a high-band-starved target when high_db is >18 dB below mid_db', async () => {
    const brief = parseBrief('techno 130 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = {
      loudness: { lufs_integrated: -10, true_peak_db: -2 },
      spectral: {
        centroid: 1500, rolloff: 3000, flatness: 0.1, flux: 0.3,
        mfcc_mean: [], mfcc_std: [],
        // mid 0.5 → -6 dB; high 0.01 → -40 dB; delta = 34 dB > 18
        band_rms: { sub: 0.1, low: 0.1, mid: 0.5, high: 0.01 },
      },
    };
    const c = await critique({ graph, features });
    expect(c.targets.some((t) => /starved/.test(t.problem))).toBe(true);
  });

  it('does not emit band target when bands are within tolerance', async () => {
    const brief = parseBrief('techno 130 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = {
      loudness: { lufs_integrated: -10, true_peak_db: -2 },
      spectral: {
        centroid: 1500, rolloff: 3000, flatness: 0.1, flux: 0.3,
        mfcc_mean: [], mfcc_std: [],
        band_rms: { sub: 0.2, low: 0.2, mid: 0.25, high: 0.18 },
      },
    };
    const c = await critique({ graph, features });
    expect(c.targets.some((t) => /mud|starved/.test(t.problem))).toBe(false);
  });

  it('attaches spectrogram_path to every target evidence when supplied', async () => {
    const brief = parseBrief('techno 130 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = {
      loudness: { lufs_integrated: -22, true_peak_db: 0.5 },
    };
    const c = await critique({
      graph, features,
      spectrogramPath: '/tmp/iter_0001.spectrogram.png',
    });
    expect(c.targets.length).toBeGreaterThan(0);
    for (const t of c.targets) {
      expect((t.evidence as Record<string, unknown>).spectrogram_path).toBe('/tmp/iter_0001.spectrogram.png');
    }
  });

  it('targets without spectrogramPath have no spectrogram_path key', async () => {
    const brief = parseBrief('techno 130 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const features: AnalyzerFeatures = { loudness: { lufs_integrated: -22, true_peak_db: 0.5 } };
    const c = await critique({ graph, features });
    for (const t of c.targets) {
      expect((t.evidence as Record<string, unknown>).spectrogram_path).toBeUndefined();
    }
  });
});
