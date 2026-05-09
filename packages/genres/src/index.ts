import { z } from 'zod';

export const GenreSpecSchema = z.object({
  slug: z.string(),
  display_name: z.string(),
  bpm_range: z.tuple([z.number(), z.number()]),
  cps_range: z.tuple([z.number(), z.number()]).optional(),
  section_template: z.array(
    z.object({
      name: z.string(),
      function: z.string(),
      length_bars: z.number(),
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
      lufs: z.number().default(-9),
      true_peak_max: z.number().default(-1),
      kick_low_band_rms_target: z.number().optional(),
      stereo_mono_low_compliance_min: z.number().optional(),
      reverb_send_chord_min: z.number().optional(),
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
