import type { BriefGraph, Mode } from '@cactus/ir';

const GENRE_KEYWORDS: Array<[RegExp, string, string[]]> = [
  // [pattern, primary_genre, modifiers]
  [/\bdub[\s-]+techno\b/i, 'dub_techno', []],
  [/\bdeep[\s-]+house\b/i, 'house', ['deep']],
  [/\blo[\s-]?fi[\s-]+house\b/i, 'house', ['lo_fi']],
  [/\bacid[\s-]+house\b/i, 'house', ['acid']],
  [/\bmelodic[\s-]+techno\b/i, 'techno', ['melodic']],
  [/\bpeak[\s-]+time[\s-]+techno\b/i, 'techno', ['peak_time']],
  [/\bneurofunk\b/i, 'dnb', ['neurofunk']],
  [/\bliquid[\s-]+(?:dnb|funk)\b/i, 'dnb', ['liquid']],
  [/\bjungle\b/i, 'dnb', ['jungle']],
  [/\b(?:dnb|d&b|drum[\s-]+(?:and|n)[\s-]+bass)\b/i, 'dnb', []],
  // More specific (drone, jungle, neurofunk, etc.) match before their parent genre.
  [/\bdrone\b/i, 'ambient', ['drone']],
  [/\btechno\b/i, 'techno', []],
  [/\bhouse\b/i, 'house', []],
  [/\bidm\b/i, 'idm', []],
  [/\bambient\b/i, 'ambient', []],
];

const MOOD_KEYWORDS = new Set<string>([
  'dark', 'light', 'driving', 'hypnotic', 'haunted', 'spacious', 'rainy',
  'deep', 'club-functional', 'intricate', 'fractured', 'alien', 'meditative',
  'rolling', 'tight', 'weightless', 'evolving', 'aggressive', 'soft',
  'minimal', 'busy', 'bright', 'warm', 'cold', 'distant', 'intimate',
  'industrial', 'organic', 'glitchy', 'psychedelic', 'dreamy', 'tense',
  'relaxed', 'energetic', 'introspective', 'cinematic',
]);

const MODIFIER_KEYWORDS = new Set<string>([
  'evolving-chords', 'rain-texture', 'fm-textures', 'reece-bass',
  '909-core', 'polyrhythm', 'granular', 'breakbeat', 'shuffle',
]);

const KEY_RE = /\b(in|key\s+of)\s+([A-G](?:#|b)?)\s*(major|minor|dorian|phrygian|lydian|mixolydian|aeolian|locrian)?\b/i;

const VALID_MODES: Mode[] = [
  'major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian',
  'aeolian', 'locrian', 'harmonic_minor', 'melodic_minor', 'hijaz', 'blues',
];

export function parseBrief(text: string): BriefGraph {
  const t = text;

  // BPM
  let bpm: number | undefined;
  const bpmMatch = /(\d{2,3})\s*bpm/i.exec(t);
  if (bpmMatch) bpm = Number(bpmMatch[1]);

  // Genre + modifiers
  let primary_genre: string | undefined;
  const modifiers = new Set<string>();
  for (const [re, genre, mods] of GENRE_KEYWORDS) {
    if (re.test(t)) {
      primary_genre = genre;
      for (const m of mods) modifiers.add(m);
      break;
    }
  }

  // Mood
  const mood = new Set<string>();
  const lower = t.toLowerCase();
  for (const m of MOOD_KEYWORDS) {
    if (lower.includes(m)) mood.add(m);
  }
  for (const m of MODIFIER_KEYWORDS) {
    if (lower.includes(m)) modifiers.add(m);
  }

  // Energy
  let energy: BriefGraph['energy'];
  if (/\b(peak[-\s]?time|club|driving|aggressive|high\s+energy)\b/i.test(t)) energy = 'high';
  else if (/\b(meditative|ambient|drone|low\s+energy|calm|gentle)\b/i.test(t)) energy = 'low';
  else energy = 'mid';

  // Duration target — phrases like "5 minutes", "3 min", "180 sec"
  let duration_target_sec: number | undefined;
  const dMin = /(\d+)\s*(?:min(?:ute)?s?)\b/i.exec(t);
  const dSec = /(\d+)\s*(?:sec(?:ond)?s?)\b/i.exec(t);
  if (dMin) duration_target_sec = Number(dMin[1]) * 60;
  else if (dSec) duration_target_sec = Number(dSec[1]);

  // Key
  let key: BriefGraph['key'];
  const km = KEY_RE.exec(t);
  if (km) {
    const tonic = km[2]!;
    const modeRaw = (km[3] ?? 'minor').toLowerCase();
    const mode: Mode = (VALID_MODES as string[]).includes(modeRaw) ? (modeRaw as Mode) : 'minor';
    key = { tonic, mode };
  }

  // References — naive: look for "like X" or "X-style" or "à la X"
  const refMatches: BriefGraph['references'] = [];
  const likeRe = /\blike\s+([A-Z][\w&\s]{1,30}?)(?=[,.;]|\sand\s|\swith\s|$)/g;
  let lm: RegExpExecArray | null;
  while ((lm = likeRe.exec(t)) !== null) {
    refMatches.push({ kind: 'artist', value: (lm[1] ?? '').trim() });
  }
  // capitalized single names treated as references when they precede "rain texture" or "core"
  const burialRe = /(burial|aphex\s+twin|autechre|pole|basic\s+channel|sandwell|villalobos|ricardo)/gi;
  let bm: RegExpExecArray | null;
  while ((bm = burialRe.exec(t)) !== null) {
    refMatches.push({ kind: 'artist', value: bm[1]!.replace(/\s+/g, ' ') });
  }

  return {
    text: t,
    bpm,
    key,
    duration_target_sec,
    energy,
    mood: Array.from(mood),
    references: dedupeRefs(refMatches),
    primary_genre,
    modifiers: Array.from(modifiers),
    constraints: {},
  };
}

function dedupeRefs(refs: NonNullable<BriefGraph['references']>): NonNullable<BriefGraph['references']> {
  const seen = new Set<string>();
  const out: NonNullable<BriefGraph['references']> = [];
  for (const r of refs) {
    const k = `${r.kind}:${r.value.toLowerCase()}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}
