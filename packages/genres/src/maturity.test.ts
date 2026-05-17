// Gap2: pin the genre-maturity registry as a single source of truth with
// evidence-cited tiers. A tier must never silently drift to "production"
// without an evidence string + source.

import { describe, it, expect } from 'vitest';
import {
  GENRE_MATURITY, genreMaturity, productionGenres,
  isProductionGrade, maturityLabel,
} from './maturity.js';

describe('genre maturity registry (Gap2)', () => {
  it('every entry cites evidence and a source — no opinion-only tiers', () => {
    for (const [slug, m] of Object.entries(GENRE_MATURITY)) {
      expect(m.slug).toBe(slug);
      expect(m.evidence.length, `${slug} must cite evidence`).toBeGreaterThan(10);
      expect(m.evidence_source.length, `${slug} must cite a source`).toBeGreaterThan(0);
    }
  });

  it('production-tier genres have no next_blocker; non-production do', () => {
    for (const m of Object.values(GENRE_MATURITY)) {
      if (m.tier === 'production') {
        expect(m.next_blocker, `${m.slug} is production → no blocker`).toBeNull();
      } else {
        expect(m.next_blocker, `${m.slug} is ${m.tier} → must name a blocker`).not.toBeNull();
      }
    }
  });

  it('the 5 core genres are production-grade post-Gap1 (the brittle-gate artifact is gone)', () => {
    for (const core of ['techno', 'dnb', 'dub_techno', 'idm', 'ambient']) {
      expect(isProductionGrade(core), `${core} should be production post-Gap1`).toBe(true);
    }
  });

  it('productionGenres() returns exactly the production-tier slugs, sorted', () => {
    const list = productionGenres();
    expect(list).toEqual([...list].sort());
    for (const slug of list) expect(GENRE_MATURITY[slug]!.tier).toBe('production');
  });

  it('unknown genre resolves to untested with a concrete blocker, never throws', () => {
    const m = genreMaturity('does-not-exist');
    expect(m.tier).toBe('untested');
    expect(m.next_blocker).toMatch(/add does-not-exist/);
  });

  it('maturityLabel tags non-production genres honestly', () => {
    expect(maturityLabel('techno')).toBe('techno');
    expect(maturityLabel('house')).toBe('house [untested]');
  });

  it('the registry references Gap1 — proving the reframing is documented in-code', () => {
    // dub_techno + idm evidence must explicitly attribute the prior
    // pessimism to the brittle-gate artifact, so the history isn't lost.
    expect(GENRE_MATURITY.dub_techno!.evidence).toMatch(/artifact|brittle/i);
    expect(GENRE_MATURITY.idm!.evidence).toMatch(/artifact|brittle/i);
  });
});
