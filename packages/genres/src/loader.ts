import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { GenreSpecSchema, type GenreSpec } from './index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GENRES_DIR = path.resolve(HERE, '..', '..', '..', 'genres');
const COOKBOOK_DIR = path.resolve(HERE, '..', '..', '..', 'cookbook');

const cache = new Map<string, GenreSpec>();

export async function loadGenre(slug: string): Promise<GenreSpec> {
  if (cache.has(slug)) return cache.get(slug)!;
  const file = path.join(GENRES_DIR, `${slug}.yaml`);
  const raw = await fs.readFile(file, 'utf8');
  const obj = parseYaml(raw) as unknown;
  const spec = GenreSpecSchema.parse(obj);
  cache.set(slug, spec);
  return spec;
}

export async function listGenres(): Promise<string[]> {
  const entries = await fs.readdir(GENRES_DIR);
  return entries
    .filter((n) => n.endsWith('.yaml'))
    .map((n) => n.slice(0, -5))
    .sort();
}

export interface CookbookSnippet {
  id: string;
  genre: string;
  role: string;
  mini_notation?: string;
  raw?: string;
  tags: string[];
  bpm_range?: [number, number];
  notes?: string;
}

export async function loadCookbookSnippets(genre: string, role?: string): Promise<CookbookSnippet[]> {
  // G9 §8: when CACTUS_COOKBOOK_MODE=minimal, return an empty corpus so the
  // audit framework can measure the producer's behavior without cookbook
  // priors. Default ('enabled' / unset) uses the full cookbook.
  const mode = process.env.CACTUS_COOKBOOK_MODE;
  if (mode === 'minimal') return [];

  const dir = path.join(COOKBOOK_DIR, genre);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: CookbookSnippet[] = [];
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    if (role && name !== `${role}.jsonl`) continue;
    const text = await fs.readFile(path.join(dir, name), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        // The legacy CookbookSnippet shape is a strict subset of the v2
        // schema (id/genre/role/mini_notation are common). Down-cast: the
        // legacy shape only reads what it needs and ignores the rest.
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        const tags = Array.isArray(obj.tags)
          ? (obj.tags as string[])
          : Array.isArray(obj.free_tags) ? (obj.free_tags as string[])
          : Array.isArray(obj.sound_palette_tags) ? (obj.sound_palette_tags as string[])
          : [];
        out.push({
          id: obj.id as string,
          genre: obj.genre as string,
          role: obj.role as string,
          ...(typeof obj.mini_notation === 'string' ? { mini_notation: obj.mini_notation } : {}),
          ...(typeof obj.raw === 'string' ? { raw: obj.raw } : {}),
          tags,
          ...(Array.isArray(obj.bpm_range) ? { bpm_range: obj.bpm_range as [number, number] } : {}),
          ...(typeof obj.notes === 'string' ? { notes: obj.notes } : {}),
        });
      } catch (e) {
        throw new Error(`malformed JSONL in ${dir}/${name}: ${trimmed.slice(0, 60)}`);
      }
    }
  }
  return out;
}

export function pickSnippet(
  snippets: CookbookSnippet[],
  bpm: number,
  rng: () => number,
): CookbookSnippet | undefined {
  const inRange = snippets.filter((s) => {
    if (!s.bpm_range) return true;
    return bpm >= s.bpm_range[0] && bpm <= s.bpm_range[1];
  });
  const pool = inRange.length > 0 ? inRange : snippets;
  if (pool.length === 0) return undefined;
  return pool[Math.floor(rng() * pool.length)];
}
