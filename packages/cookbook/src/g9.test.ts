// G9 §11: tests across the cookbook surface. Where reasonable these check
// semantic behavior, not just shape — schema rejection cases, retrieval
// ranking, similarity detection, vocab → query bridge.

import { describe, it, expect } from 'vitest';
import {
  CookbookEntrySchema, COOKBOOK_SCHEMA_VERSION,
  validateCookbook, formatValidationReport,
  retrieve, pickOne,
  ngramOverlap, ngrams, tokenize, gridHash,
  findNearDuplicates, diversityReport,
  loadReferenceDescriptor, listReferenceDescriptors,
  buildQueryFromVocab,
  loadCookbookEntries,
  type CookbookEntry,
} from './index.js';

const baseEntry = (over: Partial<CookbookEntry> = {}): CookbookEntry => CookbookEntrySchema.parse({
  schema_version: COOKBOOK_SCHEMA_VERSION,
  id: 'test-001',
  genre: 'techno',
  role: 'kick',
  mini_notation: 'bd*4',
  energy_range: ['mid'],
  bpm_range: [128, 138],
  bar_intent: 'driving 4-on-floor for tests — 8+ characters',
  compatible_sections: ['main'],
  source_type: 'authored',
  provenance_note: 'test fixture',
  ...over,
});

describe('cookbook schema (G9 §1)', () => {
  it('rejects entry with both mini_notation and raw', () => {
    const r = CookbookEntrySchema.safeParse({
      schema_version: COOKBOOK_SCHEMA_VERSION,
      id: 'x', genre: 'techno', role: 'kick',
      mini_notation: 'bd*4', raw: 'bd*4',
      energy_range: ['mid'], bpm_range: [128, 138],
      bar_intent: 'long enough intent',
      compatible_sections: ['main'],
      source_type: 'authored', provenance_note: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('rejects entry with neither mini_notation nor raw', () => {
    const r = CookbookEntrySchema.safeParse({
      schema_version: COOKBOOK_SCHEMA_VERSION,
      id: 'x', genre: 'techno', role: 'kick',
      energy_range: ['mid'], bpm_range: [128, 138],
      bar_intent: 'long enough intent',
      compatible_sections: ['main'],
      source_type: 'authored', provenance_note: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('rejects too-short bar_intent', () => {
    const r = CookbookEntrySchema.safeParse({
      schema_version: COOKBOOK_SCHEMA_VERSION,
      id: 'x', genre: 'techno', role: 'kick', mini_notation: 'bd*4',
      energy_range: ['mid'], bpm_range: [128, 138],
      bar_intent: 'short',
      compatible_sections: ['main'],
      source_type: 'authored', provenance_note: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown sound_palette_tag', () => {
    const r = CookbookEntrySchema.safeParse({
      schema_version: COOKBOOK_SCHEMA_VERSION,
      id: 'x', genre: 'techno', role: 'kick', mini_notation: 'bd*4',
      energy_range: ['mid'], bpm_range: [128, 138],
      bar_intent: 'long enough intent',
      compatible_sections: ['main'],
      sound_palette_tags: ['neon'], // not in enum
      source_type: 'authored', provenance_note: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown role', () => {
    const r = CookbookEntrySchema.safeParse({
      schema_version: COOKBOOK_SCHEMA_VERSION,
      id: 'x', genre: 'techno', role: 'banjo', mini_notation: 'bd*4',
      energy_range: ['mid'], bpm_range: [128, 138],
      bar_intent: 'long enough intent',
      compatible_sections: ['main'],
      source_type: 'authored', provenance_note: 'x',
    });
    expect(r.success).toBe(false);
  });
});

describe('cookbook validation (G9 §2)', () => {
  it('the repo cookbook validates clean (acceptance gate)', async () => {
    const r = await validateCookbook();
    if (!r.ok) throw new Error(`cookbook is invalid:\n${formatValidationReport(r)}`);
    expect(r.total_entries).toBeGreaterThanOrEqual(40);
  });

  it('genre+role count metadata matches expected core genres', async () => {
    const r = await validateCookbook();
    const genres = new Set(r.per_genre_role.map((x) => x.genre));
    for (const required of ['techno', 'dub_techno', 'dnb', 'idm', 'ambient']) {
      expect(genres.has(required)).toBe(true);
    }
  });
});

describe('cookbook retrieval (G9 §4)', () => {
  const corpus: CookbookEntry[] = [
    baseEntry({ id: 'aaa', sound_palette_tags: ['punchy'], compatible_sections: ['main', 'drop'] }),
    baseEntry({ id: 'bbb', sound_palette_tags: ['punchy', 'aggressive'], compatible_sections: ['drop'], incompatible_sections: ['intro'] }),
    baseEntry({ id: 'ccc', sound_palette_tags: ['restrained'], compatible_sections: ['intro', 'main'] }),
    baseEntry({ id: 'ddd', genre: 'house' }),
    baseEntry({ id: 'eee', validation_status: 'experimental' }),
  ];

  it('filters out entries from other genres', () => {
    const r = retrieve(corpus, { genre: 'techno', role: 'kick' });
    expect(r.find((x) => x.entry.id === 'ddd')).toBeUndefined();
  });

  it('excludes incompatible sections', () => {
    const r = retrieve(corpus, { genre: 'techno', role: 'kick', section: 'intro' });
    expect(r.find((x) => x.entry.id === 'bbb')).toBeUndefined();
    expect(r.find((x) => x.entry.id === 'ccc')).toBeDefined(); // c is compatible with intro
  });

  it('excludes experimental entries unless include_diagnostic', () => {
    const r1 = retrieve(corpus, { genre: 'techno', role: 'kick' });
    expect(r1.find((x) => x.entry.id === 'eee')).toBeUndefined();
    const r2 = retrieve(corpus, { genre: 'techno', role: 'kick', include_diagnostic: true });
    expect(r2.find((x) => x.entry.id === 'eee')).toBeDefined();
  });

  it('ranks tag-matches above non-matches', () => {
    const r = retrieve(corpus, { genre: 'techno', role: 'kick', section: 'main', prefer_tags: ['punchy'] });
    const ids = r.map((x) => x.entry.id);
    // a and b have 'punchy' (b is incompatible-section if section=main? no, b is incompat with 'intro' only),
    // c does NOT — so a or b must rank above c
    expect(ids.indexOf('aaa')).toBeLessThan(ids.indexOf('ccc'));
  });

  it('forbid_tags hard-excludes entries', () => {
    const r = retrieve(corpus, { genre: 'techno', role: 'kick', forbid_tags: ['punchy'] });
    expect(r.find((x) => x.entry.id === 'aaa')).toBeUndefined();
    expect(r.find((x) => x.entry.id === 'bbb')).toBeUndefined();
    expect(r.find((x) => x.entry.id === 'ccc')).toBeDefined();
  });

  it('seen_ids penalizes but does not exclude when alternatives exist', () => {
    const r = retrieve(corpus, { genre: 'techno', role: 'kick', section: 'main', seen_ids: ['aaa'] });
    expect(r.find((x) => x.entry.id === 'aaa')).toBeDefined();
    // a's score is now negative; c outranks it
    const ids = r.map((x) => x.entry.id);
    expect(ids.indexOf('ccc')).toBeLessThan(ids.indexOf('aaa'));
  });

  it('pickOne returns first non-seen when alternatives exist', () => {
    const picked = pickOne(corpus, { genre: 'techno', role: 'kick', section: 'main', seen_ids: ['aaa'] });
    expect(picked).toBeDefined();
    expect(picked!.id).not.toBe('aaa');
  });

  it('pickOne returns undefined when nothing matches', () => {
    const picked = pickOne(corpus, { genre: 'unknown_genre', role: 'kick' });
    expect(picked).toBeUndefined();
  });
});

describe('cookbook similarity (G9 §9)', () => {
  it('tokenize strips operators', () => {
    expect(tokenize('[bd ~ ~ ~]*2')).toEqual(['bd', '2']);
  });

  it('ngramOverlap is 1.0 for identical sequences', () => {
    const a = ngrams(tokenize('bd bd bd bd'), 3);
    const b = ngrams(tokenize('bd bd bd bd'), 3);
    expect(ngramOverlap(a, b)).toBe(1);
  });

  it('ngramOverlap is 0 for disjoint sequences', () => {
    const a = ngrams(tokenize('bd bd'), 3);
    const b = ngrams(tokenize('hh hh'), 3);
    expect(ngramOverlap(a, b)).toBe(0);
  });

  it('gridHash collapses identifier names while keeping structure', () => {
    expect(gridHash('bd ~ ~ ~')).toBe(gridHash('sd ~ ~ ~'));
    expect(gridHash('bd ~ bd ~')).not.toBe(gridHash('bd bd ~ ~'));
  });

  it('findNearDuplicates flags identical-by-grid-and-tokens entries', () => {
    const a = baseEntry({ id: 'aaa', mini_notation: 'bd ~ ~ ~ bd ~ ~ ~' });
    const b = baseEntry({ id: 'bbb', mini_notation: 'bd ~ ~ ~ bd ~ ~ ~' });
    const c = baseEntry({ id: 'ccc', mini_notation: 'bd bd bd bd' });
    const dups = findNearDuplicates([a, b, c]);
    expect(dups.find((p) => (p.a_id === 'aaa' && p.b_id === 'bbb') || (p.a_id === 'bbb' && p.b_id === 'aaa'))?.near_duplicate).toBe(true);
    expect(dups.find((p) => p.a_id === 'ccc' || p.b_id === 'ccc')?.near_duplicate ?? false).toBe(false);
  });

  it('findNearDuplicates does NOT cross genre/role boundaries', () => {
    const a = baseEntry({ id: 'aaa', mini_notation: 'bd ~ ~ ~' });
    const b = baseEntry({ id: 'bbb', genre: 'house', mini_notation: 'bd ~ ~ ~' });
    const dups = findNearDuplicates([a, b]);
    expect(dups).toEqual([]);
  });

  it('diversityReport reports per-genre/role counts and homogeneity', () => {
    const corpus = [
      baseEntry({ id: 'aaa', mini_notation: 'bd ~ ~ ~ bd ~ ~ ~' }),
      baseEntry({ id: 'bbb', mini_notation: 'bd*4' }),
      baseEntry({ id: 'ccc', mini_notation: '[bd ~ ~ ~]*2' }),
    ];
    const r = diversityReport(corpus);
    expect(r.total_entries).toBe(3);
    expect(r.per_genre_role_counts).toContainEqual(expect.objectContaining({ genre: 'techno', role: 'kick', count: 3 }));
  });
});

describe('cookbook references (G9 §6)', () => {
  it('listReferenceDescriptors returns at least the core genres', async () => {
    const slugs = await listReferenceDescriptors();
    for (const required of ['techno', 'dub_techno', 'dnb', 'idm', 'ambient']) {
      expect(slugs).toContain(required);
    }
  });

  it('each core genre descriptor parses with required fields', async () => {
    for (const slug of ['techno', 'dub_techno', 'dnb', 'idm', 'ambient']) {
      const r = await loadReferenceDescriptor(slug);
      expect(r.slug).toBe(slug);
      expect(r.production_trait_clusters.length).toBeGreaterThan(2);
      expect(r.forbidden_copying_notes.length).toBeGreaterThan(0); // copyright guardrail must exist
    }
  });
});

describe('cookbook vocab → query bridge (G9 §4 + §5)', () => {
  it('builds a query that filters out forbidden tags from vocab', () => {
    const q = buildQueryFromVocab({
      genre: 'techno', role: 'kick',
      vocab: { prefer_tags: ['punchy', 'restrained'], forbid_tags: ['cinematic', 'pretty'] },
    });
    expect(q.prefer_tags).toContain('punchy');
    expect(q.prefer_tags).toContain('restrained');
    expect(q.forbid_tags).toContain('cinematic');
    expect(q.forbid_tags).toContain('pretty');
  });

  it('drops vocab tags that are not in the closed sound-palette enum', () => {
    const q = buildQueryFromVocab({
      genre: 'techno', role: 'kick',
      vocab: { prefer_tags: ['punchy', 'totallymadeuptag'], forbid_tags: [] },
    });
    expect(q.prefer_tags).toContain('punchy');
    expect(q.prefer_tags).not.toContain('totallymadeuptag');
  });
});

describe('cookbook end-to-end (G9 §11)', () => {
  it('every entry that loads from disk has well-formed v2 metadata', async () => {
    const r = await loadCookbookEntries();
    expect(r.entries.length).toBeGreaterThanOrEqual(40);
    for (const e of r.entries) {
      expect(e.schema_version).toBe(COOKBOOK_SCHEMA_VERSION);
      expect(e.bar_intent.length).toBeGreaterThan(8);
      expect(e.provenance_note.length).toBeGreaterThan(3);
    }
  });
});
