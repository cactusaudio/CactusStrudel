// G9C §5 + §10: cookbook quarantine + retrieval exclusion tests.

import { describe, it, expect } from 'vitest';
import {
  CookbookEntrySchema, COOKBOOK_SCHEMA_VERSION,
  retrieve, type CookbookEntry,
} from './index.js';
import { isAllRest } from './mutations.js';

const baseEntry = (over: Partial<CookbookEntry> = {}): CookbookEntry => CookbookEntrySchema.parse({
  schema_version: COOKBOOK_SCHEMA_VERSION,
  id: 'qt-001',
  genre: 'techno',
  role: 'kick',
  mini_notation: 'bd ~ ~ ~',
  energy_range: ['mid'],
  bpm_range: [128, 138],
  bar_intent: 'fixture for quarantine retrieval-exclusion testing',
  compatible_sections: ['main'],
  source_type: 'authored', provenance_note: 'test',
  ...over,
});

describe('quarantine + retrieval exclusion (G9C §5)', () => {
  it('quarantined entries are hard-excluded even with include_diagnostic', () => {
    const corpus = [
      baseEntry({ id: 'qt-001', validation_status: 'accepted' }),
      baseEntry({ id: 'qt-002', validation_status: 'quarantined' }),
    ];
    const r1 = retrieve(corpus, { genre: 'techno', role: 'kick' });
    expect(r1.find((x) => x.entry.id === 'qt-002')).toBeUndefined();
    const r2 = retrieve(corpus, { genre: 'techno', role: 'kick', include_diagnostic: true });
    expect(r2.find((x) => x.entry.id === 'qt-002')).toBeUndefined();
  });

  it('rejected entries are hard-excluded', () => {
    const corpus = [
      baseEntry({ id: 'qt-001', validation_status: 'accepted' }),
      baseEntry({ id: 'qt-002', validation_status: 'rejected' }),
    ];
    const r = retrieve(corpus, { genre: 'techno', role: 'kick' });
    expect(r.find((x) => x.entry.id === 'qt-002')).toBeUndefined();
  });

  it('experimental entries are excluded by default but included with include_diagnostic', () => {
    const corpus = [
      baseEntry({ id: 'qt-001', validation_status: 'accepted' }),
      baseEntry({ id: 'qt-002', validation_status: 'experimental' }),
    ];
    const r1 = retrieve(corpus, { genre: 'techno', role: 'kick' });
    expect(r1.find((x) => x.entry.id === 'qt-002')).toBeUndefined();
    const r2 = retrieve(corpus, { genre: 'techno', role: 'kick', include_diagnostic: true });
    expect(r2.find((x) => x.entry.id === 'qt-002')).toBeDefined();
  });

  it('accepted_with_warning entries are excluded by default but included with allow_warnings', () => {
    const corpus = [
      baseEntry({ id: 'qt-001', validation_status: 'accepted' }),
      baseEntry({ id: 'qt-002', validation_status: 'accepted_with_warning' }),
    ];
    const r1 = retrieve(corpus, { genre: 'techno', role: 'kick' });
    expect(r1.find((x) => x.entry.id === 'qt-002')).toBeUndefined();
    const r2 = retrieve(corpus, { genre: 'techno', role: 'kick', allow_warnings: true });
    expect(r2.find((x) => x.entry.id === 'qt-002')).toBeDefined();
  });

  it('candidate entries are still retrievable but unscored', () => {
    // candidate is a v2 lifecycle state; we did NOT add a hard-exclude for it,
    // it should still be retrievable like unvalidated.
    const corpus = [baseEntry({ id: 'qt-001', validation_status: 'candidate' })];
    const r = retrieve(corpus, { genre: 'techno', role: 'kick' });
    expect(r.find((x) => x.entry.id === 'qt-001')).toBeDefined();
  });
});

describe('mutation all-rest guard (G9C §4)', () => {
  it('isAllRest returns true for empty pattern', () => {
    expect(isAllRest('')).toBe(true);
    expect(isAllRest('   ')).toBe(true);
    expect(isAllRest('~')).toBe(true);
    expect(isAllRest('~ ~ ~ ~')).toBe(true);
  });

  it('isAllRest returns false for any pattern with at least one hit', () => {
    expect(isAllRest('bd ~ ~ ~')).toBe(false);
    expect(isAllRest('~ ~ sd ~')).toBe(false);
  });

  it('isAllRest tolerates operators when checking', () => {
    expect(isAllRest('[~ ~]*4')).toBe(true);
    expect(isAllRest('[~ bd]*4')).toBe(false);
  });
});
