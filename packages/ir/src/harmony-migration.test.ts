// Migration / back-compat guard for the 1.0.0 → 1.1.0 harmony-spine
// schema bump (additive, non-destructive — design doc §6).
//
// The whole redesign is worthless if it breaks every session ever
// persisted. These tests pin the additive contract:
//   1. a real 1.0.0 graph WITHOUT /harmony validates unchanged
//   2. that same graph + /harmony + version 1.1.0 validates
//   3. a PatternEntry carrying a /harmonic derivation validates
//   4. HarmonyGraph optional fields default (no caller boilerplate)
//   5. an UNSUPPORTED version is still rejected (the enum is a real
//      gate, not a vacuous "accept anything" widening)

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { fixturePath } from './fixtures.js';
import {
  SessionGraphSchema,
  HarmonyGraphSchema,
  SUPPORTED_SCHEMA_VERSIONS,
  SCHEMA_VERSION,
} from './schema.js';

async function rawTechno(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(fixturePath('techno'), 'utf8'));
}

describe('harmony migration 1.0.0 → 1.1.0 (additive, non-destructive)', () => {
  it('1.0.0 graph without /harmony still validates (back-compat)', async () => {
    const g = await rawTechno();
    expect(g.schema_version).toBe('1.0.0');
    expect(g).not.toHaveProperty('harmony');
    expect(() => SessionGraphSchema.parse(g)).not.toThrow();
  });

  it('same graph + /harmony + version 1.1.0 validates (forward)', async () => {
    const g = await rawTechno();
    g.schema_version = '1.1.0';
    g.harmony = {
      key: { tonic: 'c', mode: 'minor' },
      progression: ['Cm', 'Ab', 'Eb', 'Bb'],
    };
    const parsed = SessionGraphSchema.parse(g);
    expect(parsed.harmony?.progression).toEqual(['Cm', 'Ab', 'Eb', 'Bb']);
  });

  it('a PatternEntry carrying /harmonic derivation validates', async () => {
    const g = await rawTechno();
    g.schema_version = '1.1.0';
    g.harmony = { key: { tonic: 'c', mode: 'minor' }, progression: ['Cm', 'Fm'] };
    // techno fixture has pattern_bank.patterns.kick.s1
    const pb = g.pattern_bank as { patterns: Record<string, Record<string, Record<string, unknown>>> };
    pb.patterns.kick!.s1!.harmonic = {
      source: 'progression',
      role_derivation: 'root',
      octave_shift: -1,
    };
    expect(() => SessionGraphSchema.parse(g)).not.toThrow();
  });

  it('HarmonyGraph optional fields default (no caller boilerplate)', () => {
    const h = HarmonyGraphSchema.parse({
      key: { tonic: 'c', mode: 'minor' },
      progression: ['Cm'],
    });
    expect(h.progression_rhythm).toBe('<0>/1');
    expect(h.modulation).toEqual([]);
    expect(h.anchors.bass).toBe('c2');
    expect(h.anchors.lead).toBe('c5');
  });

  it('an unsupported schema_version is still rejected (real gate)', async () => {
    const g = await rawTechno();
    g.schema_version = '0.9.0';
    expect(() => SessionGraphSchema.parse(g)).toThrow();
  });

  it('SUPPORTED_SCHEMA_VERSIONS includes both 1.0.0 and the current', () => {
    expect(SUPPORTED_SCHEMA_VERSIONS).toContain('1.0.0');
    expect(SUPPORTED_SCHEMA_VERSIONS).toContain(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe('1.1.0');
  });
});
