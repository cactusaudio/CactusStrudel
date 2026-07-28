#!/usr/bin/env node
// G9 §2: seed the cookbook with v2 schema entries. Migrates the pre-G9 thin
// entries and adds carefully-considered new ones. This is run ONCE and the
// result committed; the script is kept so the migration is auditable.
//
// Usage: node scripts/cookbook-seed.mjs
// Writes to cookbook/<genre>/<role>.jsonl.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const COOKBOOK_DIR = path.join(REPO_ROOT, 'cookbook');
const SCHEMA_VERSION = '2.0.0';
const PROVENANCE_DATE = '2026-05-10';

function entry(o) {
  // Apply defaults that match CookbookEntrySchema's .default()s. The schema
  // also accepts these inputs, but writing them explicitly makes the JSONL
  // self-describing.
  return JSON.stringify({
    schema_version: SCHEMA_VERSION,
    incompatible_sections: [],
    required_layers: [],
    forbidden_constraints: [],
    sound_palette_tags: [],
    free_tags: [],
    mix_implications: {},
    expected_movement: {},
    revision_affordances: [],
    validation_status: 'unvalidated',
    known_failure_modes: [],
    ...o,
  });
}

const TECHNO_KICKS = [
  entry({
    id: 'tk-kick-001', genre: 'techno', role: 'kick', subrole: 'minimal-4on4',
    mini_notation: 'bd ~ ~ ~ bd ~ ~ ~',
    energy_range: ['low', 'mid'], bpm_range: [125, 138],
    bar_intent: 'minimal half-time-feel four-on-floor: emphasize body, leave room for hat + clap',
    compatible_sections: ['intro', 'main', 'breakdown'],
    incompatible_sections: ['drop'],
    sound_palette_tags: ['punchy', 'tight', 'restrained'], free_tags: ['minimal', '4-on-floor'],
    mix_implications: { occupies_band: 'low', prefers_orbit_width: 0.5 },
    expected_movement: { onset_density_min: 1.5, onset_density_max: 3.5, band_dominance: 'kick' },
    revision_affordances: [
      { movement_key: 'kick_orbit_gain_db', safe_range: [-3, +3] },
    ],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}; intent: introduce / breakdown 4-on-4 kick that doesn't dominate`,
    known_failure_modes: ['too sparse for peak-time main section — pick tk-kick-002 there'],
  }),
  entry({
    id: 'tk-kick-002', genre: 'techno', role: 'kick', subrole: 'driving-4on4',
    mini_notation: 'bd*4',
    energy_range: ['mid', 'high', 'peak'], bpm_range: [128, 138],
    bar_intent: 'peak-time driving four-on-the-floor: full-bar repetition for hypnotic continuity',
    compatible_sections: ['main', 'drop'],
    incompatible_sections: ['intro', 'breakdown', 'outro'],
    sound_palette_tags: ['punchy', 'aggressive', 'mechanical'], free_tags: ['4-on-floor', 'driving'],
    mix_implications: { occupies_band: 'low', prefers_orbit_width: 0.4 },
    expected_movement: { onset_density_min: 4.0, onset_density_max: 6.0, band_dominance: 'kick' },
    revision_affordances: [
      { movement_key: 'kick_orbit_gain_db', safe_range: [-2, +3] },
    ],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}; intent: peak-time backbone`,
    known_failure_modes: ['sounds rigid in intros — use tk-kick-001 or tk-kick-003 there'],
  }),
  entry({
    id: 'tk-kick-003', genre: 'techno', role: 'kick', subrole: 'half-time-grouping',
    mini_notation: '[bd ~ ~ ~]*2',
    energy_range: ['low', 'mid'], bpm_range: [125, 132],
    bar_intent: 'half-time grouping: two distinct kick events per bar, leaves long tail air for dub-leaning techno',
    compatible_sections: ['intro', 'breakdown', 'main'],
    sound_palette_tags: ['restrained', 'tight'], free_tags: ['4-on-floor', 'half-time-feel'],
    mix_implications: { occupies_band: 'low' },
    expected_movement: { onset_density_min: 1.2, onset_density_max: 2.5 },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}; bridges minimal and dub_techno aesthetics`,
  }),
  entry({
    id: 'tk-kick-004', genre: 'techno', role: 'kick', subrole: 'broken-industrial',
    mini_notation: 'bd bd ~ ~ bd ~ bd ~',
    energy_range: ['high', 'peak'], bpm_range: [130, 138],
    bar_intent: 'broken / fractured kick pattern — used in industrial-leaning warehouse techno',
    compatible_sections: ['main', 'drop'],
    incompatible_sections: ['intro'],
    sound_palette_tags: ['aggressive', 'industrial', 'broken', 'mechanical'], free_tags: ['broken'],
    forbidden_constraints: ['user requested 4-on-floor'],
    mix_implications: { occupies_band: 'low' },
    expected_movement: { onset_density_min: 3.5, onset_density_max: 5.5, syncopation_min: 0.3 },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}; for industrial-leaning peak time`,
    known_failure_modes: ['breaks 4-on-4 expectation — incompatible with stable_kick brief constraint'],
  }),
  entry({
    id: 'tk-kick-005', genre: 'techno', role: 'kick', subrole: 'rolling-syncopated',
    mini_notation: 'bd ~ bd ~ ~ bd ~ ~',
    energy_range: ['mid', 'high'], bpm_range: [128, 134],
    bar_intent: 'rolling syncopated kick — three events with even spacing inside a 4/4 bar',
    compatible_sections: ['main', 'build'],
    sound_palette_tags: ['hypnotic', 'punchy'], free_tags: ['syncopated', 'rolling'],
    mix_implications: { occupies_band: 'low' },
    expected_movement: { onset_density_min: 2.5, onset_density_max: 3.8, syncopation_min: 0.2 },
    source_type: 'authored',
    provenance_note: `authored ${PROVENANCE_DATE}; gives rules backend a non-4-on-4 option that doesn't go full broken`,
  }),
  entry({
    id: 'tk-kick-006', genre: 'techno', role: 'kick', subrole: 'sparse-intro',
    mini_notation: 'bd ~ ~ ~ ~ ~ ~ ~',
    energy_range: ['low'], bpm_range: [125, 135],
    bar_intent: 'one-bar sparse kick for very long intros where the kick alone announces tempo',
    compatible_sections: ['intro'],
    incompatible_sections: ['main', 'drop', 'build'],
    sound_palette_tags: ['restrained', 'sparse'], free_tags: ['intro', 'sparse'],
    mix_implications: { occupies_band: 'low' },
    expected_movement: { onset_density_min: 0.4, onset_density_max: 1.2 },
    source_type: 'authored',
    provenance_note: `authored ${PROVENANCE_DATE}; for ≥16-bar intros where the producer wants the kick to enter alone`,
    known_failure_modes: ['too sparse for any non-intro section'],
  }),
];

const TECHNO_HATS = [
  entry({
    id: 'tk-hat-001', genre: 'techno', role: 'hat', subrole: 'offbeat',
    mini_notation: '[~ hh]*4',
    energy_range: ['low', 'mid'], bpm_range: [125, 138],
    bar_intent: 'classic four-to-the-floor offbeat hat — fills upbeats',
    compatible_sections: ['intro', 'main', 'breakdown'],
    sound_palette_tags: ['restrained', 'static'], free_tags: ['offbeat'],
    mix_implications: { occupies_band: 'high', prefers_orbit_width: 1.0 },
    expected_movement: { onset_density_min: 3.5, onset_density_max: 4.5 },
    revision_affordances: [{ movement_key: 'hat_orbit_gain_db', safe_range: [-3, +3] }],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}; default companion for tk-kick-002`,
  }),
  entry({
    id: 'tk-hat-002', genre: 'techno', role: 'hat', subrole: 'eighth-grid',
    mini_notation: '[hh hh]*4',
    energy_range: ['mid', 'high'], bpm_range: [128, 138],
    bar_intent: 'eighth-note hat grid — propulsive without going to sixteenths',
    compatible_sections: ['main', 'build'],
    sound_palette_tags: ['pulsing', 'mechanical'], free_tags: ['eighth'],
    mix_implications: { occupies_band: 'high' },
    expected_movement: { onset_density_min: 7.0, onset_density_max: 9.0 },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'tk-hat-003', genre: 'techno', role: 'hat', subrole: 'sixteenth-driving',
    mini_notation: 'hh*8',
    energy_range: ['high', 'peak'], bpm_range: [128, 138],
    bar_intent: 'sixteenth-note driving hat — peak-time energy without needing harmonic content',
    compatible_sections: ['main', 'drop'],
    sound_palette_tags: ['aggressive', 'pulsing', 'dense'], free_tags: ['sixteenth', 'driving'],
    mix_implications: { occupies_band: 'high' },
    expected_movement: { onset_density_min: 14, onset_density_max: 18 },
    revision_affordances: [{ movement_key: 'hat_hpf_hz', safe_range: [0, +400] }],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
    known_failure_modes: ['too dense for breakdowns — pick tk-hat-001 there'],
  }),
  entry({
    id: 'tk-hat-004', genre: 'techno', role: 'hat', subrole: 'syncopated-warehouse',
    mini_notation: '[~ hh ~ hh hh ~ hh hh]',
    energy_range: ['mid', 'high'], bpm_range: [125, 135],
    bar_intent: 'syncopated warehouse hat — irregular accents that break the eighth-note grid',
    compatible_sections: ['main', 'drop'],
    sound_palette_tags: ['warehouse', 'broken', 'gritty'], free_tags: ['syncopated'],
    mix_implications: { occupies_band: 'high' },
    expected_movement: { onset_density_min: 4.5, onset_density_max: 6.0, syncopation_min: 0.3 },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'tk-hat-005', genre: 'techno', role: 'hat', subrole: 'long-open',
    mini_notation: 'oh ~ ~ ~ oh ~ ~ ~',
    energy_range: ['mid'], bpm_range: [125, 134],
    bar_intent: 'open-hat tail at downbeats — adds shimmer / sustain without sixteenths',
    compatible_sections: ['main'],
    sound_palette_tags: ['airy', 'evolving'], free_tags: ['open-hat'],
    mix_implications: { occupies_band: 'air', prefers_room_send: 0.3 },
    expected_movement: { onset_density_min: 1.0, onset_density_max: 2.5 },
    source_type: 'authored',
    provenance_note: `authored ${PROVENANCE_DATE}; pairs with tk-hat-001 to give 4 closed + 4 open events per bar`,
  }),
];

const TECHNO_BASSES = [
  entry({
    id: 'tk-bass-001', genre: 'techno', role: 'bass', subrole: 'sub-pulse',
    mini_notation: 'a1 ~ a1 ~',
    energy_range: ['low', 'mid'], bpm_range: [125, 138],
    bar_intent: 'sub-bass pulse on beats 1 + 3, leaves space for kick body',
    compatible_sections: ['intro', 'main'],
    required_layers: ['kick'],
    sound_palette_tags: ['restrained', 'static'], free_tags: ['sub', 'minimal'],
    mix_implications: { occupies_band: 'sub', prefers_orbit_width: 0.3, needs_sidechain_from: 'kick' },
    expected_movement: { onset_density_min: 1.5, onset_density_max: 2.5 },
    revision_affordances: [{ movement_key: 'bass_orbit_width', safe_range: [-0.4, +0.0] }],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'tk-bass-002', genre: 'techno', role: 'bass', subrole: 'rolling',
    mini_notation: 'a1 a1 c2 a1',
    energy_range: ['mid', 'high'], bpm_range: [128, 138],
    bar_intent: 'rolling four-event bass with one passing tone — gives motion without melody',
    compatible_sections: ['main', 'drop'],
    required_layers: ['kick'],
    sound_palette_tags: ['hypnotic', 'mechanical'], free_tags: ['rolling'],
    mix_implications: { occupies_band: 'low', needs_sidechain_from: 'kick' },
    expected_movement: { onset_density_min: 3.5, onset_density_max: 4.5 },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'tk-bass-003', genre: 'techno', role: 'bass', subrole: 'syncopated',
    mini_notation: 'a1 ~ ~ a1 ~ ~ c2 ~',
    energy_range: ['mid'], bpm_range: [125, 135],
    bar_intent: 'syncopated 3+3+2 bass — adds groove without aggression',
    compatible_sections: ['main', 'breakdown'],
    sound_palette_tags: ['hypnotic', 'evolving'], free_tags: ['syncopated', '3+3+2'],
    mix_implications: { occupies_band: 'low' },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'tk-bass-004', genre: 'techno', role: 'bass', subrole: 'sequence',
    mini_notation: '<a1 c2 e2 g1>',
    energy_range: ['mid', 'high'], bpm_range: [128, 138],
    bar_intent: 'four-bar bassline sequence — walks through a minor pentatonic-ish set',
    compatible_sections: ['main', 'drop'],
    required_layers: ['kick'],
    sound_palette_tags: ['evolving', 'hypnotic'], free_tags: ['sequence', 'walking'],
    mix_implications: { occupies_band: 'low' },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
    known_failure_modes: ['locks key — incompatible if user wants atonal'],
  }),
];

// Mix-macro: not a per-section snippet but a config preset the producer
// applies to mix_graph. Encoded as `raw` (JSON-as-config) so the validator
// flags it differently from playable patterns.
const TECHNO_MIX_MACROS = [
  entry({
    id: 'tk-mix-001', genre: 'techno', role: 'mix_macro', subrole: 'peak-time',
    raw: '{"master_lufs": -8, "master_true_peak_max": -1, "kick_orbit_width": 0.4, "bass_orbit_width": 0.5, "hat_room_send": 0.15}',
    energy_range: ['high', 'peak'], bpm_range: [128, 138],
    bar_intent: 'peak-time mix preset: hot LUFS, narrow low-band, modest hat room',
    compatible_sections: ['main', 'drop'],
    sound_palette_tags: ['aggressive', 'punchy'], free_tags: ['peak-time'],
    mix_implications: {},
    source_type: 'authored',
    provenance_note: `authored ${PROVENANCE_DATE}; baseline peak-time mix that paired with tk-kick-002 + tk-hat-003`,
  }),
];

const DUB_TECHNO_KICKS = [
  entry({
    id: 'dt-kick-001', genre: 'dub_techno', role: 'kick', subrole: 'soft-4on4',
    mini_notation: 'bd ~ ~ ~ bd ~ ~ ~',
    energy_range: ['low', 'mid'], bpm_range: [120, 128],
    bar_intent: 'soft 4-on-4 kick, leaves long air around each event for chord stab decay',
    compatible_sections: ['intro', 'main'],
    sound_palette_tags: ['warm', 'restrained', 'dub'], free_tags: ['4-on-floor'],
    mix_implications: { occupies_band: 'low', prefers_orbit_width: 0.5, prefers_room_send: 0.05 },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'dt-kick-002', genre: 'dub_techno', role: 'kick', subrole: 'half-time-air',
    mini_notation: 'bd ~ ~ ~ ~ ~ ~ ~',
    energy_range: ['low'], bpm_range: [118, 126],
    bar_intent: 'one-event-per-bar kick — extreme breathing room for chord tail',
    compatible_sections: ['intro', 'breakdown'],
    sound_palette_tags: ['dub', 'restrained', 'sparse'], free_tags: ['half-time'],
    source_type: 'authored',
    provenance_note: `authored ${PROVENANCE_DATE}; for ambient-leaning dub_techno openings`,
  }),
];

const DUB_TECHNO_CHORDS = [
  entry({
    id: 'dt-chord-001', genre: 'dub_techno', role: 'chord_stab', subrole: 'short-decay',
    mini_notation: '<a3 c4 e4>(3,8)',
    energy_range: ['low', 'mid'], bpm_range: [118, 128],
    bar_intent: 'minor-triad chord stab on a euclidean (3,8) pattern, short envelope',
    compatible_sections: ['main', 'breakdown'],
    sound_palette_tags: ['dub', 'cold', 'restrained'], free_tags: ['stab', 'euclid'],
    mix_implications: { occupies_band: 'mid', prefers_room_send: 0.45, prefers_delay_send: 0.35 },
    expected_movement: { centroid_hz_min: 600, centroid_hz_max: 1800, syncopation_min: 0.2 },
    revision_affordances: [
      { movement_key: 'chord_orbit_gain_db', safe_range: [-4, +1] },
      { movement_key: 'chord_hpf_hz', safe_range: [0, +400] },
    ],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}; the canonical dub_techno chord stab`,
    known_failure_modes: ['without reverb send sounds dry / disco-y — always pair with room_send ≥ 0.3'],
  }),
  entry({
    id: 'dt-chord-002', genre: 'dub_techno', role: 'chord_stab', subrole: 'long-tail',
    mini_notation: '<a3 c4 e4 d4>',
    energy_range: ['mid'], bpm_range: [118, 126],
    bar_intent: 'four-bar progression chord stab with a passing 4th — slow harmonic motion',
    compatible_sections: ['main'],
    sound_palette_tags: ['dub', 'evolving', 'cold'], free_tags: ['progression'],
    mix_implications: { occupies_band: 'mid', prefers_room_send: 0.5, prefers_delay_send: 0.4 },
    source_type: 'authored',
    provenance_note: `authored ${PROVENANCE_DATE}; for longer-form dub_techno where one chord gets boring`,
  }),
  entry({
    id: 'dt-chord-003', genre: 'dub_techno', role: 'chord_stab', subrole: 'cold-detuned',
    mini_notation: '<a3 c4 e4>(2,8,1)',
    energy_range: ['low', 'mid'], bpm_range: [118, 126],
    bar_intent: 'sparse cold-character chord stab — euclidean (2,8) with rotation',
    compatible_sections: ['intro', 'main', 'breakdown'],
    sound_palette_tags: ['cold', 'dub', 'restrained'], free_tags: ['cold', 'stab', 'sparse'],
    mix_implications: { occupies_band: 'mid', prefers_room_send: 0.5 },
    source_type: 'authored',
    provenance_note: `authored ${PROVENANCE_DATE}; alternative for "和弦冷一点" / "chord less pretty" feedback`,
  }),
];

const DUB_TECHNO_BASSES = [
  entry({
    id: 'dt-bass-001', genre: 'dub_techno', role: 'bass', subrole: 'sub-static',
    mini_notation: 'a1 ~ a1 ~',
    energy_range: ['low', 'mid'], bpm_range: [118, 128],
    bar_intent: 'sub-bass pulse, no movement — the chord drives harmonic interest',
    compatible_sections: ['main'],
    required_layers: ['kick'],
    sound_palette_tags: ['dub', 'static', 'warm'], free_tags: ['sub'],
    mix_implications: { occupies_band: 'sub', prefers_orbit_width: 0.3, needs_sidechain_from: 'kick' },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'dt-bass-002', genre: 'dub_techno', role: 'bass', subrole: 'walking-mid',
    mini_notation: '<a1 e2 a1 c2>',
    energy_range: ['mid'], bpm_range: [118, 128],
    bar_intent: 'four-bar walking sub — adds slow harmonic motion under static chord',
    compatible_sections: ['main'],
    sound_palette_tags: ['dub', 'evolving'], free_tags: ['walking'],
    mix_implications: { occupies_band: 'sub' },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
];

const DUB_TECHNO_HATS = [
  entry({
    id: 'dt-hat-001', genre: 'dub_techno', role: 'hat', subrole: 'offbeat-airy',
    mini_notation: '[~ hh]*4',
    energy_range: ['low', 'mid'], bpm_range: [118, 128],
    bar_intent: 'offbeat hat with extra room — fills upbeats but stays airy',
    compatible_sections: ['main'],
    sound_palette_tags: ['airy', 'restrained', 'dub'], free_tags: ['offbeat'],
    mix_implications: { occupies_band: 'high', prefers_room_send: 0.25 },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'dt-hat-002', genre: 'dub_techno', role: 'hat', subrole: 'sparse-broken',
    mini_notation: '~ ~ hh ~ ~ hh ~ ~',
    energy_range: ['low'], bpm_range: [118, 126],
    bar_intent: 'two-event sparse hat — barely audible, just adds shimmer',
    compatible_sections: ['intro', 'main'],
    sound_palette_tags: ['sparse', 'dub'], free_tags: ['sparse'],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'dt-hat-003', genre: 'dub_techno', role: 'hat', subrole: 'closed-quarter',
    mini_notation: 'hh ~ hh ~ hh ~ hh ~',
    energy_range: ['mid'], bpm_range: [120, 128],
    bar_intent: 'quarter-note closed hat — steady but unaggressive',
    compatible_sections: ['main'],
    sound_palette_tags: ['restrained', 'pulsing'], free_tags: ['quarter'],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
];

const DNB_KICKS = [
  entry({
    id: 'dnb-kick-001', genre: 'dnb', role: 'kick', subrole: 'amen-style',
    mini_notation: 'bd ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~ bd ~ ~ ~',
    energy_range: ['mid', 'high'], bpm_range: [165, 178],
    bar_intent: 'three-event displaced kick — typical DnB downbeat pattern',
    compatible_sections: ['main', 'drop'],
    sound_palette_tags: ['punchy', 'tight', 'broken'], free_tags: ['amen'],
    mix_implications: { occupies_band: 'low' },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'dnb-kick-002', genre: 'dnb', role: 'kick', subrole: 'minimal',
    mini_notation: 'bd ~ ~ ~ bd ~ ~ ~',
    energy_range: ['low', 'mid'], bpm_range: [165, 178],
    bar_intent: 'half-time kick — used in rollers / liquid DnB',
    compatible_sections: ['intro', 'main', 'breakdown'],
    sound_palette_tags: ['restrained', 'tight'], free_tags: ['half-time', 'liquid'],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
];

const DNB_SNARES = [
  entry({
    id: 'dnb-snare-001', genre: 'dnb', role: 'clap_snare', subrole: 'backbeat',
    mini_notation: '~ ~ ~ ~ sd ~ ~ ~',
    energy_range: ['mid', 'high'], bpm_range: [165, 178],
    bar_intent: 'mid-bar snare — the backbeat of every DnB kit',
    compatible_sections: ['main', 'drop'],
    required_layers: ['kick'],
    sound_palette_tags: ['punchy', 'tight'], free_tags: ['backbeat'],
    mix_implications: { occupies_band: 'mid' },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'dnb-snare-002', genre: 'dnb', role: 'clap_snare', subrole: 'ghost',
    mini_notation: '~ ~ ~ sd ~ ~ ~ ~',
    energy_range: ['mid'], bpm_range: [165, 178],
    bar_intent: 'ghost-snare on the and-of-3 — adds groove subdivision',
    compatible_sections: ['main', 'drop'],
    sound_palette_tags: ['hypnotic', 'pulsing'], free_tags: ['ghost'],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
];

const DNB_BASSES = [
  entry({
    id: 'dnb-bass-001', genre: 'dnb', role: 'bass', subrole: 'reese-roller',
    mini_notation: 'a1 ~ a1 ~',
    energy_range: ['mid', 'high'], bpm_range: [165, 178],
    bar_intent: 'half-bar reese-style sub — the rolling DnB bassline foundation',
    compatible_sections: ['main', 'drop'],
    required_layers: ['kick'],
    sound_palette_tags: ['hypnotic', 'gritty'], free_tags: ['reese', 'rolling'],
    mix_implications: { occupies_band: 'sub', needs_sidechain_from: 'kick' },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'dnb-bass-002', genre: 'dnb', role: 'bass', subrole: 'sub-jump',
    mini_notation: '<a1 a1 c2 a1>',
    energy_range: ['mid', 'high'], bpm_range: [165, 178],
    bar_intent: 'four-bar sub-jump — passing tone gives motion without melody',
    compatible_sections: ['main'],
    sound_palette_tags: ['evolving', 'gritty'], free_tags: ['sub'],
    source_type: 'authored',
    provenance_note: `authored ${PROVENANCE_DATE}; alternative to dnb-bass-001 with subtle motion`,
  }),
];

const IDM_KICKS = [
  entry({
    id: 'idm-kick-001', genre: 'idm', role: 'kick', subrole: 'broken',
    mini_notation: 'bd ~ bd bd ~ bd ~ ~ bd ~ ~ bd ~ bd ~ ~',
    energy_range: ['mid', 'high'], bpm_range: [110, 145],
    bar_intent: 'asymmetric kick pattern — not 4-on-floor, intentionally irregular',
    compatible_sections: ['main', 'drop'],
    sound_palette_tags: ['broken', 'arrhythmic', 'gritty'], free_tags: ['broken', 'asymmetric'],
    forbidden_constraints: ['user requested 4-on-floor', 'user requested stable_kick'],
    expected_movement: { syncopation_min: 0.4 },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'idm-kick-002', genre: 'idm', role: 'kick', subrole: 'glitch-stutter',
    mini_notation: '[bd bd bd] [bd] [bd bd] [bd bd bd bd]',
    energy_range: ['high'], bpm_range: [110, 140],
    bar_intent: 'four-cell stutter where cell density varies (3, 1, 2, 4 events per cell)',
    compatible_sections: ['main', 'drop'],
    sound_palette_tags: ['arrhythmic', 'mechanical', 'broken'], free_tags: ['glitch', 'stutter'],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'idm-kick-003', genre: 'idm', role: 'kick', subrole: 'euclidean-mutation',
    mini_notation: 'bd(5,12)',
    energy_range: ['mid', 'high'], bpm_range: [110, 145],
    bar_intent: 'euclidean kick (5 in 12) — odd subdivision, never lines up cleanly',
    compatible_sections: ['main'],
    sound_palette_tags: ['arrhythmic', 'mechanical'], free_tags: ['euclidean'],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
];

const IDM_PERC = [
  entry({
    id: 'idm-perc-001', genre: 'idm', role: 'perc', subrole: 'asymmetric-fill',
    mini_notation: '[rim rim rim rim rim] [rim rim rim] [rim rim rim rim rim rim rim] [rim rim]',
    energy_range: ['mid', 'high'], bpm_range: [110, 145],
    bar_intent: 'four-cell asymmetric perc fill (5, 3, 7, 2 hits per cell) — odd-meter feel',
    compatible_sections: ['main', 'drop'],
    sound_palette_tags: ['arrhythmic', 'gritty'], free_tags: ['variation'],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'idm-perc-002', genre: 'idm', role: 'perc', subrole: 'glitch-fill',
    mini_notation: '[rim ~ rim rim ~ ~ rim ~]',
    energy_range: ['mid'], bpm_range: [110, 140],
    bar_intent: 'fixed asymmetric perc fill — used as motif',
    compatible_sections: ['main'],
    sound_palette_tags: ['arrhythmic', 'mechanical'], free_tags: ['fill'],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
];

const AMBIENT_PADS = [
  entry({
    id: 'amb-pad-001', genre: 'ambient', role: 'pad_atmo', subrole: 'sustained-fifth',
    raw: 'note("a3,e4").s("triangle").attack(2).decay(4).release(8).gain(0.3)',
    energy_range: ['low'], bpm_range: [60, 100],
    bar_intent: 'sustained fifth pad — slow envelope, low gain, the atmospheric foundation',
    compatible_sections: ['intro', 'main', 'outro'],
    sound_palette_tags: ['warm', 'static', 'sparse', 'cinematic'], free_tags: ['pad', 'sustained'],
    mix_implications: { occupies_band: 'mid', prefers_room_send: 0.6, prefers_delay_send: 0.2 },
    expected_movement: { rms_db_min: -28, rms_db_max: -18 },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'amb-pad-002', genre: 'ambient', role: 'pad_atmo', subrole: 'evolving-cluster',
    raw: 'note("<a3 c4 e4 g4>/4").s("sawtooth").lpf("<400 800 1200 800>/4").gain(0.25)',
    energy_range: ['low', 'mid'], bpm_range: [60, 110],
    bar_intent: 'note-cluster pad with filter sweep — gentle harmonic evolution',
    compatible_sections: ['main'],
    sound_palette_tags: ['evolving', 'warm', 'cinematic'], free_tags: ['cluster', 'sweep'],
    mix_implications: { occupies_band: 'mid', prefers_room_send: 0.7 },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'amb-pad-003', genre: 'ambient', role: 'pad_atmo', subrole: 'noise-bed',
    raw: 'note("a2").s("white").lpf(800).gain(0.15)',
    energy_range: ['low'], bpm_range: [60, 100],
    bar_intent: 'low-passed white noise — texture / ambience under any pad',
    compatible_sections: ['intro', 'main', 'outro'],
    sound_palette_tags: ['airy', 'static', 'lo_fi', 'cold'], free_tags: ['noise', 'texture'],
    mix_implications: { occupies_band: 'air' },
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
    known_failure_modes: ['can mask other low-mid material — keep gain low'],
  }),
];

const HOUSE_KICKS = [
  entry({
    id: 'hs-kick-001', genre: 'house', role: 'kick', subrole: 'classic-4on4',
    mini_notation: 'bd*4',
    energy_range: ['mid', 'high'], bpm_range: [120, 128],
    bar_intent: 'classic house 4-on-floor — backbone of every house track',
    compatible_sections: ['main', 'drop'],
    sound_palette_tags: ['punchy', 'warm'], free_tags: ['4-on-floor', 'classic'],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
  entry({
    id: 'hs-kick-002', genre: 'house', role: 'kick', subrole: 'shuffle',
    mini_notation: 'bd ~ bd ~ bd ~ bd ~',
    energy_range: ['mid'], bpm_range: [118, 124],
    bar_intent: 'eighth-note kick with rest — looser swing-friendly grid',
    compatible_sections: ['main'],
    sound_palette_tags: ['warm', 'restrained'], free_tags: ['shuffle'],
    source_type: 'authored',
    provenance_note: `migrated from pre-G9 thin entry on ${PROVENANCE_DATE}`,
  }),
];

const ALL = [
  { genre: 'techno', role: 'kick', entries: TECHNO_KICKS },
  { genre: 'techno', role: 'hat', entries: TECHNO_HATS },
  { genre: 'techno', role: 'bass', entries: TECHNO_BASSES },
  { genre: 'techno', role: 'mix_macro', entries: TECHNO_MIX_MACROS },
  { genre: 'dub_techno', role: 'kick', entries: DUB_TECHNO_KICKS },
  { genre: 'dub_techno', role: 'chord', entries: DUB_TECHNO_CHORDS },
  { genre: 'dub_techno', role: 'bass', entries: DUB_TECHNO_BASSES },
  { genre: 'dub_techno', role: 'hat', entries: DUB_TECHNO_HATS },
  { genre: 'dnb', role: 'kick', entries: DNB_KICKS },
  { genre: 'dnb', role: 'snare', entries: DNB_SNARES },
  { genre: 'dnb', role: 'bass', entries: DNB_BASSES },
  { genre: 'idm', role: 'kick', entries: IDM_KICKS },
  { genre: 'idm', role: 'perc', entries: IDM_PERC },
  { genre: 'ambient', role: 'pad', entries: AMBIENT_PADS },
  { genre: 'house', role: 'kick', entries: HOUSE_KICKS },
];

async function main() {
  let total = 0;
  for (const { genre, role, entries } of ALL) {
    const dir = path.join(COOKBOOK_DIR, genre);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${role}.jsonl`);
    await fs.writeFile(file, entries.join('\n') + '\n');
    total += entries.length;
    console.log(`wrote ${entries.length.toString().padStart(2, ' ')} → ${path.relative(REPO_ROOT, file)}`);
  }
  console.log(`\ntotal: ${total} entries (cookbook v${SCHEMA_VERSION})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
