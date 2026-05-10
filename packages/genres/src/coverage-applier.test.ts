import { describe, it, expect } from 'vitest';
import type { SessionGraph, LayerGraph } from '@cactus/ir';
import { applyArrangementCoverage } from './coverage-applier.js';

function tinyGraph(
  genre: string,
  sectionFn: 'intro' | 'main' | 'drop' | 'breakdown' | 'outro',
  layerRoles: Array<LayerGraph['role']>,
  energy = 0.7,
): SessionGraph {
  const layers: LayerGraph[] = layerRoles.map((role, i) => ({ id: role, role, orbit: i }));
  return {
    schema_version: '1.0.0',
    session_id: '00000000-0000-4000-8000-000000000000',
    created_at: '2026-05-10T00:00:00.000Z',
    brief: { text: 'test', primary_genre: genre, mood: [], references: [], modifiers: [], constraints: {} },
    song: {
      cycles_per_bar: 1,
      total_bars: 4,
      sections: [{ id: 'sec1', name: 'sec', start_bar: 0, end_bar: 4, energy, function: sectionFn }],
      energy_curve: [energy, energy, energy, energy],
      layer_activation: Object.fromEntries(layerRoles.map((r) => [r, { sections: { sec1: false } }])),
    },
    layers,
    pattern_bank: { patterns: {} },
    sound_palette: { layers: {} },
    mix_graph: { orbits: {}, master: { gain: 1, lufs_target: -10, true_peak_max: -1 }, sidechain: [], bus_sends: [] },
    render_graph: [],
    critique_graph: [],
    preference_graph: { decisions: [], weights: { genre_fit: 0.18, groove: 0.16, arrangement_arc: 0.13, sound_design: 0.1, mix_translation: 0.12, memorability_hook: 0.08, originality: 0.06, user_taste_fit: 0.05, technical_validity: 0.12 }, motif_likes: [], sound_likes: [], arrangement_likes: [] },
    iteration_log: [],
  };
}

describe('applyArrangementCoverage — techno', () => {
  it('activates kick in techno intro', () => {
    const g = tinyGraph('techno', 'intro', ['kick', 'hat', 'bass'], 0.4);
    applyArrangementCoverage(g);
    expect(g.song.layer_activation.kick!.sections.sec1).toBe(true);
  });

  it('activates kick + hat + bass mandatory in techno main', () => {
    const g = tinyGraph('techno', 'main', ['kick', 'hat', 'bass', 'chord'], 0.7);
    applyArrangementCoverage(g);
    expect(g.song.layer_activation.kick!.sections.sec1).toBe(true);
    expect(g.song.layer_activation.hat!.sections.sec1).toBe(true);
    expect(g.song.layer_activation.bass!.sections.sec1).toBe(true);
  });

  it('forbids kick in techno breakdown', () => {
    const g = tinyGraph('techno', 'breakdown', ['kick', 'hat', 'chord'], 0.5);
    applyArrangementCoverage(g);
    expect(g.song.layer_activation.kick!.sections.sec1).toBe(false);
  });

  it('honors brief.constraints.no_kick (kick stays inactive even where mandatory)', () => {
    const g = tinyGraph('techno', 'main', ['kick', 'hat', 'bass'], 0.7);
    g.brief.constraints = { no_kick: true };
    applyArrangementCoverage(g);
    expect(g.song.layer_activation.kick!.sections.sec1).toBe(false);
  });

  it('returns mutation report listing changed sections', () => {
    const g = tinyGraph('techno', 'intro', ['kick', 'hat', 'bass'], 0.4);
    const r = applyArrangementCoverage(g);
    expect(r.genre).toBe('techno');
    expect(r.mutations.length).toBeGreaterThan(0);
  });
});

describe('applyArrangementCoverage — ambient', () => {
  it('keeps pad active in ambient intro', () => {
    const g = tinyGraph('ambient', 'intro', ['pad'], 0.3);
    applyArrangementCoverage(g);
    expect(g.song.layer_activation.pad!.sections.sec1).toBe(true);
  });

  it('forbids kick / hat in ambient even if user did not say no_kick', () => {
    const g = tinyGraph('ambient', 'intro', ['pad', 'kick', 'hat'], 0.3);
    applyArrangementCoverage(g);
    expect(g.song.layer_activation.kick!.sections.sec1).toBe(false);
    expect(g.song.layer_activation.hat!.sections.sec1).toBe(false);
  });
});

describe('applyArrangementCoverage — idm', () => {
  it('does not require kick in idm main (only percussion)', () => {
    const g = tinyGraph('idm', 'main', ['percussion', 'lead'], 0.7);
    applyArrangementCoverage(g);
    expect(g.song.layer_activation.percussion!.sections.sec1).toBe(true);
    // kick missing entirely → no requirement violated
  });
});
