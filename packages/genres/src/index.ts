import { z } from 'zod';

export const GenreSpecSchema = z.object({
  slug: z.string(),
  display_name: z.string(),
  bpm_range: z.tuple([z.number().positive(), z.number().positive()])
    .refine(([lo, hi]) => lo <= hi, { message: 'bpm_range must be ascending' }),
  cps_range: z.tuple([z.number().positive(), z.number().positive()])
    .refine(([lo, hi]) => lo <= hi, { message: 'cps_range must be ascending' })
    .optional(),
  section_template: z.array(
    z.object({
      name: z.string(),
      function: z.string(),
      length_bars: z.number().positive(),
    }),
  ),
  drum_archetypes: z.array(z.string()),
  bass_archetypes: z.array(z.string()).default([]),
  harmonic_palette: z
    .object({
      modes: z.array(z.string()),
      typical_chord_progressions: z.array(z.array(z.string())).default([]),
    })
    .default({ modes: [], typical_chord_progressions: [] }),
  sound_palette: z.record(z.unknown()).default({}),
  mix_targets: z
    .object({
      lufs: z.number().min(-30).max(-3).default(-9),
      true_peak_max: z.number().min(-12).max(0).default(-1),
      kick_low_band_rms_target: z.number().positive().optional(),
      stereo_mono_low_compliance_min: z.number().min(0).max(1).optional(),
      reverb_send_chord_min: z.number().min(0).max(1).optional(),
    })
    .default({ lufs: -9, true_peak_max: -1 }),
  critic_rubric_hints: z.array(z.string()).default([]),
  modifiers: z.record(z.unknown()).default({}),
});
export type GenreSpec = z.infer<typeof GenreSpecSchema>;

export {
  loadGenre,
  listGenres,
  loadCookbookSnippets,
  pickSnippet,
  type CookbookSnippet,
} from './loader.js';
export { bridgeGenres } from './bridge.js';
export {
  GENRE_MATURITY, genreMaturity, productionGenres,
  isProductionGrade, maturityLabel,
  type GenreTier, type GenreMaturity,
} from './maturity.js';
export {
  getCoverageConstraints,
  type SectionCoverage,
  type GenreCoverageConstraints,
} from './coverage-constraints.js';
export {
  applyArrangementCoverage,
  type ArrangementCoverageReport,
} from './coverage-applier.js';
