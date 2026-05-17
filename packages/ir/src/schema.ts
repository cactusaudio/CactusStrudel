import { z } from 'zod';

// 1.1.0 adds the optional `harmony` block + PatternEntry.harmonic +
// SoundDecoration source.kind 'gm'. ALL additive/optional → a 1.0.0
// graph (no harmony) still validates and compiles via the legacy path.
// Per the approved docs/harmony-schema-design.md §6 this is an
// additive-minor bump with no destructive migration. New graphs are
// written at SCHEMA_VERSION; old persisted iter_*.json keep '1.0.0'
// and remain readable (schema_version accepts the supported range).
export const SCHEMA_VERSION = '1.1.0' as const;
export const SUPPORTED_SCHEMA_VERSIONS = ['1.0.0', '1.1.0'] as const;

export const RoleEnum = z.enum([
  'kick',
  'snare',
  'clap',
  'rim',
  'hat',
  'cymbal',
  'percussion',
  'bass',
  'sub',
  'chord',
  'pad',
  'lead',
  'arp',
  'pluck',
  'fx',
  'riser',
  'impact',
  'noise',
  'vocal',
  'foley',
]);
export type Role = z.infer<typeof RoleEnum>;

export const ModeEnum = z.enum([
  'major',
  'minor',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'aeolian',
  'locrian',
  'harmonic_minor',
  'melodic_minor',
  'hijaz',
  'blues',
]);
export type Mode = z.infer<typeof ModeEnum>;

export const EnergyEnum = z.enum(['low', 'mid', 'high', 'peak']);
export type Energy = z.infer<typeof EnergyEnum>;

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

const Iso = z.string().datetime({ offset: true });
const Uuid = z.string().uuid();

export const ReferenceItemSchema = z.object({
  kind: z.enum(['track', 'artist', 'album', 'genre_tag', 'attribute']),
  value: z.string(),
  note: z.string().optional(),
});
export type ReferenceItem = z.infer<typeof ReferenceItemSchema>;

export const BriefGraphSchema = z.object({
  text: z.string(),
  bpm: z.number().min(40).max(220).optional(),
  key: z
    .object({
      tonic: z.string().regex(/^[A-Ga-g][b#]?$/),
      mode: ModeEnum,
    })
    .optional(),
  duration_target_sec: z.number().min(8).max(900).optional(),
  energy: EnergyEnum.optional(),
  mood: z.array(z.string()).default([]),
  references: z.array(ReferenceItemSchema).default([]),
  primary_genre: z.string().optional(),
  modifiers: z.array(z.string()).default([]),
  constraints: z.record(z.unknown()).default({}),
});
export type BriefGraph = z.infer<typeof BriefGraphSchema>;

// ---- harmony (schema 1.1.0) ----
// The shared harmonic spine. Per docs/harmony-schema-design.md: one
// progression for the song; every pitched layer derives from it
// (the coherence the reference corpus has and our 1.0.0 output lacked).
// Owned by producer-arranger (/harmony/* write boundary).

// Plain chord symbols the corpus passes to chord("Dm A Bb Eb").
// Voicing is NOT in the symbol — derived per layer.
export const ChordSymbolSchema = z
  .string()
  .regex(/^[A-G][b#]?(m|maj7|m7|7|dim|aug|sus2|sus4|add9|6|9|11|13)?$/);
export type ChordSymbol = z.infer<typeof ChordSymbolSchema>;

export const HarmonyModulationSchema = z.object({
  at_bar: z.number().int().nonnegative(),
  key: z.object({
    tonic: z.string().regex(/^[A-Ga-g][b#]?$/),
    mode: ModeEnum,
  }),
});
export type HarmonyModulation = z.infer<typeof HarmonyModulationSchema>;

export const HarmonyGraphSchema = z
  .object({
    key: z.object({
      tonic: z.string().regex(/^[A-Ga-g][b#]?$/),
      mode: ModeEnum,
    }),
    progression: z.array(ChordSymbolSchema).min(1),
    // Mini-notation over the progression INDEX space, expanded against
    // progression[] by the compiler — not free-text. e.g. "<0 1 2 3>/4".
    progression_rhythm: z.string().min(1).default('<0>/1'),
    modulation: z.array(HarmonyModulationSchema).default([]),
    anchors: z
      .object({
        // Strudel note literals are LOWERCASE (`note("c2")`), so the
        // octave-bearing anchor regex must accept a-g — same casing
        // policy as the `tonic` regex above. Uppercase-only here would
        // reject the very defaults it ships with.
        bass: z.string().regex(/^[A-Ga-g][b#]?[0-9]$/).default('c2'),
        chord: z.string().regex(/^[A-Ga-g][b#]?[0-9]$/).default('c4'),
        lead: z.string().regex(/^[A-Ga-g][b#]?[0-9]$/).default('c5'),
        pad: z.string().regex(/^[A-Ga-g][b#]?[0-9]$/).default('c4'),
      })
      .default({}),
  })
  .strict();
export type HarmonyGraph = z.infer<typeof HarmonyGraphSchema>;

// PatternEntry.harmonic: a layer realizes the shared spine instead of
// carrying a literal pattern. The compiler maps role_derivation →
// chord()/voicing()/n().chord() per the design doc §4 mapping table.
export const HarmonicDerivationSchema = z.object({
  source: z.literal('progression'),
  role_derivation: z.enum([
    'chord_voiced', // chord(prog).voicing()              — pad/chord
    'root', // chord(prog).mode('root').anchor(oct)        — bass
    'arp', // n(arpPattern).chord(prog).voicing()          — arp/pluck
    'degree_line', // n(degrees).chord(prog).voicing()     — lead/melody
  ]),
  degrees: z.string().optional(),
  rhythm: z.string().optional(),
  octave_shift: z.number().int().min(-3).max(3).default(0),
});
export type HarmonicDerivation = z.infer<typeof HarmonicDerivationSchema>;

export const SectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  start_bar: z.number().int().nonnegative(),
  end_bar: z.number().int().positive(),
  energy: z.number().min(0).max(1),
  function: SectionFunctionEnum,
}).refine((s) => s.end_bar > s.start_bar, { message: 'end_bar must be > start_bar' });
export type Section = z.infer<typeof SectionSchema>;

export const ActivationMapSchema = z.object({
  sections: z.record(z.boolean()),
  per_bar: z.array(z.number().min(0).max(1)).optional(),
});
export type ActivationMap = z.infer<typeof ActivationMapSchema>;

export const SongGraphSchema = z.object({
  cycles_per_bar: z.number().positive().default(1),
  total_bars: z.number().int().positive(),
  sections: z.array(SectionSchema).min(1),
  energy_curve: z.array(z.number().min(0).max(1)),
  layer_activation: z.record(ActivationMapSchema),
});
export type SongGraph = z.infer<typeof SongGraphSchema>;

export const LayerGraphSchema = z.object({
  id: z.string(),
  role: RoleEnum,
  orbit: z.number().int().nonnegative(),
  description: z.string().optional(),
});
export type LayerGraph = z.infer<typeof LayerGraphSchema>;

// `harmonic` (1.1.0) is additive-optional alongside the existing
// literal forms. The design doc §2 floated a hard "exactly one of {...}"
// refinement; we deliberately do NOT add it — the 1.0.0 schema is
// all-optional and a hard refinement could reject already-valid
// persisted graphs, violating the approved "no destructive migration"
// constraint. Selection precedence (harmonic ▸ mini_notation ▸ raw ▸
// role-default) is enforced compiler-side, not by schema rejection.
export const PatternEntrySchema: z.ZodType<{
  mini_notation?: string;
  notes?: string;
  euclid?: [number, number];
  raw?: string;
  density?: number;
  syncopation?: number;
  // typed `unknown` in the annotation (zod .default() makes the inferred
  // output type diverge from the input type) — same precedent as
  // `variations` below. The real shape is HarmonicDerivationSchema.
  harmonic?: unknown;
  variations?: unknown;
}> = z.object({
  mini_notation: z.string().optional(),
  notes: z.string().optional(),
  euclid: z.tuple([z.number().int().nonnegative(), z.number().int().positive()]).optional(),
  raw: z.string().optional(),
  density: z.number().min(0).max(1).optional(),
  syncopation: z.number().min(0).max(1).optional(),
  harmonic: HarmonicDerivationSchema.optional(),
  variations: z.lazy(() => z.array(PatternEntrySchema).optional()),
});
export type PatternEntry = z.infer<typeof PatternEntrySchema>;

export const PatternBankSchema = z.object({
  patterns: z.record(z.record(PatternEntrySchema)),
});
export type PatternBank = z.infer<typeof PatternBankSchema>;

export const EffectSchema = z.object({
  type: z.string(),
  params: z.record(z.unknown()).default({}),
  automation: z.record(z.unknown()).optional(),
});
export type Effect = z.infer<typeof EffectSchema>;

export const SoundDecorationSchema = z.object({
  source: z.object({
    kind: z.enum(['sample', 'synth', 'soundfont', 'csound', 'gm']),
    name: z.string(),
    options: z.record(z.unknown()).default({}),
  }),
  effects: z.array(EffectSchema).default([]),
  envelope: z
    .object({
      a: z.number().nonnegative().default(0.001),
      d: z.number().nonnegative().default(0.1),
      s: z.number().min(0).max(1).default(0.7),
      r: z.number().nonnegative().default(0.2),
    })
    .partial()
    .optional(),
  macros: z.record(z.unknown()).optional(),
});
export type SoundDecoration = z.infer<typeof SoundDecorationSchema>;

export const SoundPaletteSchema = z.object({
  layers: z.record(SoundDecorationSchema),
});
export type SoundPalette = z.infer<typeof SoundPaletteSchema>;

export const SidechainEdgeSchema = z.object({
  layer: z.string(),
  source: z.string(),
  depth: z.number().min(0).max(1),
  attack_ms: z.number().nonnegative(),
  release_ms: z.number().nonnegative(),
});
export type SidechainEdge = z.infer<typeof SidechainEdgeSchema>;

export const OrbitMixSchema = z.object({
  gain: z.number().default(1),
  pan: z.number().min(-1).max(1).default(0),
  width: z.number().min(0).max(2).default(1),
  room_send: z.number().min(0).max(1).default(0),
  delay_send: z.number().min(0).max(1).default(0),
});
export type OrbitMix = z.infer<typeof OrbitMixSchema>;

export const MixGraphSchema = z.object({
  orbits: z.record(OrbitMixSchema),
  master: z.object({
    gain: z.number().default(1),
    lufs_target: z.number().default(-9),
    true_peak_max: z.number().default(-1),
  }),
  sidechain: z.array(SidechainEdgeSchema).default([]),
  bus_sends: z
    .array(
      z.object({
        from_orbit: z.string(),
        to_bus: z.enum(['reverb', 'delay', 'parallel_comp']),
        amount: z.number().min(0).max(1),
      }),
    )
    .default([]),
});
export type MixGraph = z.infer<typeof MixGraphSchema>;

export const AnalyzerFeaturesSchema = z.object({
  spectral: z
    .object({
      centroid: z.number(),
      rolloff: z.number(),
      flatness: z.number(),
      flux: z.number(),
      mfcc_mean: z.array(z.number()),
      mfcc_std: z.array(z.number()),
      band_rms: z.record(z.number()),
    })
    .partial()
    .optional(),
  rhythmic: z
    .object({
      bpm: z.number(),
      bpm_confidence: z.number(),
      onset_density: z.record(z.number()),
      grid_regularity: z.number(),
      syncopation_proxy: z.number(),
    })
    .partial()
    .optional(),
  loudness: z
    .object({
      lufs_integrated: z.number(),
      lufs_short_max: z.number(),
      true_peak_db: z.number(),
      plr: z.number().optional(),
      dr: z.number().optional(),
    })
    .partial()
    .optional(),
  stereo: z
    .object({
      width_low: z.number(),
      width_mid: z.number(),
      width_high: z.number(),
      mono_low_compliance: z.number(),
    })
    .partial()
    .optional(),
  embedding: z
    .object({
      vector: z.array(z.number()),
      model: z.string(),
    })
    .optional(),
});
export type AnalyzerFeatures = z.infer<typeof AnalyzerFeaturesSchema>;

export const RenderArtifactSchema = z.object({
  iteration: z.number().int().nonnegative(),
  artifacts: z.object({
    wav_path: z.string().optional(),
    stems_paths: z.record(z.string()).default({}),
    spectrogram_paths: z.array(z.string()).default([]),
    compiled_code_path: z.string().optional(),
    midi_path: z.string().optional(),
  }),
  metadata: z.object({
    sample_rate: z.number().int().positive(),
    duration_sec: z.number().nonnegative(),
    channels: z.number().int().positive(),
    cpm: z.number().optional(),
    cps: z.number().optional(),
    package_versions: z.record(z.string()).default({}),
    warnings: z.array(z.string()).default([]),
    rendered_at: Iso,
  }),
  features: AnalyzerFeaturesSchema.optional(),
});
export type RenderArtifact = z.infer<typeof RenderArtifactSchema>;

export const ScoreVectorSchema = z.object({
  genre_fit: z.number().min(0).max(1).default(0),
  groove: z.number().min(0).max(1).default(0),
  arrangement_arc: z.number().min(0).max(1).default(0),
  sound_design: z.number().min(0).max(1).default(0),
  mix_translation: z.number().min(0).max(1).default(0),
  memorability_hook: z.number().min(0).max(1).default(0),
  originality: z.number().min(0).max(1).default(0),
  user_taste_fit: z.number().min(0).max(1).default(0),
  technical_validity: z.number().min(0).max(1).default(0),
});
export type ScoreVector = z.infer<typeof ScoreVectorSchema>;

export const CritiqueTargetSchema = z.object({
  target_id: Uuid,
  severity: z.number().min(0).max(1),
  agent: z.string(),
  graph_paths: z.array(z.string()).min(1),
  problem: z.string(),
  evidence: z.record(z.unknown()),
  revision_instruction: z.string(),
});
export type CritiqueTarget = z.infer<typeof CritiqueTargetSchema>;

export const CritiqueEntrySchema = z.object({
  iteration: z.number().int().nonnegative(),
  scores: ScoreVectorSchema,
  targets: z.array(CritiqueTargetSchema),
  notes: z.string().optional(),
});
export type CritiqueEntry = z.infer<typeof CritiqueEntrySchema>;

export const PreferenceDecisionSchema = z.object({
  decision_id: Uuid,
  timestamp: Iso,
  kind: z.enum(['accept', 'reject', 'a_over_b', 'feedback']),
  iteration_a: z.number().int().nonnegative().optional(),
  iteration_b: z.number().int().nonnegative().optional(),
  feedback_text: z.string().optional(),
  inferred_attributes: z.record(z.unknown()).default({}),
});
export type PreferenceDecision = z.infer<typeof PreferenceDecisionSchema>;

export const PreferenceGraphSchema = z.object({
  decisions: z.array(PreferenceDecisionSchema).default([]),
  weights: ScoreVectorSchema.default({
    genre_fit: 0.18,
    groove: 0.16,
    arrangement_arc: 0.13,
    sound_design: 0.1,
    mix_translation: 0.12,
    memorability_hook: 0.08,
    originality: 0.06,
    user_taste_fit: 0.05,
    technical_validity: 0.12,
  }),
  motif_likes: z.array(z.record(z.unknown())).default([]),
  sound_likes: z.array(z.record(z.unknown())).default([]),
  arrangement_likes: z.array(z.record(z.unknown())).default([]),
});
export type PreferenceGraph = z.infer<typeof PreferenceGraphSchema>;

export const JsonPatchOpSchema = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
  path: z.string().startsWith('/'),
  value: z.unknown().optional(),
  from: z.string().startsWith('/').optional(),
});
export type JsonPatchOp = z.infer<typeof JsonPatchOpSchema>;

export const PatchSchema = z.object({
  patch_id: Uuid,
  iteration: z.number().int().nonnegative(),
  agent: z.string(),
  intent: z.string(),
  ops: z.array(JsonPatchOpSchema).min(1),
  expected_audio_effect: z
    .object({
      features: z.array(z.string()).default([]),
      sections: z.array(z.string()).default([]),
    })
    .optional(),
});
export type Patch = z.infer<typeof PatchSchema>;

export const IterationKindEnum = z.enum([
  'sketch',
  'expand',
  'revise',
  'master',
  'stems',
  'recover',
]);
export type IterationKind = z.infer<typeof IterationKindEnum>;

export const IterationSchema = z.object({
  iteration_n: z.number().int().nonnegative(),
  timestamp: Iso,
  kind: IterationKindEnum,
  agent: z.string(),
  parent_iteration: z.number().int().nonnegative().optional(),
  patches: z.array(PatchSchema).default([]),
  notes: z.string().optional(),
});
export type Iteration = z.infer<typeof IterationSchema>;

export const SessionGraphSchema = z.object({
  schema_version: z.enum(SUPPORTED_SCHEMA_VERSIONS),
  session_id: Uuid,
  created_at: Iso,
  brief: BriefGraphSchema,
  // 1.1.0 shared harmonic spine. Optional → 1.0.0 graphs validate +
  // compile via the legacy path. producer-arranger owns /harmony/*.
  harmony: HarmonyGraphSchema.optional(),
  song: SongGraphSchema,
  layers: z.array(LayerGraphSchema).default([]),
  pattern_bank: PatternBankSchema,
  sound_palette: SoundPaletteSchema,
  mix_graph: MixGraphSchema,
  render_graph: z.array(RenderArtifactSchema).default([]),
  critique_graph: z.array(CritiqueEntrySchema).default([]),
  preference_graph: PreferenceGraphSchema.default({
    decisions: [],
    weights: {
      genre_fit: 0.18,
      groove: 0.16,
      arrangement_arc: 0.13,
      sound_design: 0.1,
      mix_translation: 0.12,
      memorability_hook: 0.08,
      originality: 0.06,
      user_taste_fit: 0.05,
      technical_validity: 0.12,
    },
    motif_likes: [],
    sound_likes: [],
    arrangement_likes: [],
  }),
  iteration_log: z.array(IterationSchema).default([]),
});
export type SessionGraph = z.infer<typeof SessionGraphSchema>;
