// Guard for the deterministic genre → harmonic-spine resolver.
// Wrong chords here = every demo is wrong-key; this is the layer the
// ear verdict ultimately judges, so the theory must be exactly right.

import { describe, it, expect } from 'vitest';
import { loadGenre } from '@cactus/genres';
import { romanToChordSymbol, genreHarmony, roleDerivation } from './harmony-spine.js';

describe('romanToChordSymbol (functional harmony)', () => {
  it('A natural minor diatonic triads', () => {
    const m = (r: string) => romanToChordSymbol(r, 'a', 'minor');
    expect(m('i')).toBe('Am');
    expect(m('ii')).toBe('Bdim');
    expect(m('III')).toBe('C');
    expect(m('iv')).toBe('Dm');
    expect(m('v')).toBe('Em');
    expect(m('VI')).toBe('F');
    expect(m('VII')).toBe('G');
  });

  it('C major diatonic triads', () => {
    const m = (r: string) => romanToChordSymbol(r, 'c', 'major');
    expect(m('I')).toBe('C');
    expect(m('ii')).toBe('Dm');
    expect(m('IV')).toBe('F');
    expect(m('V')).toBe('G');
    expect(m('vi')).toBe('Am');
    expect(m('vii')).toBe('Bdim');
  });

  it('unparseable / free token → undefined', () => {
    expect(romanToChordSymbol('free', 'a', 'minor')).toBeUndefined();
    expect(romanToChordSymbol('', 'a', 'minor')).toBeUndefined();
  });
});

describe('genreHarmony consumes the genre SSOT (no invented chords)', () => {
  it('techno → A minor i-VI-VII, moving rhythm', async () => {
    const h = genreHarmony(await loadGenre('techno'));
    expect(h.key).toEqual({ tonic: 'a', mode: 'minor' });
    expect(h.progression).toEqual(['Am', 'F', 'G']); // ["i","VI","VII"]
    expect(h.progression_rhythm).toBe('<0 1 2>'); // one chord/cycle — not a drone
    expect(h.anchors.bass).toBe('a1');
  });

  it('ambient → skips [free], picks the first ≥2-chord progression', async () => {
    const h = genreHarmony(await loadGenre('ambient'));
    // modes[0]=dorian → tonic a; progs [free],["I"],["I","iii"]
    expect(h.key.mode).toBe('dorian');
    expect(h.progression.length).toBeGreaterThanOrEqual(2);
    for (const c of h.progression) expect(c).toMatch(/^[A-G][b#]?(m|dim|aug)?$/);
  });

  it('every demo genre yields ≥1 schema-valid chord', async () => {
    for (const slug of ['techno', 'dub_techno', 'ambient', 'dnb', 'idm'] as const) {
      const h = genreHarmony(await loadGenre(slug));
      expect(h.progression.length).toBeGreaterThanOrEqual(1);
      for (const c of h.progression) {
        expect(c).toMatch(/^[A-G][b#]?(m|maj7|m7|7|dim|aug|sus2|sus4|add9|6|9|11|13)?$/);
      }
    }
  });

  it('is deterministic — same genre → identical spine', async () => {
    const g = await loadGenre('dnb');
    expect(genreHarmony(g)).toEqual(genreHarmony(g));
  });
});

describe('roleDerivation', () => {
  it('pitched roles derive; drums do not', () => {
    expect(roleDerivation('bass')?.role_derivation).toBe('root');
    expect(roleDerivation('sub')?.role_derivation).toBe('root');
    expect(roleDerivation('chord')?.role_derivation).toBe('chord_voiced');
    expect(roleDerivation('pad')?.role_derivation).toBe('chord_voiced');
    expect(roleDerivation('lead')?.role_derivation).toBe('degree_line');
    expect(roleDerivation('arp')?.role_derivation).toBe('arp');
    expect(roleDerivation('kick')).toBeUndefined();
    expect(roleDerivation('hat')).toBeUndefined();
    expect(roleDerivation('snare')).toBeUndefined();
  });
});
