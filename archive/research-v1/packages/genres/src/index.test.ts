import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { loadGenre, listGenres, loadCookbookSnippets, pickSnippet, bridgeGenres, GenreSpecSchema } from './index.js';
import { validateMiniNotation } from '@cactus/strudel-validator';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const REFERENCES_DIR = path.join(ROOT, 'references');

interface ReferenceDescriptor {
  slug: string;
  mix_descriptors?: {
    master_lufs?: [number, number];
    true_peak_max?: number;
  };
  allowed_influence_notes?: string[];
  production_trait_clusters?: string[];
}

async function loadReference(slug: string): Promise<ReferenceDescriptor> {
  const raw = await fs.readFile(path.join(REFERENCES_DIR, `${slug}.yaml`), 'utf8');
  return parseYaml(raw) as ReferenceDescriptor;
}

async function listReferenceSlugs(): Promise<string[]> {
  const files = await fs.readdir(REFERENCES_DIR);
  return files.filter((f) => f.endsWith('.yaml')).map((f) => f.slice(0, -5)).sort();
}

function referenceBpmRange(ref: ReferenceDescriptor): [number, number] | undefined {
  const text = [
    ...(ref.allowed_influence_notes ?? []),
    ...(ref.production_trait_clusters ?? []),
  ].join('\n');
  const m = /(\d{2,3})\s*[-–]\s*(\d{2,3})\s*BPM/i.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

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

  it('rejects invalid numeric target ranges', () => {
    const base = {
      slug: 'bad',
      display_name: 'Bad',
      bpm_range: [140, 100],
      section_template: [{ name: 'main', function: 'main', length_bars: 8 }],
      drum_archetypes: [],
      mix_targets: { lufs: 3, true_peak_max: 2, stereo_mono_low_compliance_min: 1.5 },
    };
    const r = GenreSpecSchema.safeParse(base);
    expect(r.success).toBe(false);
  });

  it('keeps production genre specs numerically aligned with reference descriptors', async () => {
    const productionSlugs = await listGenres();
    const referenceSlugs = await listReferenceSlugs();
    expect(productionSlugs).toEqual(referenceSlugs);

    for (const slug of productionSlugs) {
      const genre = await loadGenre(slug);
      const ref = await loadReference(slug);
      expect(ref.slug).toBe(slug);

      const lufsRange = ref.mix_descriptors?.master_lufs;
      expect(lufsRange, `${slug} missing reference master_lufs`).toBeDefined();
      expect(genre.mix_targets.lufs, `${slug} lufs below reference range`).toBeGreaterThanOrEqual(lufsRange![0]);
      expect(genre.mix_targets.lufs, `${slug} lufs above reference range`).toBeLessThanOrEqual(lufsRange![1]);

      const truePeakMax = ref.mix_descriptors?.true_peak_max;
      expect(truePeakMax, `${slug} missing reference true_peak_max`).toBeDefined();
      expect(genre.mix_targets.true_peak_max, `${slug} true_peak_max hotter than reference`).toBeLessThanOrEqual(truePeakMax!);

      const bpmRange = referenceBpmRange(ref);
      if (bpmRange && !/tempo-less/i.test((ref.allowed_influence_notes ?? []).join('\n'))) {
        expect(Math.abs(genre.bpm_range[0] - bpmRange[0]), `${slug} bpm low endpoint drift`).toBeLessThanOrEqual(5);
        expect(Math.abs(genre.bpm_range[1] - bpmRange[1]), `${slug} bpm high endpoint drift`).toBeLessThanOrEqual(5);
      }
    }
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
