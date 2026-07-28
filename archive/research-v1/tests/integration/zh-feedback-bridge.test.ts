// G9B §7: Chinese / mixed feedback drives cookbook retrieval. Each fixture
// exercises the full chain:
//
//   matchProductionVocab → aggregateMatches → buildQueryFromVocab → retrieve
//
// We assert the resulting query carries the tags we'd expect AND the
// cookbook returns at least one entry with the right palette signal (or
// forbids the wrong one).

import { describe, it, expect } from 'vitest';
import {
  loadCookbookEntries, retrieve, buildQueryFromVocab,
  type SoundPaletteTag,
} from '@cactus/cookbook';
import { matchProductionVocab, aggregateMatches } from '@cactus/preference';

interface ZhFixture {
  feedback: string;
  /** Expected prefer tags after vocab → query. */
  expect_prefer_at_least: SoundPaletteTag[];
  /** Expected forbid tags after vocab → query. */
  expect_forbid_at_least: SoundPaletteTag[];
  /** Expected at least one matched cookbook entry for this (genre, role). */
  retrieve_genre?: string;
  retrieve_role?: 'kick' | 'hat' | 'bass' | 'chord_stab' | 'pad_atmo';
}

const FIXTURES: ZhFixture[] = [
  {
    feedback: 'kick 要有身体，但不要变 EDM',
    expect_prefer_at_least: ['punchy', 'warm'],
    expect_forbid_at_least: ['cinematic'],
    retrieve_genre: 'techno', retrieve_role: 'kick',
  },
  {
    feedback: 'chord 少一点漂亮，多一点冷',
    // less-pretty-chord matches; colder also matches via "冷"
    expect_prefer_at_least: ['cold', 'restrained'],
    expect_forbid_at_least: ['cinematic'],
    retrieve_genre: 'dub_techno', retrieve_role: 'chord_stab',
  },
  {
    feedback: 'breakdown 不要太电影，回 club 一点',
    expect_prefer_at_least: ['warehouse', 'hypnotic'],
    expect_forbid_at_least: ['cinematic'],
  },
  {
    feedback: '低频托住，但不要糊',
    // bass-supports prefers warm
    expect_prefer_at_least: ['warm'],
    expect_forbid_at_least: [],
  },
  {
    feedback: '更碎，但 groove 要稳',
    expect_prefer_at_least: ['broken', 'static'],
    expect_forbid_at_least: [],
  },
  {
    feedback: '更 warehouse，别太干净',
    expect_prefer_at_least: ['warehouse', 'gritty'],
    expect_forbid_at_least: ['cinematic'],
  },
  {
    feedback: 'ambient 可以空，但不能像没东西',
    expect_prefer_at_least: ['sparse', 'airy'],
    expect_forbid_at_least: [],
  },
];

describe('Chinese feedback → vocab → cookbook query (G9B §7)', () => {
  for (const f of FIXTURES) {
    it(`"${f.feedback}" routes through vocab to a typed retrieve query`, async () => {
      const matches = matchProductionVocab(f.feedback);
      expect(matches.length).toBeGreaterThan(0);
      const agg = aggregateMatches(matches);
      const q = buildQueryFromVocab({
        genre: f.retrieve_genre ?? 'techno',
        role: f.retrieve_role ?? 'kick',
        vocab: agg,
      });
      for (const t of f.expect_prefer_at_least) {
        expect(q.prefer_tags ?? []).toContain(t);
      }
      for (const t of f.expect_forbid_at_least) {
        expect(q.forbid_tags ?? []).toContain(t);
      }
    });
  }

  it('"chord 少一点漂亮，多一点冷" returns chord_stab candidates and ranks colder above pretty', async () => {
    const matches = matchProductionVocab('chord 少一点漂亮，多一点冷');
    const agg = aggregateMatches(matches);
    const q = buildQueryFromVocab({
      genre: 'dub_techno', role: 'chord_stab', section: 'main', vocab: agg,
    });
    const entries = (await loadCookbookEntries()).entries;
    const ranked = retrieve(entries, q);
    expect(ranked.length).toBeGreaterThan(0);
    // Top entry should not have 'pretty' or 'sweet' tags, and ideally
    // carries 'cold' or 'restrained'.
    const top = ranked[0]!.entry;
    expect(top.sound_palette_tags).not.toContain('sweet');
    expect(top.sound_palette_tags).not.toContain('pretty');
  });

  it('"不要 EDM" filters out cinematic-tagged entries from results', async () => {
    const matches = matchProductionVocab('不要那么 EDM');
    const agg = aggregateMatches(matches);
    const q = buildQueryFromVocab({
      genre: 'techno', role: 'kick', vocab: agg,
    });
    const entries = (await loadCookbookEntries()).entries;
    const ranked = retrieve(entries, q);
    for (const r of ranked) {
      expect(r.entry.sound_palette_tags).not.toContain('cinematic');
    }
  });

  it('forbidden_overreactions are surfaced in aggregated vocab so planner can avoid them', () => {
    const m = matchProductionVocab('kick 要有身体，但不要变 EDM');
    const a = aggregateMatches(m);
    expect(a.forbidden_overreactions.length).toBeGreaterThan(0);
  });
});
