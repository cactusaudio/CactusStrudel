import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const RangeSchema = z.tuple([z.number(), z.number()]).refine(([lo, hi]) => lo < hi, {
  message: 'range must be ascending',
});

export const HoldoutGenreProfileSchema = z.object({
  bpm_range: RangeSchema,
  lufs_range: RangeSchema,
  onset_density_range: RangeSchema,
  centroid_range_hz: RangeSchema,
}).strict();
export type HoldoutGenreProfile = z.infer<typeof HoldoutGenreProfileSchema>;

const HoldoutProfileFileSchema = z.object({
  schema_version: z.literal(1),
  source: z.literal('holdout_evaluator_not_producer_runtime'),
  notes: z.array(z.string()).min(1),
  profiles: z.record(HoldoutGenreProfileSchema),
}).strict();

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HOLDOUT_GENRE_PROFILES_PATH = path.resolve(HERE, '..', 'genre-holdout-profiles.yaml');

let cached: Record<string, HoldoutGenreProfile> | null = null;

export async function loadHoldoutGenreProfiles(): Promise<Record<string, HoldoutGenreProfile>> {
  if (cached) return cached;
  const raw = parseYaml(await readFile(HOLDOUT_GENRE_PROFILES_PATH, 'utf8')) as unknown;
  const parsed = HoldoutProfileFileSchema.parse(raw);
  cached = parsed.profiles;
  return cached;
}
