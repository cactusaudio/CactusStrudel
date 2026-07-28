// G5: tests for cross-field semantic invariants. Uses the canonical fixture
// session graphs as the "valid" baseline and mutates them to construct each
// failure case.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from './fixtures.js';
import {
  validateSemanticInvariants,
  formatSemanticReport,
  type SemanticReport,
} from './semantic-invariants.js';
import type { SessionGraph } from './schema.js';

function clone(g: SessionGraph): SessionGraph {
  return JSON.parse(JSON.stringify(g)) as SessionGraph;
}

function categoriesOf(r: SemanticReport): string[] {
  return [...r.errors, ...r.warnings].map((i) => i.category);
}

let baseGraph: SessionGraph;
const fresh = (): SessionGraph => clone(baseGraph);

describe('validateSemanticInvariants (G5)', () => {
  beforeAll(async () => {
    baseGraph = await loadFixture('techno');
  });

  it('canonical fixture passes all invariants with zero errors', () => {
    const r = validateSemanticInvariants(baseGraph);
    if (!r.ok) {
      // Surface the failure so we can fix the fixture if it's the bug.
      throw new Error(`fixture failed semantic check: ${formatSemanticReport(r)}`);
    }
    expect(r.errors).toEqual([]);
  });

  it('section gap is reported as section_coverage error', () => {
    const g = fresh();
    // Drop the first section's end_bar by 2 to introduce a gap.
    g.song.sections[0]!.end_bar -= 2;
    const r = validateSemanticInvariants(g);
    expect(r.ok).toBe(false);
    expect(categoriesOf(r)).toContain('section_coverage');
  });

  it('section overlap is reported as section_overlap error', () => {
    const g = fresh();
    if (g.song.sections.length < 2) return; // safety
    g.song.sections[1]!.start_bar = g.song.sections[0]!.start_bar; // overlap entirely
    const r = validateSemanticInvariants(g);
    expect(r.ok).toBe(false);
    expect(categoriesOf(r)).toContain('section_overlap');
  });

  it('section coverage shorter than total_bars is flagged', () => {
    const g = fresh();
    g.song.total_bars += 8;
    const r = validateSemanticInvariants(g);
    expect(r.ok).toBe(false);
    expect(r.errors.find((e) => e.path === '/song/total_bars')).toBeDefined();
  });

  it('energy_curve length mismatch is an error', () => {
    const g = fresh();
    g.song.energy_curve = g.song.energy_curve.slice(0, 1);
    const r = validateSemanticInvariants(g);
    expect(r.ok).toBe(false);
    expect(categoriesOf(r)).toContain('energy_curve_length');
  });

  it('layer with orbit having no mix_graph entry is layer_orbit_orphan', () => {
    const g = fresh();
    delete g.mix_graph.orbits[String(g.layers[0]!.orbit)];
    const r = validateSemanticInvariants(g);
    expect(r.ok).toBe(false);
    expect(categoriesOf(r)).toContain('layer_orbit_orphan');
  });

  it('mix_graph orbit with no layer is orbit_layer_orphan warning, not error', () => {
    const g = fresh();
    g.mix_graph.orbits['99'] = { gain: 1, pan: 0, width: 1, room_send: 0, delay_send: 0 };
    const r = validateSemanticInvariants(g);
    // Adding an orphan orbit is a warning, not an error.
    expect(r.errors.find((e) => e.category === 'orbit_layer_orphan')).toBeUndefined();
    expect(r.warnings.find((w) => w.category === 'orbit_layer_orphan')).toBeDefined();
  });

  it('layer_activation referencing unknown layer id is an error', () => {
    const g = fresh();
    g.song.layer_activation['ghost-layer'] = { sections: { [g.song.sections[0]!.id]: true } };
    const r = validateSemanticInvariants(g);
    expect(r.ok).toBe(false);
    expect(categoriesOf(r)).toContain('activation_layer_ref');
  });

  it('layer_activation referencing unknown section id is an error', () => {
    const g = fresh();
    const lid = g.layers[0]!.id;
    g.song.layer_activation[lid] = {
      sections: { [g.song.sections[0]!.id]: true, 'ghost-section': true },
    };
    const r = validateSemanticInvariants(g);
    expect(r.ok).toBe(false);
    expect(categoriesOf(r)).toContain('activation_section_ref');
  });

  it('pattern_bank references unknown layer id', () => {
    const g = fresh();
    g.pattern_bank.patterns['ghost-layer'] = { [g.song.sections[0]!.id]: { mini_notation: 'bd' } };
    const r = validateSemanticInvariants(g);
    expect(r.ok).toBe(false);
    expect(categoriesOf(r)).toContain('pattern_layer_ref');
  });

  it('sound_palette references unknown layer id', () => {
    const g = fresh();
    g.sound_palette.layers['ghost-layer'] = {
      source: { kind: 'sample', name: 'bd', options: {} },
      effects: [],
    };
    const r = validateSemanticInvariants(g);
    expect(r.ok).toBe(false);
    expect(categoriesOf(r)).toContain('sound_palette_layer_ref');
  });

  it('sidechain edge with unknown layer is an error', () => {
    const g = fresh();
    g.mix_graph.sidechain.push({
      layer: 'ghost-target', source: 'ghost-source',
      depth: 0.5, attack_ms: 5, release_ms: 100,
    });
    const r = validateSemanticInvariants(g);
    expect(r.ok).toBe(false);
    const sidechainErrors = r.errors.filter((e) => e.category === 'sidechain_layer_ref');
    expect(sidechainErrors.length).toBe(2);
  });

  it('iteration_log patch with unknown agent is patch_agent_unknown error', () => {
    const g = fresh();
    g.iteration_log.push({
      iteration_n: 1,
      timestamp: '2026-05-10T00:00:00.000Z',
      kind: 'revise',
      agent: 'rogue-agent',
      patches: [{
        patch_id: '00000000-0000-4000-8000-000000000001',
        iteration: 1,
        agent: 'producer-rogue', // not in AGENT_WRITE_PATHS
        intent: 'rogue patch',
        ops: [{ op: 'replace', path: '/mix_graph/master/gain', value: 1 }],
      }],
    });
    const r = validateSemanticInvariants(g);
    expect(r.ok).toBe(false);
    expect(categoriesOf(r)).toContain('patch_agent_unknown');
  });

  it('sample-name registry check is warning-only and skipped when knownSampleNames undefined', () => {
    const g = fresh();
    // Add a sample-source layer with a name that is not a real sample.
    const lid = g.layers[0]!.id;
    g.sound_palette.layers[lid] = {
      source: { kind: 'sample', name: 'totally-fake-name', options: {} },
      effects: [],
    };
    const noOpt = validateSemanticInvariants(g);
    // Without knownSampleNames, no sample warning fires.
    expect(noOpt.warnings.find((w) => w.category === 'sample_name_unknown')).toBeUndefined();
    const withList = validateSemanticInvariants(g, { knownSampleNames: ['bd', 'sd', 'hh'] });
    expect(withList.warnings.find((w) => w.category === 'sample_name_unknown')).toBeDefined();
    expect(withList.ok).toBe(true); // sample issues are warnings, not errors
  });

  it('sample names with :index suffix match the base name in registry', () => {
    const g = fresh();
    const lid = g.layers[0]!.id;
    g.sound_palette.layers[lid] = {
      source: { kind: 'sample', name: 'bd:3', options: {} },
      effects: [],
    };
    // Fixture has other layers (e.g. 'hh') — only assert that the layer we
    // edited (bd:3) does NOT produce a warning.
    const r = validateSemanticInvariants(g, { knownSampleNames: ['bd', 'hh', 'bass', 'piano', 'pad'] });
    const warningPaths = r.warnings
      .filter((w) => w.category === 'sample_name_unknown')
      .map((w) => w.path);
    expect(warningPaths).not.toContain(`/sound_palette/layers/${lid}/source/name`);
  });

  it('formatSemanticReport produces a readable single-string summary', () => {
    const g = fresh();
    g.song.sections[0]!.end_bar -= 2;
    const r = validateSemanticInvariants(g);
    const s = formatSemanticReport(r);
    expect(s).toContain('FAIL');
    expect(s).toMatch(/section_coverage/);
  });
});
