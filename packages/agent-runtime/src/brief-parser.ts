import type { BriefGraph, Mode } from '@cactus/ir';

// ----- English keyword tables -----

const GENRE_KEYWORDS: Array<[RegExp, string, string[]]> = [
  // Order: most-specific first so 'neurofunk dnb' or 'dub techno' match before bare genre.
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
  [/\bdrone\b/i, 'ambient', ['drone']],
  [/\btechno\b/i, 'techno', []],
  [/\bhouse\b/i, 'house', []],
  [/\bidm\b/i, 'idm', []],
  [/\bambient\b/i, 'ambient', []],
];

// ----- Chinese keyword tables (matched on raw text, not lowercased) -----

const GENRE_KEYWORDS_CN: Array<[RegExp, string, string[]]> = [
  [/迷雾科技舞|漂浮科技舞|低空科技舞/, 'dub_techno', []],
  [/深邃浩室|深度浩室/, 'house', ['deep']],
  [/低保真浩室|低保真[\s-]?浩室|lo[\s-]?fi[\s-]?浩室/i, 'house', ['lo_fi']],
  [/酸性浩室|酸味浩室/, 'house', ['acid']],
  [/旋律科技舞/, 'techno', ['melodic']],
  [/巅峰科技舞|高峰科技舞/, 'techno', ['peak_time']],
  [/神经放克|霓虹放克/, 'dnb', ['neurofunk']],
  [/液态鼓贝斯|液态鼓击贝斯/, 'dnb', ['liquid']],
  [/丛林|丛林节奏/, 'dnb', ['jungle']],
  [/鼓贝斯|鼓打贝斯|鼓击贝斯|鼓与贝斯/, 'dnb', []],
  [/漂移氛围|噪音漂移/, 'ambient', ['drone']],
  [/科技舞曲|科技舞|科技节拍/, 'techno', []],
  [/浩室/, 'house', []],
  [/智能舞曲|实验电子/, 'idm', []],
  [/环境音乐|氛围音乐|氛围/, 'ambient', []],
];

const MOOD_KEYWORDS = new Set<string>([
  'dark', 'light', 'driving', 'hypnotic', 'haunted', 'spacious', 'rainy',
  'deep', 'club-functional', 'intricate', 'fractured', 'alien', 'meditative',
  'rolling', 'tight', 'weightless', 'evolving', 'aggressive', 'soft',
  'minimal', 'busy', 'bright', 'warm', 'cold', 'distant', 'intimate',
  'industrial', 'organic', 'glitchy', 'psychedelic', 'dreamy', 'tense',
  'relaxed', 'energetic', 'introspective', 'cinematic',
]);

// Map Chinese mood phrases -> normalized English mood tags (so downstream agents
// see one shared vocabulary regardless of brief language).
const MOOD_KEYWORDS_CN: Array<[RegExp, string]> = [
  [/黑暗|深邃黑暗|阴沉/, 'dark'],
  [/明亮|清亮/, 'bright'],
  [/强劲|强烈|凶猛/, 'driving'],
  [/催眠|迷幻/, 'hypnotic'],
  [/鬼魅|闹鬼|阴森|幽灵/, 'haunted'],
  [/空灵|空旷|辽阔/, 'spacious'],
  [/雨/, 'rainy'],
  [/深沉|深邃/, 'deep'],
  [/俱乐部|舞池/, 'club-functional'],
  [/细致|精巧|繁复/, 'intricate'],
  [/破碎|断裂/, 'fractured'],
  [/异域|异星|外星/, 'alien'],
  [/冥想|沉思/, 'meditative'],
  [/翻滚|滚动/, 'rolling'],
  [/紧凑|紧致/, 'tight'],
  [/失重|漂浮/, 'weightless'],
  [/演变|渐进|演化/, 'evolving'],
  [/激进|凶悍/, 'aggressive'],
  [/柔和|柔软/, 'soft'],
  [/极简|简约/, 'minimal'],
  [/温暖/, 'warm'],
  [/冰冷|寒冷/, 'cold'],
  [/工业/, 'industrial'],
  [/有机/, 'organic'],
  [/迷离|迷蒙|梦幻/, 'dreamy'],
  [/紧张|紧绷/, 'tense'],
  [/放松/, 'relaxed'],
  [/电影感|影像感/, 'cinematic'],
];

// Each entry: regex (matched on lowercase text) → canonical modifier tag.
const MODIFIER_KEYWORDS: Array<[RegExp, string]> = [
  [/evolving[\s-]+chords?/, 'evolving-chords'],
  [/rain[\s-]+texture/, 'rain-texture'],
  [/fm[\s-]+textures?/, 'fm-textures'],
  [/reece[\s-]+bass/, 'reece-bass'],
  [/909[\s-]+core|\b909\s*core\b/, '909-core'],
  [/polyrhythm/, 'polyrhythm'],
  [/granular/, 'granular'],
  [/breakbeat/, 'breakbeat'],
  [/shuffle/, 'shuffle'],
];

const MODIFIER_KEYWORDS_CN: Array<[RegExp, string]> = [
  [/909\s*核心|909核心/, '909-core'],
  [/雨声|雨声纹理|雨纹理/, 'rain-texture'],
  [/fm\s*纹理|fm[\s-]?textures/i, 'fm-textures'],
  [/演变和弦|渐进和弦/, 'evolving-chords'],
  [/瑞斯贝斯|reece[\s-]?bass/i, 'reece-bass'],
  [/复节奏|多节奏/, 'polyrhythm'],
  [/颗粒合成|颗粒/, 'granular'],
  [/碎拍/, 'breakbeat'],
  [/摇摆/, 'shuffle'],
];

const KEY_RE = /\b(in|key\s+of)\s+([A-G](?:#|b)?)\s*(major|minor|dorian|phrygian|lydian|mixolydian|aeolian|locrian)?\b/i;
const KEY_RE_CN = /([A-G](?:#|b)?)\s*([大小])调/i;

const VALID_MODES: Mode[] = [
  'major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian',
  'aeolian', 'locrian', 'harmonic_minor', 'melodic_minor', 'hijaz', 'blues',
];

const HAS_CHINESE = /[一-龥]/;

export function parseBrief(text: string): BriefGraph {
  const t = text;

  // BPM: English, Chinese, or bare number with hint.
  let bpm: number | undefined;
  const bpmEn = /(\d{2,3})\s*bpm/i.exec(t);
  const bpmCn = /(\d{2,3})\s*(?:拍\/?分|拍|节拍)|(?:速度|节拍|每分钟)\s*[:：]?\s*(\d{2,3})/.exec(t);
  if (bpmEn) bpm = Number(bpmEn[1]);
  else if (bpmCn) bpm = Number(bpmCn[1] ?? bpmCn[2]);

  // Genre + modifiers from English first.
  let primary_genre: string | undefined;
  const modifiers = new Set<string>();
  for (const [re, genre, mods] of GENRE_KEYWORDS) {
    if (re.test(t)) {
      primary_genre = genre;
      for (const m of mods) modifiers.add(m);
      break;
    }
  }
  // Chinese fallback (or augmentation) if no English genre matched, OR if Chinese
  // adds modifiers absent from the English match.
  for (const [re, genre, mods] of GENRE_KEYWORDS_CN) {
    if (re.test(t)) {
      if (!primary_genre) primary_genre = genre;
      // If both branches agree on the same genre, merge mods. If they disagree,
      // English wins for the genre slug, Chinese mods still applied.
      if (primary_genre === genre) {
        for (const m of mods) modifiers.add(m);
      }
    }
  }

  // Mood: English (substring on lowercased) + Chinese (regex on raw).
  const mood = new Set<string>();
  const lower = t.toLowerCase();
  for (const m of MOOD_KEYWORDS) {
    if (lower.includes(m)) mood.add(m);
  }
  if (HAS_CHINESE.test(t)) {
    for (const [re, tag] of MOOD_KEYWORDS_CN) {
      if (re.test(t)) mood.add(tag);
    }
  }

  // Modifiers: English regex on lowercased + Chinese regex on raw.
  for (const [re, tag] of MODIFIER_KEYWORDS) {
    if (re.test(lower)) modifiers.add(tag);
  }
  if (HAS_CHINESE.test(t)) {
    for (const [re, tag] of MODIFIER_KEYWORDS_CN) {
      if (re.test(t)) modifiers.add(tag);
    }
  }

  // Energy.
  let energy: BriefGraph['energy'];
  if (/\b(peak[-\s]?time|club|driving|aggressive|high\s+energy)\b/i.test(t) ||
      /(巅峰|高峰|俱乐部|强劲|激进|高能量|凶猛)/.test(t)) {
    energy = 'high';
  } else if (/\b(meditative|ambient|drone|low\s+energy|calm|gentle)\b/i.test(t) ||
             /(冥想|环境|氛围|漂移|低能量|平静|轻柔)/.test(t)) {
    energy = 'low';
  } else {
    energy = 'mid';
  }

  // Duration target.
  let duration_target_sec: number | undefined;
  const dMin = /(\d+)\s*(?:min(?:ute)?s?)\b/i.exec(t);
  const dSec = /(\d+)\s*(?:sec(?:ond)?s?)\b/i.exec(t);
  const dMinCn = /(\d+)\s*分钟/.exec(t);
  const dSecCn = /(\d+)\s*秒/.exec(t);
  if (dMin) duration_target_sec = Number(dMin[1]) * 60;
  else if (dSec) duration_target_sec = Number(dSec[1]);
  else if (dMinCn) duration_target_sec = Number(dMinCn[1]) * 60;
  else if (dSecCn) duration_target_sec = Number(dSecCn[1]);

  // Key.
  let key: BriefGraph['key'];
  const km = KEY_RE.exec(t);
  if (km) {
    const tonic = km[2]!;
    const modeRaw = (km[3] ?? 'minor').toLowerCase();
    const mode: Mode = (VALID_MODES as string[]).includes(modeRaw) ? (modeRaw as Mode) : 'minor';
    key = { tonic, mode };
  } else {
    const kmCn = KEY_RE_CN.exec(t);
    if (kmCn) {
      const tonic = kmCn[1]!;
      const mode: Mode = kmCn[2] === '大' ? 'major' : 'minor';
      key = { tonic, mode };
    }
  }

  // References.
  const refMatches: BriefGraph['references'] = [];
  const likeRe = /\blike\s+([A-Z][\w&\s]{1,30}?)(?=[,.;]|\sand\s|\swith\s|$)/g;
  let lm: RegExpExecArray | null;
  while ((lm = likeRe.exec(t)) !== null) {
    refMatches.push({ kind: 'artist', value: (lm[1] ?? '').trim() });
  }
  // Chinese: 像 X / X 风格
  const likeReCn = /(?:像|类似|参考)\s*([A-Za-z][\w\s&]{0,30}|[一-龥]{1,8})/g;
  let lmCn: RegExpExecArray | null;
  while ((lmCn = likeReCn.exec(t)) !== null) {
    const v = (lmCn[1] ?? '').trim();
    if (v) refMatches.push({ kind: 'artist', value: v });
  }
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
    constraints: parseConstraints(t),
  };
}

/**
 * Hard constraints, e.g. "no kick", "no 4-on-floor", "must be mono in low band".
 * Stored on /brief/constraints so the build-graph step can honor them and the
 * revision-locality scorer can verify they survive feedback.
 */
function parseConstraints(t: string): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if (/\bno\s+kick\b|\bwithout\s+kick\b|不要\s*底鼓|没有\s*底鼓/i.test(t)) c.no_kick = true;
  if (/\bno\s+4[\s-]?on[\s-]?the[\s-]?floor\b|不要\s*四四拍/i.test(t)) c.no_four_on_floor = true;
  if (/\bno\s+rhythm(?:ic)?(?:\s+grid)?\b|无节拍|不要节奏/i.test(t)) c.no_rhythmic_grid = true;
  if (/\bmono\s+(?:low|bass)\b|低端\s*单声道/i.test(t)) c.mono_low = true;
  return c;
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
