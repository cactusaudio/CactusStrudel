// G9B §1 + §10: cookbook prior adapter tests. Verifies mode dispatch,
// IR-role mapping, energy-band mapping, and trace structure.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCookbookMode, mapIrRoleToCookbookRole, energyToBand,
  selectPrior, _resetCookbookCacheForTests,
} from './cookbook-prior.js';

beforeEach(() => {
  delete process.env.CACTUS_COOKBOOK_MODE;
  _resetCookbookCacheForTests();
});

afterEach(() => {
  delete process.env.CACTUS_COOKBOOK_MODE;
});

describe('cookbook-prior mode dispatch (G9B)', () => {
  it('defaults to minimal when env var unset', () => {
    expect(getCookbookMode()).toBe('minimal');
  });

  it('reads enabled / enabled_mutating from CACTUS_COOKBOOK_MODE', () => {
    process.env.CACTUS_COOKBOOK_MODE = 'enabled';
    expect(getCookbookMode()).toBe('enabled');
    process.env.CACTUS_COOKBOOK_MODE = 'enabled_mutating';
    expect(getCookbookMode()).toBe('enabled_mutating');
  });

  it('treats unknown values as minimal (no surprise upgrades)', () => {
    process.env.CACTUS_COOKBOOK_MODE = 'super-experimental';
    expect(getCookbookMode()).toBe('minimal');
  });
});

describe('cookbook-prior role + energy mapping (G9B)', () => {
  it('maps every IR role to either a cookbook role or null', () => {
    const ROLES = [
      'kick', 'snare', 'clap', 'rim', 'hat', 'cymbal', 'percussion',
      'bass', 'sub', 'chord', 'pad', 'lead', 'arp', 'pluck',
      'fx', 'riser', 'impact', 'noise', 'vocal', 'foley',
    ] as const;
    for (const r of ROLES) {
      const m = mapIrRoleToCookbookRole(r);
      expect(m === null || typeof m === 'string').toBe(true);
    }
  });

  it('clap and snare both map to clap_snare', () => {
    expect(mapIrRoleToCookbookRole('clap')).toBe('clap_snare');
    expect(mapIrRoleToCookbookRole('snare')).toBe('clap_snare');
  });

  it('chord maps to chord_stab; pad maps to pad_atmo', () => {
    expect(mapIrRoleToCookbookRole('chord')).toBe('chord_stab');
    expect(mapIrRoleToCookbookRole('pad')).toBe('pad_atmo');
  });

  it('vocal maps to null (not modeled in cookbook)', () => {
    expect(mapIrRoleToCookbookRole('vocal')).toBeNull();
  });

  it('energyToBand splits 0..1 into low / mid / high / peak', () => {
    expect(energyToBand(0.1)).toBe('low');
    expect(energyToBand(0.5)).toBe('mid');
    expect(energyToBand(0.7)).toBe('high');
    expect(energyToBand(0.9)).toBe('peak');
  });
});

describe('selectPrior trace shape (G9B)', () => {
  it('returns trace=role-not-modeled when IR role has no cookbook mapping', async () => {
    const r = await selectPrior({
      genre: 'techno',
      layer: { id: 'lyr-1', role: 'vocal' },
      section: { id: 'sec-1', function: 'main', energy: 0.6 },
      bpm: 130,
    });
    expect(r.entry).toBeNull();
    expect(r.trace.fallback_reason).toBe('role-not-modeled');
  });

  it('returns policy-disabled for an unknown genre (G9C policy gate)', async () => {
    const r = await selectPrior({
      genre: 'totally-not-a-genre',
      layer: { id: 'lyr-1', role: 'kick' },
      section: { id: 'sec-1', function: 'main', energy: 0.7 },
      bpm: 130,
    });
    expect(r.entry).toBeNull();
    // G9C: the activation policy gate short-circuits unknown (genre, role)
    // pairs to default minimal_only — we report this as a policy-disabled
    // fallback, NOT a no-cookbook-match (which is now reserved for the
    // case where policy says enable but the cookbook has nothing).
    expect(r.trace.fallback_reason).toMatch(/^policy-disabled:/);
  });

  it('returns no-cookbook-match when policy enables but cookbook empty', async () => {
    const r = await selectPrior({
      genre: 'totally-not-a-genre',
      layer: { id: 'lyr-1', role: 'kick' },
      section: { id: 'sec-1', function: 'main', energy: 0.7 },
      bpm: 130,
      policy: {
        default_level: 'enabled_default',
        default_reason: 'test override',
        per_genre_role: {},
      },
    });
    expect(r.entry).toBeNull();
    expect(r.trace.fallback_reason).toBe('no-cookbook-match');
  });

  it('returns a real validator-passed entry + populated trace for a matched query (techno kick / main)', async () => {
    const r = await selectPrior({
      genre: 'techno',
      layer: { id: 'lyr-1', role: 'kick' },
      section: { id: 'sec-1', function: 'main', energy: 0.7 },
      bpm: 130,
    });
    expect(r.entry).not.toBeNull();
    expect(r.entry!.validation_status).toBe('validator_passed');
    expect(r.trace.candidates_total).toBeGreaterThan(0);
    expect(r.trace.candidates_top_ids.length).toBeGreaterThan(0);
    expect(r.trace.selected_id).not.toBeNull();
    expect(r.trace.selection_reason).not.toBeNull();
    expect(r.trace.cookbook_role).toBe('kick');
  });

  it('honors seen_ids by penalizing already-picked entries (different selection on second call)', async () => {
    const a = await selectPrior({
      genre: 'techno',
      layer: { id: 'lyr-1', role: 'kick' },
      section: { id: 'sec-1', function: 'main', energy: 0.7 },
      bpm: 130,
    });
    expect(a.entry).not.toBeNull();
    const b = await selectPrior({
      genre: 'techno',
      layer: { id: 'lyr-1', role: 'kick' },
      section: { id: 'sec-1', function: 'main', energy: 0.7 },
      bpm: 130,
      seen_ids: [a.entry!.id],
    });
    expect(b.entry).not.toBeNull();
    // pickOne returns first non-seen — must differ from the first pick when alternatives exist.
    expect(b.entry!.id).not.toBe(a.entry!.id);
  });
});
