// Deterministic genre → shared harmonic spine (schema 1.1.0).
//
// The corpus study found pitched layers picked pitches independently,
// so nothing was in the same key — the root of "5首都难听爆了". This
// derives ONE spine from the genre's OWN corpus-grounded
// harmonic_palette (genres/*.yaml) — we consume that SSOT, we do not
// invent a parallel chord table. Roman-numeral → absolute-chord is
// pure functional-harmony math (mechanism); the progression CHOICE is
// the genre's, and whether it sounds right is Bowei's ear verdict.
//
// Fully deterministic (no rng) — preserves the SessionGraph
// determinism rule.

import type { HarmonyGraph, HarmonicDerivation, Role } from '@cactus/ir';
import type { GenreSpec } from '@cactus/genres';

// Scale-degree semitone offsets from the tonic (degrees 1..7).
const MODE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
};

// Prefer flats — every name matches ChordSymbolSchema's [A-G][b#]?.
const PITCH_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const TONIC_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };

function modeIntervals(mode: string): number[] {
  return MODE_INTERVALS[mode] ?? MODE_INTERVALS.minor!;
}

// Major-family modes sit better in C; minor-family in A (the A-minor
// `<Am F C G>` register the corpus actually uses). Deterministic.
function tonicFor(mode: string): string {
  return ['major', 'lydian', 'mixolydian'].includes(mode) ? 'c' : 'a';
}

// One diatonic triad: root/third/fifth stacked within the mode, named
// by quality (third = 3|4 semis, fifth = 6|7|8). Pure + deterministic.
export function romanToChordSymbol(roman: string, tonic: string, mode: string): string | undefined {
  const deg = ROMAN[roman.toLowerCase().replace(/[^iv]/g, '')];
  if (!deg) return undefined;
  const iv = modeIntervals(mode);
  const tpc = TONIC_PC[tonic.toLowerCase()] ?? 9;
  const at = (d: number) => (tpc + iv[(d - 1) % 7]!) % 12;
  const root = at(deg);
  const thirdI = (at(deg + 2) - root + 12) % 12;
  const fifthI = (at(deg + 4) - root + 12) % 12;
  let suffix = '';
  if (thirdI === 3 && fifthI === 7) suffix = 'm';
  else if (thirdI === 3 && fifthI === 6) suffix = 'dim';
  else if (thirdI === 4 && fifthI === 8) suffix = 'aug';
  // major (4,7) and any unexpected stack → plain major triad (det. fallback)
  return PITCH_NAMES[root]! + suffix;
}

// Pick the genre's first corpus progression that is ≥2 parseable Roman
// numerals (movement); fall back to a single parseable chord, then to
// the bare tonic triad. `[free]` / unknown tokens are skipped — they
// are the genre saying "static", which we honor.
function pickProgression(genre: GenreSpec, tonic: string, mode: string): string[] {
  const lists = genre.harmonic_palette.typical_chord_progressions ?? [];
  const resolved = lists.map((p) =>
    p.map((r) => romanToChordSymbol(r, tonic, mode)).filter((c): c is string => !!c),
  );
  return (
    resolved.find((p) => p.length >= 2) ??
    resolved.find((p) => p.length >= 1) ??
    [romanToChordSymbol('i', tonic, mode)!]
  );
}

export function genreHarmony(genre: GenreSpec): HarmonyGraph {
  const rawMode = genre.harmonic_palette.modes[0] ?? 'minor';
  // Normalize to a key we have intervals for — every MODE_INTERVALS
  // key is also a valid ModeEnum member, so HarmonyGraph.key.mode is
  // guaranteed schema-valid (the graph is built as a typed literal,
  // not re-parsed downstream). hijaz/blues → minor (deterministic;
  // none of the 5 demo genres select them as first mode anyway).
  const mode = MODE_INTERVALS[rawMode] ? rawMode : 'minor';
  const tonic = tonicFor(mode);
  const progression = pickProgression(genre, tonic, mode);
  // index-space mini-notation: one chord per cycle so the spine MOVES
  // (a static <0>/1 is the drone we are trying to escape).
  const progression_rhythm = `<${progression.map((_, i) => i).join(' ')}>`;
  return {
    key: { tonic, mode: mode as HarmonyGraph['key']['mode'] },
    progression,
    progression_rhythm,
    modulation: [],
    anchors: { bass: `${tonic}1`, chord: `${tonic}3`, lead: `${tonic}4`, pad: `${tonic}3` },
  };
}

// Role → how that layer realizes the spine. Drums/noise/fx get none
// (undefined) and keep their literal patterns. degrees motifs are
// deterministic placeholders — chord-tone lines, guaranteed in-key via
// .chord(prog).voicing(); the ear verdict drives any refinement.
export function roleDerivation(role: Role): HarmonicDerivation | undefined {
  switch (role) {
    case 'bass':
    case 'sub':
      return { source: 'progression', role_derivation: 'root', octave_shift: 0 };
    case 'chord':
    case 'pad':
      return { source: 'progression', role_derivation: 'chord_voiced', octave_shift: 0 };
    case 'lead':
      return { source: 'progression', role_derivation: 'degree_line', degrees: '<0 2 4 2>', octave_shift: 0 };
    case 'arp':
    case 'pluck':
      return { source: 'progression', role_derivation: 'arp', degrees: '<0 2 4>', rhythm: 'x ~ x ~ x ~ x ~', octave_shift: 0 };
    default:
      return undefined;
  }
}
