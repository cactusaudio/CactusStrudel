// Feedback text parser. Maps natural-language phrases — English, Chinese,
// or mixed — to (a) ScoreVector weight bias, (b) attribute preferences,
// (c) revision_hints for low-effort consumers, and (d) synthetic_targets
// the revision planner can turn into JSON Patches directly.

import type { ScoreVector } from '@cactus/ir';

export interface SyntheticCritiqueTarget {
  /** Stable id derived from the rule + index; not a uuid because feedback parsing must stay deterministic. */
  target_id: string;
  agent: string; // producer-mix-engineer | producer-composer | producer-arranger | producer-sound-designer
  graph_paths: string[];
  problem: string;
  evidence: Record<string, unknown>;
  revision_instruction: string;
  severity: number;
  /** Direction the patch should move: e.g. {kick_gain_db: +2}. */
  intended_movement: Record<string, number | string>;
}

export interface ParsedFeedback {
  /** Multiplicative adjustment to score weights, applied as: weight *= 1 + adjust. */
  weight_adjustments: Partial<ScoreVector>;
  /** Free-text attribute preferences logged for future ranking priors. */
  attribute_preferences: Record<string, number>;
  /** Targeted revision instructions (graph_path → instruction). Legacy surface. */
  revision_hints: Array<{ graph_path: string; instruction: string }>;
  /** G3: planner-ready synthetic critique targets. */
  synthetic_targets: SyntheticCritiqueTarget[];
  /** G3: invariants the planner must preserve. */
  invariants: Array<{ path: string; description: string }>;
  /** Detected source language(s). */
  language: 'en' | 'zh' | 'mixed' | 'unknown';
}

interface Rule {
  id: string;
  re: RegExp;
  weight_axis?: keyof ScoreVector;
  weight_delta?: number;
  attribute?: { key: string; delta: number };
  revision?: { graph_path: string; instruction: string };
  /** Synthetic target template (resolved to a SyntheticCritiqueTarget below). */
  target?: Omit<SyntheticCritiqueTarget, 'target_id'>;
}

const RULES: Rule[] = [
  // ------- groove / kick / body -------
  {
    id: 'kick-harder',
    re: /punch(y|ier)|tighter\s+(groove|kick)|kick\s+(harder|更硬|更紧)|鼓\s*更\s*硬|底鼓\s*更\s*硬/i,
    weight_axis: 'groove', weight_delta: 0.4,
    attribute: { key: 'punchy_kick', delta: 0.5 },
    target: {
      agent: 'producer-mix-engineer',
      graph_paths: ['/mix_graph/orbits/0/gain'],
      problem: 'kick lacks punch / body emphasis requested',
      evidence: { user_feedback: 'kick harder' },
      revision_instruction: 'raise kick orbit gain by ~2 dB; tighten kick attack envelope',
      severity: 0.7,
      intended_movement: { kick_orbit_gain_db: +2 },
    },
  },
  // ------- bass / sub / low-end stability -------
  {
    id: 'bass-stable',
    re: /bass.*(?:stable|stabler|tighter|locked)|sub.*(?:stable|tighter)|低频\s*(?:要|更)?\s*(?:稳|稳定|结实)|贝斯\s*稳/i,
    weight_axis: 'mix_translation', weight_delta: 0.3,
    attribute: { key: 'bass_stable', delta: 0.6 },
    target: {
      agent: 'producer-mix-engineer',
      graph_paths: ['/mix_graph/orbits'],
      problem: 'bass / sub low-end requested to be more stable',
      evidence: { user_feedback: 'low-end stable' },
      revision_instruction: 'narrow bass orbit width to ≤ 0.5; raise bass→kick sidechain release toward 200 ms',
      severity: 0.6,
      intended_movement: { bass_orbit_width: -0.3 },
    },
  },
  // ------- chord sweetness / dissonance -------
  {
    id: 'chord-less-pretty',
    re: /chord.*(?:less\s+pretty|colder|harder|colder)|chord.*别\s*太\s*甜|和弦\s*(?:别\s*太\s*甜|冷\s*一点|更\s*冷)/i,
    weight_axis: 'sound_design', weight_delta: 0.3,
    attribute: { key: 'chord_cold', delta: 0.6 },
    target: {
      agent: 'producer-sound-designer',
      graph_paths: ['/sound_palette/layers'],
      problem: 'chord too sweet/pretty; user wants colder timbre',
      evidence: { user_feedback: 'chords colder, less pretty' },
      revision_instruction: 'lower chord orbit gain ~3 dB; raise chord HPF to 600 Hz; reduce chord room_send by 0.1',
      severity: 0.5,
      intended_movement: { chord_orbit_gain_db: -3, chord_hpf_hz: +200 },
    },
  },
  // ------- breakdown shape -------
  {
    id: 'breakdown-shorter',
    re: /breakdown.*(short|shorter|tighter)|breakdown\s*短\s*一点|breakdown\s*缩\s*短|断奏\s*短/i,
    weight_axis: 'arrangement_arc', weight_delta: 0.4,
    attribute: { key: 'short_breakdown', delta: 0.6 },
    target: {
      agent: 'producer-arranger',
      graph_paths: ['/song/sections'],
      problem: 'breakdown too long; user wants tighter return to club',
      evidence: { user_feedback: 'breakdown shorter' },
      revision_instruction: 'shorten any function=breakdown section to ≤ 8 bars',
      severity: 0.55,
      intended_movement: { breakdown_max_bars: 8 },
    },
  },
  // ------- club continuity -------
  {
    id: 'back-to-club',
    re: /back\s+to\s+club|stay\s+club|不要那么\s*(?:cinem|movie|电影)|回\s*club|club\s*一点|更\s*club|别\s*太\s*电影/i,
    weight_axis: 'genre_fit', weight_delta: 0.4,
    attribute: { key: 'club_continuity', delta: 0.7 },
    target: {
      agent: 'producer-arranger',
      graph_paths: ['/song/sections', '/song/energy_curve'],
      problem: 'arrangement drifted into cinematic; user wants club continuity',
      evidence: { user_feedback: 'back to club' },
      revision_instruction: 'shorten breakdown sections; ensure kick stays in main/drop sections; lift drop energy to ≥ 0.85',
      severity: 0.6,
      intended_movement: { drop_energy_floor: 0.85 },
    },
  },
  // ------- EDM avoidance -------
  {
    id: 'no-edm',
    re: /no\s+(?:edm|big\s+drop)|less\s+edm|不要(?:那么|变|变成)?\s*EDM/i,
    weight_axis: 'genre_fit', weight_delta: 0.4,
    attribute: { key: 'avoid_edm', delta: 0.7 },
    target: {
      agent: 'producer-arranger',
      graph_paths: ['/song/energy_curve'],
      problem: 'arrangement reads as EDM-style big drop; user wants understated',
      evidence: { user_feedback: 'no EDM' },
      revision_instruction: 'flatten the rise into drop; energy curve should not exceed 0.85 spike',
      severity: 0.55,
      intended_movement: { max_energy: 0.85 },
    },
  },
  // ------- spaciousness without emptiness -------
  {
    id: 'more-space-not-empty',
    re: /more\s+(?:space|spacious|air).*(?:not\s+empty|don't\s+empty)|更\s*空.*(?:不要变成|别变成)?\s*(?:没东西|空洞)|空灵.*别\s*空洞/i,
    weight_axis: 'sound_design', weight_delta: 0.4,
    attribute: { key: 'spacious_dense', delta: 0.7 },
    target: {
      agent: 'producer-sound-designer',
      graph_paths: ['/mix_graph/orbits'],
      problem: 'user wants more space without losing density',
      evidence: { user_feedback: 'more space but not empty' },
      revision_instruction: 'raise pad/chord room_send by 0.1 (cap 0.55); keep kick + bass active everywhere',
      severity: 0.5,
      intended_movement: { pad_room_send_delta: +0.1 },
    },
  },
  // ------- hat brightness / harshness -------
  {
    id: 'hat-harsh',
    re: /hat\s+(?:harsh|too\s+bright|piercing)|hat\s+刺耳|hat\s+太\s*亮|镲片\s*刺耳/i,
    weight_axis: 'sound_design', weight_delta: 0.3,
    attribute: { key: 'hat_softer', delta: 0.6 },
    target: {
      agent: 'producer-sound-designer',
      graph_paths: ['/sound_palette/layers'],
      problem: 'hat is harsh / too bright',
      evidence: { user_feedback: 'hat harsh' },
      revision_instruction: 'raise hat HPF to 8000+ Hz; lower hat orbit gain ~2 dB',
      severity: 0.45,
      intended_movement: { hat_hpf_hz: +1000, hat_orbit_gain_db: -2 },
    },
  },
  // ------- low-mid mud -------
  {
    id: 'low-mid-mud',
    re: /muddy|cloudy|murky|low[-\s]?mid\s+mud|低频\s*(?:糊|混|脏)|低中频\s*糊/i,
    weight_axis: 'mix_translation', weight_delta: 0.5,
    attribute: { key: 'avoid_low_mid_buildup', delta: 0.7 },
    target: {
      agent: 'producer-mix-engineer',
      graph_paths: ['/sound_palette/layers'],
      problem: 'low_mid (200-500 Hz) mud',
      evidence: { user_feedback: 'low-mid muddy' },
      revision_instruction: 'raise chord/pad HPF to 500+ Hz; reduce chord/pad gain by 2 dB if stacked',
      severity: 0.55,
      intended_movement: { chord_hpf_hz: +100 },
    },
  },
  // ------- chopped / fractured drums while preserving low-end -------
  {
    id: 'broken-drums-stable-low',
    re: /鼓\s*更?\s*碎.*低频\s*(?:稳|要稳)|chopped\s+drums.*stable\s+low/i,
    weight_axis: 'groove', weight_delta: 0.3,
    attribute: { key: 'chopped_drums_stable_low', delta: 0.7 },
    target: {
      agent: 'producer-composer',
      graph_paths: ['/pattern_bank/patterns'],
      problem: 'user wants chopped/fractured drum patterns while keeping low-end stable',
      evidence: { user_feedback: 'chopped drums + stable low' },
      revision_instruction: 'increase hat/perc density (hh*8 / euclid 7,16) but lock kick to 4-on-floor stability',
      severity: 0.5,
      intended_movement: { hat_density: +2, kick_stability: 1 },
    },
  },
  // ------- memorability / hook -------
  {
    id: 'add-hook',
    re: /\bhook\b|memorable|catchy|主旋律|记忆点/i,
    weight_axis: 'memorability_hook', weight_delta: 0.4,
    attribute: { key: 'add_hook', delta: 0.5 },
  },
  // ------- generic affective signals (legacy keep) -------
  { id: 'louder', re: /louder|more\s+loud|too\s+quiet|大声|响一点/i, weight_axis: 'mix_translation', weight_delta: 0.3, revision: { graph_path: '/mix_graph/master/gain', instruction: 'increase master gain by 2 dB' } },
  { id: 'quieter', re: /quieter|too\s+loud|小声|轻一点/i, weight_axis: 'mix_translation', weight_delta: 0.3, revision: { graph_path: '/mix_graph/master/gain', instruction: 'reduce master gain by 2 dB' } },
  { id: 'darker', re: /dark(er)?|warmer|更\s*暗|更\s*黑暗/i, weight_axis: 'sound_design', weight_delta: 0.3, attribute: { key: 'high_band_rolloff', delta: 0.5 } },
  { id: 'brighter', re: /bright(er)?|crispy|更\s*亮|更\s*清亮/i, weight_axis: 'sound_design', weight_delta: 0.3, attribute: { key: 'high_band_emphasis', delta: 0.5 } },
  { id: 'love', re: /\b(love|amazing|exactly|perfect|nailed)\b|完美|太对了|就是这个/i, weight_axis: 'user_taste_fit', weight_delta: 0.6 },
  { id: 'hate', re: /\b(hate|wrong|nope)\b|不对|不行|很烂/i, weight_axis: 'user_taste_fit', weight_delta: -0.4 },
];

const HAS_CHINESE = /[一-龥]/;

export function parseFeedback(text: string): ParsedFeedback {
  const adjustments: Partial<ScoreVector> = {};
  const attributes: Record<string, number> = {};
  const hints: ParsedFeedback['revision_hints'] = [];
  const targets: SyntheticCritiqueTarget[] = [];

  for (const rule of RULES) {
    if (!rule.re.test(text)) continue;
    if (rule.weight_axis && rule.weight_delta !== undefined) {
      adjustments[rule.weight_axis] = (adjustments[rule.weight_axis] ?? 0) + rule.weight_delta;
    }
    if (rule.attribute) {
      attributes[rule.attribute.key] = (attributes[rule.attribute.key] ?? 0) + rule.attribute.delta;
    }
    if (rule.revision) hints.push(rule.revision);
    if (rule.target) {
      targets.push({ target_id: `feedback-${rule.id}-${targets.length.toString().padStart(2, '0')}`, ...rule.target });
    }
  }

  // Invariants every revision must preserve unless the user explicitly
  // requested a change. The planner consumes these via locality scoring.
  const invariants = inferInvariants(text);

  const hasZh = HAS_CHINESE.test(text);
  const hasEn = /[a-zA-Z]/.test(text);
  const language: ParsedFeedback['language'] = hasZh && hasEn ? 'mixed' : hasZh ? 'zh' : hasEn ? 'en' : 'unknown';

  return {
    weight_adjustments: adjustments,
    attribute_preferences: attributes,
    revision_hints: hints,
    synthetic_targets: targets,
    invariants,
    language,
  };
}

function inferInvariants(text: string): ParsedFeedback['invariants'] {
  const invs: ParsedFeedback['invariants'] = [];
  // BPM / genre / key are sticky unless the user explicitly requests a change.
  if (!/(?:bpm|tempo|速度|节拍|每分钟)/i.test(text)) {
    invs.push({ path: '/brief/bpm', description: 'BPM not mentioned in feedback — must not change' });
  }
  if (!/(genre|风格|流派|换成|改成)/i.test(text)) {
    invs.push({ path: '/brief/primary_genre', description: 'genre not mentioned in feedback — must not change' });
  }
  if (!/(key|tonic|大调|小调|调|和声)/i.test(text)) {
    invs.push({ path: '/brief/key', description: 'key not mentioned in feedback — must not change' });
  }
  return invs;
}

/**
 * Apply parsed feedback to a PreferenceGraph: shift weights, update preferences.
 * Weights are renormalized so they sum to 1 after adjustments.
 */
export function applyFeedback(
  weights: ScoreVector,
  parsed: ParsedFeedback,
): ScoreVector {
  const next: ScoreVector = { ...weights };
  for (const [k, delta] of Object.entries(parsed.weight_adjustments) as Array<[keyof ScoreVector, number]>) {
    next[k] = Math.max(0, next[k] * (1 + delta));
  }
  const total = Object.values(next).reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (const k of Object.keys(next) as Array<keyof ScoreVector>) {
      next[k] = next[k] / total;
    }
  }
  return next;
}
