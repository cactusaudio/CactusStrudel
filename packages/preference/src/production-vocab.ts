// G9 §5: production-vocabulary map. Real user talk (English / Chinese / mixed)
// resolves to BriefGraph deltas, candidate cookbook tags, mix/arrangement
// implications, forbidden over-reactions, and example mistakes.
//
// This is the "semantic grounding" layer above the parseFeedback regex map
// (G3): when "更冷" fires, parseFeedback knows ONE rule; this layer also
// knows what cookbook entries ought to be retrieved AND what wrong
// interpretations to avoid.

export type LanguageTag = 'en' | 'zh' | 'mixed';

export interface ProductionVocabEntry {
  /** Canonical id — stable across translations. */
  id: string;
  /** All surface forms that map to this entry, en + zh + mixed. */
  surface_forms: string[];
  /** Language detected from surface forms (informational). */
  primary_language: LanguageTag;
  /** Brief-graph deltas to apply when this entry fires. */
  brief_deltas?: {
    /** Tags appended to brief.modifiers. */
    modifiers?: string[];
    /** Numeric overrides. */
    bpm_max?: number;
    bpm_min?: number;
  };
  /** Cookbook sound-palette tags to PREFER in retrieval. */
  prefer_tags: string[];
  /** Cookbook sound-palette tags to FORBID. */
  forbid_tags: string[];
  /** What this typically wants from the mix. */
  mix_implications?: {
    band_emphasis?: 'sub' | 'low' | 'low_mid' | 'mid' | 'high_mid' | 'high' | 'air';
    band_attenuation?: 'sub' | 'low' | 'low_mid' | 'mid' | 'high_mid' | 'high' | 'air';
    spatial?: 'tighter' | 'wider' | 'drier' | 'wetter';
  };
  /** Arrangement-level implications (sections). */
  arrangement_implications?: {
    breakdown_max_bars?: number;
    drop_energy_floor?: number;
    forbid_section_function?: ('breakdown' | 'build' | 'drop' | 'bridge' | 'transition')[];
  };
  /** Reactions that would over-correct the request — planner must avoid. */
  forbidden_overreactions: string[];
  /** Examples of how this gets misread, and the right reading. */
  wrong_interpretations: Array<{ wrong: string; correct: string }>;
}

export const PRODUCTION_VOCAB: ProductionVocabEntry[] = [
  {
    id: 'colder',
    surface_forms: ['冷', '更冷', 'colder', 'cold'],
    primary_language: 'zh',
    prefer_tags: ['cold', 'restrained', 'static'],
    forbid_tags: ['warm', 'sweet', 'pretty'],
    mix_implications: { band_emphasis: 'high_mid', band_attenuation: 'low_mid' },
    forbidden_overreactions: [
      'turning all reverb to 0',
      'replacing pad with white noise',
      'removing chord layer entirely',
    ],
    wrong_interpretations: [
      { wrong: 'cold = no reverb', correct: 'cold can use long reverb but with darker palette + less harmonic warmth' },
      { wrong: 'cold = remove chord', correct: 'cold = darker chord voicings + HPF on chord; keep the harmonic role' },
    ],
  },
  {
    id: 'dirtier',
    surface_forms: ['脏', '更脏', 'dirty', 'dirtier', 'gritty'],
    primary_language: 'zh',
    prefer_tags: ['gritty', 'lo_fi', 'distorted', 'industrial'],
    forbid_tags: ['clean', 'hi_fi'],
    mix_implications: { spatial: 'tighter' },
    forbidden_overreactions: [
      'distorting until peaks clip',
      'lo-fi-ing the kick body to mush',
    ],
    wrong_interpretations: [
      { wrong: 'dirtier = louder distortion on master', correct: 'dirtier = saturate per-orbit (drum bus, bass), keep master clean' },
    ],
  },
  {
    id: 'harder',
    surface_forms: ['硬', '更硬', 'harder'],
    primary_language: 'zh',
    prefer_tags: ['punchy', 'tight', 'aggressive'],
    forbid_tags: ['soft', 'loose', 'restrained'],
    mix_implications: { band_emphasis: 'low' },
    forbidden_overreactions: [
      'pushing kick gain into clipping',
      'making the kick longer (harder is shorter, not longer)',
    ],
    wrong_interpretations: [
      { wrong: 'harder = more low end', correct: 'harder = tighter transient + faster envelope; might also need more lower-mid presence' },
    ],
  },
  {
    id: 'more-space',
    surface_forms: ['空', '更空', 'more space', 'spacious'],
    primary_language: 'zh',
    prefer_tags: ['sparse', 'airy', 'restrained'],
    forbid_tags: ['dense', 'crowded'],
    mix_implications: { spatial: 'wetter' },
    arrangement_implications: { drop_energy_floor: 0.55 },
    forbidden_overreactions: [
      'removing layers entirely',
      'cutting drop energy below 0.5 — that becomes "empty" not "spacious"',
    ],
    wrong_interpretations: [
      { wrong: 'more space = remove instruments', correct: 'more space = keep instruments, increase room/delay sends + lower density' },
      { wrong: 'space = empty', correct: 'space ≠ empty — sparse arrangement with depth, not dropouts' },
    ],
  },
  {
    id: 'less-pretty-chord',
    surface_forms: ['别太甜', '和弦冷一点', '别这么甜', 'chord less pretty', 'colder chord', '少一点漂亮', '少点漂亮', 'chord 少'],
    primary_language: 'zh',
    prefer_tags: ['cold', 'restrained', 'dub'],
    forbid_tags: ['sweet', 'pretty', 'cinematic'],
    mix_implications: { spatial: 'drier', band_emphasis: 'high_mid' },
    forbidden_overreactions: [
      'replacing chord with pure noise',
      'removing tonal motion entirely',
    ],
    wrong_interpretations: [
      { wrong: 'less pretty = atonal', correct: 'less pretty = colder voicings + HPF + lower gain; still tonal' },
    ],
  },
  {
    id: 'no-cinematic',
    surface_forms: ['不要太电影', '别那么电影', 'no cinematic', 'less cinematic'],
    primary_language: 'zh',
    prefer_tags: ['restrained', 'dub'],
    forbid_tags: ['cinematic'],
    mix_implications: { spatial: 'drier' },
    arrangement_implications: { breakdown_max_bars: 8, forbid_section_function: ['build'] },
    forbidden_overreactions: [
      'removing pad entirely',
      'cutting reverb to zero',
    ],
    wrong_interpretations: [
      { wrong: 'no cinematic = no pad', correct: 'no cinematic = pad stays but doesn\'t swell into the drop' },
    ],
  },
  {
    id: 'back-to-club',
    surface_forms: ['回 club 一点', 'back to club', '更 club', 'club一点'],
    primary_language: 'mixed',
    prefer_tags: ['warehouse', 'hypnotic', 'mechanical'],
    forbid_tags: ['cinematic'],
    arrangement_implications: { breakdown_max_bars: 8, drop_energy_floor: 0.7 },
    forbidden_overreactions: [
      'removing breakdown entirely',
      'making the drop louder via master gain',
    ],
    wrong_interpretations: [
      { wrong: 'back to club = simpler', correct: 'back to club = groove-continuity priority; keep arrangement, shorten breakdown' },
    ],
  },
  {
    id: 'closer-to-ground',
    surface_forms: ['更贴地', 'grounded', 'less ethereal'],
    primary_language: 'zh',
    prefer_tags: ['restrained', 'punchy'],
    forbid_tags: ['airy', 'cinematic'],
    mix_implications: { band_emphasis: 'low_mid' },
    forbidden_overreactions: [
      'killing all high-frequency content',
    ],
    wrong_interpretations: [],
  },
  {
    id: 'more-mechanical',
    surface_forms: ['更机械', 'more mechanical', '更工业'],
    primary_language: 'zh',
    prefer_tags: ['mechanical', 'industrial', 'static'],
    forbid_tags: ['organic', 'evolving', 'warm'],
    forbidden_overreactions: [
      'flattening swing to zero (mechanical doesn\'t mean inhuman — keep micro-timing)',
    ],
    wrong_interpretations: [],
  },
  {
    id: 'more-broken',
    surface_forms: ['更碎', 'more broken', 'chopped'],
    primary_language: 'zh',
    prefer_tags: ['broken', 'arrhythmic', 'dense'],
    forbid_tags: ['static'],
    forbidden_overreactions: [
      'breaking the kick — broken applies to perc / hat / chord, kick stays stable unless explicit',
    ],
    wrong_interpretations: [
      { wrong: 'more broken = break everything', correct: 'broken hat / perc / chord stab; kick + bass usually stay stable' },
    ],
  },
  {
    id: 'more-stable',
    surface_forms: ['更稳', '低频要稳', 'groove 要稳', 'groove要稳', 'groove 稳', '要稳定', 'more stable', 'tighter low-end'],
    primary_language: 'zh',
    prefer_tags: ['static', 'tight', 'restrained'],
    forbid_tags: ['arrhythmic', 'broken'],
    mix_implications: { spatial: 'tighter', band_emphasis: 'sub' },
    forbidden_overreactions: [
      'replacing the bass entirely with a sub sine — stability ≠ removing motion',
    ],
    wrong_interpretations: [],
  },
  {
    id: 'bass-supports',
    surface_forms: ['bass 要托住', '低频托住', 'bass should support'],
    primary_language: 'mixed',
    prefer_tags: ['warm', 'static'],
    forbid_tags: ['gritty'],
    mix_implications: { band_emphasis: 'sub' },
    forbidden_overreactions: [
      'making the bass loud enough to overpower the kick',
    ],
    wrong_interpretations: [],
  },
  {
    id: 'kick-has-body',
    surface_forms: ['kick 要有身体', '底鼓有身体', 'kick has body'],
    primary_language: 'mixed',
    prefer_tags: ['punchy', 'warm'],
    forbid_tags: ['tight'],
    mix_implications: { band_emphasis: 'low' },
    forbidden_overreactions: [
      'extending the kick decay until it bleeds into bass — body comes from low-mid presence, not length',
    ],
    wrong_interpretations: [],
  },
  {
    id: 'no-edm',
    surface_forms: ['不要 EDM', '不要那么 EDM', '不要变 EDM', 'no EDM', 'less EDM'],
    primary_language: 'zh',
    prefer_tags: ['restrained', 'dub', 'hypnotic'],
    forbid_tags: ['cinematic', 'aggressive'],
    arrangement_implications: { forbid_section_function: ['build'] },
    forbidden_overreactions: [
      'flattening all dynamics entirely',
    ],
    wrong_interpretations: [
      { wrong: 'no EDM = no drop', correct: 'no EDM = no big-drop dynamics; section can still call itself drop, just at restrained energy' },
    ],
  },
  {
    id: 'no-grand-dynamics',
    surface_forms: ['不要大开大合', 'no grand dynamics', 'restrained dynamics'],
    primary_language: 'zh',
    prefer_tags: ['restrained', 'static'],
    forbid_tags: ['cinematic', 'aggressive'],
    arrangement_implications: { forbid_section_function: ['build', 'breakdown'] },
    forbidden_overreactions: [],
    wrong_interpretations: [],
  },
  {
    id: 'more-hypnotic',
    surface_forms: ['更 hypnotic', '更迷幻', 'more hypnotic'],
    primary_language: 'mixed',
    prefer_tags: ['hypnotic', 'static', 'evolving'],
    forbid_tags: ['cinematic'],
    forbidden_overreactions: [],
    wrong_interpretations: [
      { wrong: 'hypnotic = repetitive without change', correct: 'hypnotic = strong loop + slow micro-evolution' },
    ],
  },
  {
    id: 'more-warehouse',
    surface_forms: ['更 warehouse', '更地下', 'more warehouse', 'warehouse vibe'],
    primary_language: 'mixed',
    prefer_tags: ['warehouse', 'gritty', 'mechanical'],
    forbid_tags: ['cinematic', 'sweet'],
    mix_implications: { spatial: 'tighter' },
    forbidden_overreactions: [],
    wrong_interpretations: [],
  },
  {
    id: 'more-dub',
    surface_forms: ['更 dub', '更 dubby', 'more dub'],
    primary_language: 'mixed',
    prefer_tags: ['dub', 'evolving', 'warm'],
    forbid_tags: ['cinematic'],
    mix_implications: { spatial: 'wetter' },
    forbidden_overreactions: [
      'pushing chord delay to feedback — dub adds tail, not chaos',
    ],
    wrong_interpretations: [],
  },
  {
    id: 'more-restrained',
    surface_forms: ['更克制', 'more restrained', 'pull back'],
    primary_language: 'zh',
    prefer_tags: ['restrained', 'static', 'sparse'],
    forbid_tags: ['aggressive', 'dense'],
    forbidden_overreactions: [
      'cutting energy below 0.4 — restrained ≠ quiet',
    ],
    wrong_interpretations: [],
  },
  {
    id: 'more-broken-kick',
    surface_forms: ['打散底鼓', 'broken kick'],
    primary_language: 'zh',
    prefer_tags: ['broken', 'arrhythmic'],
    forbid_tags: [],
    forbidden_overreactions: [],
    wrong_interpretations: [
      { wrong: 'broken kick = remove kick', correct: 'broken kick = non-4-on-4 kick; still functions as backbone' },
    ],
  },
];

export interface VocabMatch {
  entry: ProductionVocabEntry;
  matched_form: string;
  index: number;
}

/** Find every vocab entry whose surface form appears in `text`. */
export function matchProductionVocab(text: string): VocabMatch[] {
  const out: VocabMatch[] = [];
  const lower = text.toLowerCase();
  for (const e of PRODUCTION_VOCAB) {
    for (const form of e.surface_forms) {
      const idx = lower.indexOf(form.toLowerCase());
      if (idx >= 0) {
        out.push({ entry: e, matched_form: form, index: idx });
        break; // one match per entry is enough
      }
    }
  }
  return out;
}

/** Aggregate the implications of every match into a single retrieval hint. */
export interface VocabAggregate {
  prefer_tags: string[];
  forbid_tags: string[];
  modifiers: string[];
  band_emphasis?: string;
  band_attenuation?: string;
  spatial?: string;
  breakdown_max_bars?: number;
  drop_energy_floor?: number;
  forbid_section_function: string[];
  forbidden_overreactions: string[];
}

export function aggregateMatches(matches: VocabMatch[]): VocabAggregate {
  const out: VocabAggregate = {
    prefer_tags: [],
    forbid_tags: [],
    modifiers: [],
    forbid_section_function: [],
    forbidden_overreactions: [],
  };
  for (const m of matches) {
    for (const t of m.entry.prefer_tags) if (!out.prefer_tags.includes(t)) out.prefer_tags.push(t);
    for (const t of m.entry.forbid_tags) if (!out.forbid_tags.includes(t)) out.forbid_tags.push(t);
    for (const md of m.entry.brief_deltas?.modifiers ?? []) if (!out.modifiers.includes(md)) out.modifiers.push(md);
    if (m.entry.mix_implications?.band_emphasis) out.band_emphasis = m.entry.mix_implications.band_emphasis;
    if (m.entry.mix_implications?.band_attenuation) out.band_attenuation = m.entry.mix_implications.band_attenuation;
    if (m.entry.mix_implications?.spatial) out.spatial = m.entry.mix_implications.spatial;
    if (m.entry.arrangement_implications?.breakdown_max_bars !== undefined) {
      out.breakdown_max_bars = m.entry.arrangement_implications.breakdown_max_bars;
    }
    if (m.entry.arrangement_implications?.drop_energy_floor !== undefined) {
      out.drop_energy_floor = m.entry.arrangement_implications.drop_energy_floor;
    }
    for (const sf of m.entry.arrangement_implications?.forbid_section_function ?? []) {
      if (!out.forbid_section_function.includes(sf)) out.forbid_section_function.push(sf);
    }
    for (const w of m.entry.forbidden_overreactions) {
      if (!out.forbidden_overreactions.includes(w)) out.forbidden_overreactions.push(w);
    }
  }
  return out;
}
