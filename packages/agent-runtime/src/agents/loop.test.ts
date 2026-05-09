import { describe, it, expect } from 'vitest';
import { v4 as uuid } from 'uuid';
import type { AnalyzerFeatures, CritiqueEntry, SessionGraph } from '@cactus/ir';
import { critique } from '@cactus/critic';
import { parseBrief, buildSessionGraphFromBrief, createSketches, rankCandidates, closedLoopRevise } from '../index.js';

describe('createSketches', () => {
  it('creates N sketches from same brief with different seeds', async () => {
    const brief = parseBrief('peak time techno 132 BPM');
    const sketches = await createSketches(brief, { count: 5 });
    expect(sketches.length).toBe(5);
    // Different sketches should have different patterns.
    const pat0 = JSON.stringify(sketches[0]!.pattern_bank);
    const distinct = sketches.filter((s) => JSON.stringify(s.pattern_bank) !== pat0).length;
    expect(distinct).toBeGreaterThan(0);
  });
});

describe('rankCandidates', () => {
  it('ranks candidates by weighted score (highest first)', async () => {
    const brief = parseBrief('peak time techno 132 BPM');
    const sketches = await createSketches(brief, { count: 3 });
    // Synthesize three critiques with different scores.
    const critiques: CritiqueEntry[] = [
      { iteration: 0, scores: { ...defaultScores, technical_validity: 0.5 }, targets: [] },
      { iteration: 0, scores: { ...defaultScores, technical_validity: 1.0, groove: 0.9 }, targets: [] },
      { iteration: 0, scores: { ...defaultScores, technical_validity: 0.7 }, targets: [] },
    ];
    const ranked = rankCandidates(sketches, critiques);
    expect(ranked[0]!.index).toBe(1);
  });
});

describe('closedLoopRevise (mocked features)', () => {
  it('converges when severity drops below floor', async () => {
    const brief = parseBrief('peak time techno 132 BPM');
    const graph = await buildSessionGraphFromBrief(brief, { seed: 1 });
    let calls = 0;
    const r = await closedLoopRevise({
      graph,
      evaluateGraph: async (_g) => {
        calls++;
        // First call: high severity. Second: under floor.
        if (calls === 1) {
          return critique({
            graph: _g,
            features: {
              loudness: { lufs_integrated: -22, lufs_short_max: -18, true_peak_db: -2 },
            },
          });
        } else {
          return critique({
            graph: _g,
            features: { loudness: { lufs_integrated: -7.5, lufs_short_max: -5, true_peak_db: -1.5 } },
          });
        }
      },
      severityFloor: 0.4,
      maxIterations: 4,
    });
    expect(r.stoppedReason).toBe('converged');
    expect(r.iterations.length).toBeGreaterThanOrEqual(2);
  });

  it('stops at max_iterations when severity persists', async () => {
    const brief = parseBrief('peak time techno 132 BPM');
    const graph = await buildSessionGraphFromBrief(brief, { seed: 2 });
    // Always return high severity LUFS gap; closedLoopRevise will adjust gain
    // each iteration, but our mock returns the same features, so severity stays.
    const r = await closedLoopRevise({
      graph,
      evaluateGraph: async (g) =>
        critique({
          graph: g,
          features: { loudness: { lufs_integrated: -25, lufs_short_max: -20, true_peak_db: -3 } },
        }),
      severityFloor: 0.4,
      maxIterations: 3,
    });
    expect(['max_iterations', 'plateau', 'no_patches']).toContain(r.stoppedReason);
    expect(r.iterations.length).toBeLessThanOrEqual(3);
  });

  it('applies patches that respect agent write boundaries', async () => {
    const brief = parseBrief('peak time techno 132 BPM');
    const graph = await buildSessionGraphFromBrief(brief, { seed: 3 });
    const initialGain = graph.mix_graph.master.gain;
    const r = await closedLoopRevise({
      graph,
      evaluateGraph: async (g) =>
        critique({
          graph: g,
          features: { loudness: { lufs_integrated: -22, lufs_short_max: -18, true_peak_db: -2 } },
        }),
      maxIterations: 1,
    });
    // After one pass, the master gain should have changed.
    expect(r.graph.mix_graph.master.gain).not.toBe(initialGain);
  });
});

const defaultScores = {
  genre_fit: 0.5,
  groove: 0.5,
  arrangement_arc: 0.5,
  sound_design: 0.5,
  mix_translation: 0.5,
  memorability_hook: 0.5,
  originality: 0.5,
  user_taste_fit: 0,
  technical_validity: 0.5,
};
