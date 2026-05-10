// G9: hardened cookbook schema. A cookbook entry is typed production
// knowledge, not an anonymous mini-notation string. The schema is the
// contract between hand-authored / generated priors and the producer's
// retrieval / mutation logic.

import { z } from 'zod';

export const COOKBOOK_SCHEMA_VERSION = '2.0.0' as const;

/** Top-level role taxonomy. Matches G9 dispatch §1. */
export const RoleEnum = z.enum([
  'kick',
  'hat',
  'clap_snare',
  'perc',
  'bass',
  'chord_stab',
  'pad_atmo',
  'fx',
  'break',
  'lead_hook',
  'transition',
  'arrangement_macro',
  'mix_macro',
]);
export type Role = z.infer<typeof RoleEnum>;

/** Section function names a snippet can declare itself compatible with. */
export const SectionFunctionEnum = z.enum([
  'intro',
  'main',
  'verse',
  'chorus',
  'breakdown',
  'build',
  'drop',
  'bridge',
  'outro',
  'transition',
]);
export type SectionFunction = z.infer<typeof SectionFunctionEnum>;

/** Provenance — where the entry came from. */
export const SourceTypeEnum = z.enum([
  'authored',                 // hand-written by a human
  'generated',                // produced by a generator script
  'transformed',              // mutated from another entry
  'imported_public_domain',   // imported from public-domain corpus
]);
export type SourceType = z.infer<typeof SourceTypeEnum>;

/**
 * Validation status — lifecycle state of an entry.
 *
 * Default retrieval (G9C: `enabled` mode) excludes:
 *   experimental, diagnostic, quarantined, rejected
 *
 * `accepted_with_warning` is excluded from `enabled_mutating` unless
 * `allow_warnings: true` is passed to retrieve(). `promoted` requires a
 * matching ledger entry under `learning_ledger/cookbook/promoted_priors/`.
 */
export const ValidationStatusEnum = z.enum([
  'unvalidated',              // schema-checked only
  'candidate',                // proposed; not yet retrieved by default
  'validator_passed',         // strudel-validator clean
  'render_smoke_passed',      // also rendered without crashing
  'accepted',                 // render-audit accepted, no warning
  'accepted_with_warning',    // render-audit produced a warning we tolerate
  'feature_match',            // also matches expected feature movement
  'diagnostic',               // intentionally rough — never auto-pick
  'experimental',             // gated — only used with explicit opt-in
  'quarantined',              // suspected of regressing real renders; excluded
  'rejected',                 // proven harmful or never-render; excluded
  'promoted',                 // promoted with ledger evidence
]);
export type ValidationStatus = z.infer<typeof ValidationStatusEnum>;

/** Coarse energy band — multiple values OK (a snippet can suit mid+high). */
export const EnergyBandEnum = z.enum(['low', 'mid', 'high', 'peak']);
export type EnergyBand = z.infer<typeof EnergyBandEnum>;

/**
 * Expected feature movement — the analyzer-side change a snippet should
 * produce when used in the predicted context. Not enforced — used by the
 * evaluation harness (G9 §3) to flag entries that don't deliver.
 */
export const ExpectedMovementSchema = z.object({
  rms_db_min: z.number().optional(),
  rms_db_max: z.number().optional(),
  onset_density_min: z.number().optional(),     // per second, mono mix
  onset_density_max: z.number().optional(),
  centroid_hz_min: z.number().optional(),
  centroid_hz_max: z.number().optional(),
  band_dominance: RoleEnum.optional(),          // which role's band should lead
  syncopation_min: z.number().min(0).max(1).optional(),
  syncopation_max: z.number().min(0).max(1).optional(),
}).strict();
export type ExpectedMovement = z.infer<typeof ExpectedMovementSchema>;

/**
 * Mix implication — what the snippet expects from the mix graph. The producer
 * uses this to set sensible orbit defaults when this entry is selected.
 */
export const MixImplicationSchema = z.object({
  prefers_orbit_width: z.number().min(0).max(2).optional(),
  prefers_orbit_gain_db: z.number().optional(),
  prefers_room_send: z.number().min(0).max(1).optional(),
  prefers_delay_send: z.number().min(0).max(1).optional(),
  needs_sidechain_from: RoleEnum.optional(),
  /** "low" | "mid" | "high" — band the snippet should occupy. */
  occupies_band: z.enum(['sub', 'low', 'low_mid', 'mid', 'high_mid', 'high', 'air']).optional(),
}).strict();
export type MixImplication = z.infer<typeof MixImplicationSchema>;

/**
 * Revision affordance — how this entry can be tweaked by the planner.
 * Each row names a movement key (one of the *_orbit_gain_db / *_hpf_hz
 * keys the planner knows) and the safe range.
 */
export const RevisionAffordanceSchema = z.object({
  movement_key: z.string(),
  /** Inclusive [min, max] in the units the planner uses (dB, Hz, etc.). */
  safe_range: z.tuple([z.number(), z.number()]),
  notes: z.string().optional(),
}).strict();
export type RevisionAffordance = z.infer<typeof RevisionAffordanceSchema>;

/**
 * Sound-palette tag — short tokens describing tonal/textural character. Used
 * by retrieval to match feedback like "更冷" → tags including "cold".
 */
export const SoundPaletteTagEnum = z.enum([
  // brightness / warmth
  'bright', 'dark', 'warm', 'cold',
  // density / space
  'sparse', 'dense', 'airy', 'crowded',
  // movement
  'static', 'evolving', 'pulsing', 'arrhythmic',
  // body
  'punchy', 'soft', 'tight', 'loose',
  // character
  'gritty', 'clean', 'distorted', 'lo_fi', 'hi_fi',
  // genre vocabulary
  'hypnotic', 'warehouse', 'dub', 'broken', 'cinematic',
  'industrial', 'organic', 'mechanical', 'restrained', 'aggressive',
  // mood
  'sweet', 'sour', 'cold_pretty', 'pretty',
]);
export type SoundPaletteTag = z.infer<typeof SoundPaletteTagEnum>;

/**
 * The entry itself. Every cookbook line in JSONL must validate against this.
 */
export const CookbookEntrySchema = z.object({
  schema_version: z.literal(COOKBOOK_SCHEMA_VERSION),
  id: z.string().min(3),
  genre: z.string().min(2),
  role: RoleEnum,
  subrole: z.string().optional(),

  /** Strudel mini-notation OR raw JS expression. Exactly one required. */
  mini_notation: z.string().optional(),
  raw: z.string().optional(),

  /** Coarse energy bands the snippet suits. */
  energy_range: z.array(EnergyBandEnum).min(1),

  /** BPM range the snippet is calibrated for. */
  bpm_range: z.tuple([z.number().min(40), z.number().max(220)]),

  /** What the snippet tries to do — one short sentence. */
  bar_intent: z.string().min(8).max(200),

  /** Section functions the snippet is suited for. */
  compatible_sections: z.array(SectionFunctionEnum).min(1),
  /** Section functions the snippet must NOT be used in. */
  incompatible_sections: z.array(SectionFunctionEnum).default([]),

  /** Other roles that must be present in the same arrangement. */
  required_layers: z.array(RoleEnum).default([]),
  /** Constraints that disqualify this snippet (free-text). */
  forbidden_constraints: z.array(z.string()).default([]),

  /** Sound-palette tags from the closed enum + free text auxiliaries. */
  sound_palette_tags: z.array(SoundPaletteTagEnum).default([]),
  free_tags: z.array(z.string()).default([]),

  mix_implications: MixImplicationSchema.default({}),
  expected_movement: ExpectedMovementSchema.default({}),
  revision_affordances: z.array(RevisionAffordanceSchema).default([]),

  validation_status: ValidationStatusEnum.default('unvalidated'),
  source_type: SourceTypeEnum,
  provenance_note: z.string().min(3),
  tested_at: z.string().datetime({ offset: true }).optional(),
  validator_version: z.string().optional(),

  /** Known modes that produce regressions if this entry is used wrong. */
  known_failure_modes: z.array(z.string()).default([]),
})
.strict()
.refine((e: { mini_notation?: string; raw?: string }) => Boolean(e.mini_notation) !== Boolean(e.raw), {
  message: 'cookbook entry must have exactly one of mini_notation or raw',
});
export type CookbookEntry = z.infer<typeof CookbookEntrySchema>;

/** Bag of entries for retrieval / similarity work. */
export interface CookbookCorpus {
  entries: CookbookEntry[];
}

export function getEntryCode(e: CookbookEntry): string {
  return e.mini_notation ?? e.raw ?? '';
}
