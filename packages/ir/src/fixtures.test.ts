import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { FIXTURE_GENRES, fixturePath, loadFixture } from './fixtures.js';
import { SessionGraphSchema, SCHEMA_VERSION } from './schema.js';

describe('fixtures', () => {
  for (const slug of FIXTURE_GENRES) {
    it(`${slug} parses against SessionGraphSchema`, async () => {
      const g = await loadFixture(slug);
      expect(g.schema_version).toBe(SCHEMA_VERSION);
    });

    it(`${slug} round-trips parse → serialize → parse`, async () => {
      const raw = await fs.readFile(fixturePath(slug), 'utf8');
      const parsed = SessionGraphSchema.parse(JSON.parse(raw));
      const reSerialized = JSON.stringify(parsed);
      const reParsed = SessionGraphSchema.parse(JSON.parse(reSerialized));
      expect(reParsed).toEqual(parsed);
    });

    it(`${slug} energy_curve length matches total_bars`, async () => {
      const g = await loadFixture(slug);
      expect(g.song.energy_curve.length).toBe(g.song.total_bars);
    });

    it(`${slug} every layer has matching mix_graph orbit entry`, async () => {
      const g = await loadFixture(slug);
      for (const layer of g.layers) {
        expect(g.mix_graph.orbits[String(layer.orbit)]).toBeDefined();
      }
    });

    it(`${slug} sections are contiguous and cover total_bars`, async () => {
      const g = await loadFixture(slug);
      expect(g.song.sections[0]!.start_bar).toBe(0);
      expect(g.song.sections.at(-1)!.end_bar).toBe(g.song.total_bars);
      for (let i = 1; i < g.song.sections.length; i++) {
        expect(g.song.sections[i]!.start_bar).toBe(g.song.sections[i - 1]!.end_bar);
      }
    });
  }
});
