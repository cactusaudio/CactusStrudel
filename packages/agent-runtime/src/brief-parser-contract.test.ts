// G11A audit-closeout (F): pin the parseBrief contract that the v2 audit
// fix relies on. Pre-fix, parseBrief silently returned `primary_genre:
// undefined` for "dub_techno 122 BPM ..." (underscore was outside the
// separator character class) and the audit's `if (!brief.primary_genre)
// continue;` silently down-counted prompts. After fix, parseBrief MUST
// either resolve a known genre or expose the failure loudly enough for
// the caller to handle it.

import { describe, it, expect } from 'vitest';
import { parseBrief } from './brief-parser.js';

describe('parseBrief contract (G11A closeout F)', () => {
  it('resolves "dub techno" (space) to dub_techno', () => {
    expect(parseBrief('dub techno 122 BPM, 16 bars').primary_genre).toBe('dub_techno');
  });

  it('resolves "dub-techno" (hyphen) to dub_techno', () => {
    expect(parseBrief('dub-techno 122 BPM, 16 bars').primary_genre).toBe('dub_techno');
  });

  it('resolves "dub_techno" (underscore) to dub_techno — closes audit-finding (B)', () => {
    expect(parseBrief('dub_techno 122 BPM, 16 bars').primary_genre).toBe('dub_techno');
  });

  it('returns primary_genre=undefined for nonsense — failure surface is honest, not silent', () => {
    const r = parseBrief('totally unrelated text 999 BPM');
    // Caller MUST check primary_genre; the audit harness now does.
    expect(r.primary_genre).toBeUndefined();
  });

  it('every smoke-real brief in the audit harness resolves to a primary_genre', () => {
    // Mirror SMOKE_BRIEFS from apps/cli/src/cookbook-impact-real.ts. If any of
    // these regress to undefined, the smoke-real audit will silently
    // down-count prompts again — exactly the bug Opus's audit caught.
    const SMOKE_BRIEFS = [
      'peak time techno 132 BPM, 16 bars, hypnotic',
      'dub techno 122 BPM, 16 bars, restrained chord stab',
      'dnb 174 BPM, 16 bars, rolling reese sub',
      'idm 120 BPM, 16 bars, asymmetric mutation',
      'ambient 80 BPM, 16 bars, sustained warm pad',
    ];
    for (const text of SMOKE_BRIEFS) {
      const g = parseBrief(text).primary_genre;
      expect(g, `brief "${text}" must resolve to a primary_genre`).toBeDefined();
    }
  });
});
