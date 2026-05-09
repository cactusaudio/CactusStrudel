import { describe, it, expect } from 'vitest';
import { loadGenre, listGenres, loadCookbookSnippets, pickSnippet, bridgeGenres } from './index.js';
import { validateMiniNotation } from '@cactus/strudel-validator';

describe('genre loading', () => {
  it('lists at least 6 genres', async () => {
    const slugs = await listGenres();
    expect(slugs.length).toBeGreaterThanOrEqual(6);
    expect(slugs).toEqual(expect.arrayContaining(['techno', 'dub_techno', 'house', 'dnb', 'idm', 'ambient']));
  });

  it('loads techno genre with valid spec', async () => {
    const g = await loadGenre('techno');
    expect(g.slug).toBe('techno');
    expect(g.bpm_range[0]).toBeLessThan(g.bpm_range[1]);
    expect(g.section_template.length).toBeGreaterThan(0);
    expect(g.mix_targets.lufs).toBeLessThan(0);
  });

  it('loads dub_techno with reverb_send_chord_min target', async () => {
    const g = await loadGenre('dub_techno');
    expect(g.mix_targets.reverb_send_chord_min).toBeGreaterThan(0);
  });
});

describe('cookbook snippets', () => {
  for (const genre of ['techno', 'dub_techno', 'dnb', 'idm']) {
    it(`${genre} snippets all parse as valid mini-notation`, async () => {
      const snippets = await loadCookbookSnippets(genre);
      expect(snippets.length).toBeGreaterThan(0);
      for (const s of snippets) {
        if (s.mini_notation) {
          const r = validateMiniNotation(s.mini_notation);
          expect(r.ok, `snippet ${s.id}: ${s.mini_notation} -> ${JSON.stringify(r.issues)}`).toBe(true);
        }
      }
    });
  }

  it('pickSnippet picks bpm-matching snippet', async () => {
    const snips = await loadCookbookSnippets('techno', 'kick');
    let last: string | undefined;
    const rng = () => 0.3;
    const pick = pickSnippet(snips, 132, rng);
    expect(pick).toBeDefined();
    expect(pick!.bpm_range).toBeDefined();
    expect(pick!.bpm_range![0]).toBeLessThanOrEqual(132);
    expect(pick!.bpm_range![1]).toBeGreaterThanOrEqual(132);
  });
});

describe('genre bridging', () => {
  it('bridges techno × dnb to a hybrid spec', async () => {
    const a = await loadGenre('techno');
    const b = await loadGenre('dnb');
    const bridged = bridgeGenres({ primary: a, secondary: b, weight: 0.3 });
    expect(bridged.slug).toBe('techno_x_dnb');
    // BPM range is a weighted blend toward primary.
    expect(bridged.bpm_range[0]).toBeGreaterThan(a.bpm_range[0]);
    expect(bridged.bpm_range[0]).toBeLessThan(b.bpm_range[0]);
    // Drum archetypes pool is union.
    expect(bridged.drum_archetypes.length).toBeGreaterThan(a.drum_archetypes.length);
  });
});
