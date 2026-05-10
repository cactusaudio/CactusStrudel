// G9B §4 + §10: mutation policy tests. Mutations must preserve genre, role,
// section compatibility, forbidden_constraints, and validate against the
// schema. Failure to satisfy ⇒ operator must return null.

import { describe, it, expect } from 'vitest';
import {
  applyMutation, tryMutate, listMutationOperators,
  CookbookEntrySchema, COOKBOOK_SCHEMA_VERSION, type CookbookEntry,
} from './index.js';

const baseRhythmic = (over: Partial<CookbookEntry> = {}): CookbookEntry => CookbookEntrySchema.parse({
  schema_version: COOKBOOK_SCHEMA_VERSION,
  id: 'test-rhythmic-001',
  genre: 'techno',
  role: 'kick',
  mini_notation: 'bd ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~',
  energy_range: ['mid'],
  bpm_range: [128, 138],
  bar_intent: 'fixture: sparse 4-on-4 kick that tolerates densification',
  compatible_sections: ['main'],
  source_type: 'authored', provenance_note: 'test fixture',
  ...over,
});

const baseMix = (over: Partial<CookbookEntry> = {}): CookbookEntry => CookbookEntrySchema.parse({
  schema_version: COOKBOOK_SCHEMA_VERSION,
  id: 'test-mix-001',
  genre: 'techno',
  role: 'chord_stab',
  mini_notation: '<a3 c4 e4>',
  energy_range: ['mid'],
  bpm_range: [120, 128],
  bar_intent: 'fixture: chord stab with mix implications for reverb_up testing',
  compatible_sections: ['main'],
  mix_implications: { prefers_orbit_gain_db: 0, prefers_room_send: 0.4 },
  source_type: 'authored', provenance_note: 'test fixture',
  ...over,
});

describe('mutations (G9B §4)', () => {
  it('listMutationOperators reports the implemented and stub operators', () => {
    const ops = listMutationOperators();
    expect(ops).toContain('density_up');
    expect(ops).toContain('density_down');
    expect(ops).toContain('gain_up');
    expect(ops).toContain('reverb_up');
  });

  it('density_up turns a sparse pattern into something denser', () => {
    const e = baseRhythmic();
    const r = applyMutation(e, 'density_up');
    expect(r).not.toBeNull();
    expect(r!.after.mini_notation).not.toBe(e.mini_notation);
    expect(r!.after.mini_notation!.includes('bd ')).toBe(true);
    // Must still validate.
    const re = CookbookEntrySchema.safeParse(r!.after);
    expect(re.success).toBe(true);
  });

  it('density_up preserves genre, role, energy_range, compatible_sections', () => {
    const e = baseRhythmic();
    const r = applyMutation(e, 'density_up')!;
    expect(r.after.genre).toBe(e.genre);
    expect(r.after.role).toBe(e.role);
    expect(r.after.energy_range).toEqual(e.energy_range);
    expect(r.after.compatible_sections).toEqual(e.compatible_sections);
    expect(r.after.forbidden_constraints).toEqual(e.forbidden_constraints);
  });

  it('density_down returns null for a pattern with too few hits', () => {
    const e = baseRhythmic({ id: 'test-rhythmic-2', mini_notation: 'bd ~ ~ ~' });
    const r = applyMutation(e, 'density_down');
    expect(r).toBeNull();
  });

  it('density_down thins a dense pattern', () => {
    const dense = baseRhythmic({ id: 'test-rhythmic-3', mini_notation: 'bd bd bd bd bd bd bd bd' });
    const r = applyMutation(dense, 'density_down');
    expect(r).not.toBeNull();
    expect(r!.after.mini_notation).toContain('~');
  });

  it('gain_up moves prefers_orbit_gain_db within the safe clamp', () => {
    const e = baseMix({ mix_implications: { prefers_orbit_gain_db: 0, prefers_room_send: 0.4 } });
    const r = applyMutation(e, 'gain_up');
    expect(r).not.toBeNull();
    expect(r!.after.mix_implications.prefers_orbit_gain_db).toBe(1.5);
  });

  it('gain_up returns null when the entry has no mix_implications.prefers_orbit_gain_db', () => {
    const e = baseRhythmic(); // rhythmic fixture has no gain implication
    const r = applyMutation(e, 'gain_up');
    expect(r).toBeNull();
  });

  it('reverb_up clamps room_send at 1.0', () => {
    const e = baseMix({ mix_implications: { prefers_room_send: 0.95 } });
    const r = applyMutation(e, 'reverb_up');
    expect(r).not.toBeNull();
    expect(r!.after.mix_implications.prefers_room_send).toBe(1);
  });

  it('reverb_down clamps room_send at 0', () => {
    const e = baseMix({ mix_implications: { prefers_room_send: 0.05 } });
    const r = applyMutation(e, 'reverb_down');
    expect(r).not.toBeNull();
    expect(r!.after.mix_implications.prefers_room_send).toBe(0);
  });

  it('tryMutate falls through operators in order until one applies', () => {
    const e = baseRhythmic();
    // gain_up does not apply (no mix_implications); density_up should.
    const r = tryMutate(e, ['gain_up', 'density_up']);
    expect(r).not.toBeNull();
    expect(r!.operator).toBe('density_up');
  });

  it('tryMutate returns null when no operator can apply', () => {
    const sparse = baseRhythmic({ id: 'test-rhythmic-4', mini_notation: '~' });
    const r = tryMutate(sparse, ['density_up', 'density_down']);
    expect(r).toBeNull();
  });

  it('mutation result has a unique id and a non-empty delta string', () => {
    const e = baseRhythmic();
    const r = applyMutation(e, 'density_up')!;
    expect(r.after.id).not.toBe(e.id);
    expect(r.delta.length).toBeGreaterThan(5);
  });
});
