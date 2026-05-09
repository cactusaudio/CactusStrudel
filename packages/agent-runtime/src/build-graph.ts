import { v4 as uuid } from 'uuid';
import {
  type SessionGraph,
  type BriefGraph,
  type SongGraph,
  type LayerGraph,
  type PatternBank,
  type SoundPalette,
  type MixGraph,
  type Section,
  type SectionFunction,
  type Role,
  SCHEMA_VERSION,
} from '@cactus/ir';
import {
  loadGenre,
  loadCookbookSnippets,
  pickSnippet,
  type GenreSpec,
} from '@cactus/genres';
import { createRng, hashStringToSeed } from './seed-rng.js';

export interface BuildGraphOptions {
  /** PRNG seed; defaults to hash of brief.text. */
  seed?: number;
}

export async function buildSessionGraphFromBrief(
  brief: BriefGraph,
  options: BuildGraphOptions = {},
): Promise<SessionGraph> {
  const seed = options.seed ?? hashStringToSeed(brief.text);
  const rng = createRng(seed);

  if (!brief.primary_genre) {
    throw new Error('cannot build SessionGraph: brief.primary_genre is unset');
  }
  const genre = await loadGenre(brief.primary_genre);

  const bpm = brief.bpm ?? Math.round((genre.bpm_range[0] + genre.bpm_range[1]) / 2);
  const briefFinal: BriefGraph = { ...brief, bpm };

  const song = buildSong(genre, briefFinal, rng);
  const layers = buildLayers(genre, briefFinal);
  const layerActivation = buildLayerActivation(layers, song);
  song.layer_activation = layerActivation;

  const patternBank = await buildPatternBank(genre, briefFinal, layers, song, rng);
  const soundPalette = buildSoundPalette(genre, layers, briefFinal);
  const mixGraph = buildMixGraph(genre, layers, briefFinal);

  const graph: SessionGraph = {
    schema_version: SCHEMA_VERSION,
    session_id: uuid(),
    created_at: new Date().toISOString(),
    brief: briefFinal,
    song,
    layers,
    pattern_bank: patternBank,
    sound_palette: soundPalette,
    mix_graph: mixGraph,
    render_graph: [],
    critique_graph: [],
    preference_graph: {
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
    },
    iteration_log: [],
  };
  return graph;
}

function buildSong(genre: GenreSpec, brief: BriefGraph, rng: () => number): SongGraph {
  const targetSec = brief.duration_target_sec ?? 180;
  const cps = (brief.bpm ?? 120) / 240;
  const targetCycles = targetSec * cps;
  // Sum of section lengths in genre's template:
  const templateTotal = genre.section_template.reduce((a, s) => a + s.length_bars, 0);
  // Scale to fit target duration; round to whole bars; never below template total / 2.
  let scale = templateTotal === 0 ? 1 : Math.max(0.5, targetCycles / templateTotal);
  scale = Math.min(scale, 2.0);

  const sections: Section[] = [];
  let bar = 0;
  for (const tpl of genre.section_template) {
    const length = Math.max(1, Math.round(tpl.length_bars * scale));
    sections.push({
      id: deterministicUuid(rng),
      name: tpl.name,
      start_bar: bar,
      end_bar: bar + length,
      energy: energyForFunction(tpl.function as SectionFunction, brief.energy ?? 'mid'),
      function: tpl.function as SectionFunction,
    });
    bar += length;
  }
  const totalBars = bar;
  const energyCurve = buildEnergyCurve(sections, totalBars);

  return {
    cycles_per_bar: 1,
    total_bars: totalBars,
    sections,
    energy_curve: energyCurve,
    layer_activation: {},
  };
}

function deterministicUuid(rng: () => number): string {
  const hex = (n: number) => Math.floor(rng() * 16).toString(16);
  const block = (n: number) => Array.from({ length: n }, () => hex(0)).join('');
  return `${block(8)}-${block(4)}-4${block(3)}-8${block(3)}-${block(12)}`;
}

function energyForFunction(fn: SectionFunction, baseEnergy: 'low' | 'mid' | 'high' | 'peak'): number {
  const base = { low: 0.35, mid: 0.6, high: 0.8, peak: 0.95 }[baseEnergy];
  switch (fn) {
    case 'intro': return Math.max(0.2, base - 0.4);
    case 'main': return base;
    case 'verse': return base - 0.05;
    case 'chorus': return base + 0.1;
    case 'breakdown': return Math.max(0.3, base - 0.3);
    case 'build': return base - 0.05;
    case 'drop': return Math.min(1, base + 0.15);
    case 'bridge': return base - 0.1;
    case 'outro': return Math.max(0.2, base - 0.4);
    case 'transition': return base - 0.1;
    default: return base;
  }
}

function buildEnergyCurve(sections: Section[], totalBars: number): number[] {
  const curve = new Array<number>(totalBars).fill(0);
  for (let bar = 0; bar < totalBars; bar++) {
    const sec = sections.find((s) => bar >= s.start_bar && bar < s.end_bar) ?? sections[0]!;
    // Smooth ramp into and out of each section's target energy.
    const into = Math.min(1, (bar - sec.start_bar) / Math.max(1, Math.floor((sec.end_bar - sec.start_bar) * 0.3)));
    curve[bar] = sec.energy * Math.max(0.4, Math.min(1, into));
  }
  return curve;
}

function buildLayers(genre: GenreSpec, brief: BriefGraph): LayerGraph[] {
  const layers: LayerGraph[] = [];
  let orbit = 0;
  const lower = brief.text.toLowerCase();

  // Standard rhythm bed: kick + hat. Always present unless ambient drone.
  if (genre.slug !== 'ambient' || !brief.modifiers?.includes('drone')) {
    layers.push({ id: 'kick', role: 'kick', orbit: orbit++ });
    layers.push({ id: 'hat', role: 'hat', orbit: orbit++ });
  }

  // Snare for genres that use it.
  if (['dnb'].includes(genre.slug)) {
    layers.push({ id: 'snare', role: 'snare', orbit: orbit++ });
  }
  // Percussion for IDM / dub_techno
  if (['idm', 'dub_techno'].includes(genre.slug)) {
    layers.push({ id: 'perc', role: 'percussion', orbit: orbit++ });
  }

  // Bass — almost always.
  if (!(genre.slug === 'ambient' && brief.modifiers?.includes('drone'))) {
    layers.push({ id: 'bass', role: 'bass', orbit: orbit++ });
  }

  // Harmonic layer
  if (genre.slug === 'dub_techno') {
    layers.push({ id: 'chord', role: 'chord', orbit: orbit++, description: 'long-tail dub chord stab' });
  } else if (genre.slug === 'house') {
    layers.push({ id: 'chord', role: 'chord', orbit: orbit++ });
  } else if (genre.slug === 'idm') {
    layers.push({ id: 'lead', role: 'lead', orbit: orbit++ });
  } else if (genre.slug === 'ambient') {
    layers.push({ id: 'pad1', role: 'pad', orbit: orbit++, description: 'primary drone pad' });
    layers.push({ id: 'pad2', role: 'pad', orbit: orbit++, description: 'counter pad' });
  } else if (genre.slug === 'techno') {
    if (brief.modifiers?.includes('peak_time')) {
      layers.push({ id: 'stab', role: 'chord', orbit: orbit++ });
    }
  } else if (genre.slug === 'dnb') {
    layers.push({ id: 'pad', role: 'pad', orbit: orbit++ });
  }

  // Atmosphere/noise for haunted dub_techno or DnB
  if (genre.slug === 'dub_techno' && (lower.includes('rain') || lower.includes('haunted'))) {
    layers.push({ id: 'rain', role: 'noise', orbit: orbit++, description: 'Burial-style noise texture' });
  }
  if (genre.slug === 'dnb' && lower.includes('atmos')) {
    layers.push({ id: 'atmos', role: 'fx', orbit: orbit++ });
  }
  return layers;
}

function buildLayerActivation(layers: LayerGraph[], song: SongGraph): SongGraph['layer_activation'] {
  const map: SongGraph['layer_activation'] = {};
  for (const layer of layers) {
    const sections: Record<string, boolean> = {};
    for (const sec of song.sections) {
      sections[sec.id] = activationFor(layer.role, sec.function, sec.energy);
    }
    map[layer.id] = { sections };
  }
  return map;
}

function activationFor(role: Role, fn: SectionFunction, energy: number): boolean {
  // Rhythmic layers off in pure breakdown for tension.
  if (role === 'kick' && fn === 'breakdown') return false;
  if (role === 'snare' && fn === 'breakdown') return false;
  if (role === 'bass' && fn === 'intro') return energy > 0.45;
  if (role === 'bass' && fn === 'breakdown') return false;
  if (role === 'bass' && fn === 'outro') return energy > 0.4;
  // Pad/chord/atmos always on
  if (['pad', 'noise', 'fx'].includes(role)) return true;
  // Lead/chord on during main + drop
  if (['lead', 'chord'].includes(role)) {
    return ['main', 'drop', 'breakdown', 'verse', 'chorus', 'bridge'].includes(fn);
  }
  // Default: on for main + drop, off for intro/outro/breakdown.
  return ['main', 'drop', 'verse', 'chorus', 'build'].includes(fn);
}

async function buildPatternBank(
  genre: GenreSpec,
  brief: BriefGraph,
  layers: LayerGraph[],
  song: SongGraph,
  rng: () => number,
): Promise<PatternBank> {
  const bpm = brief.bpm ?? 120;
  const patterns: PatternBank['patterns'] = {};
  for (const layer of layers) {
    patterns[layer.id] = {};
    const role = roleToCookbookKey(layer.role);
    let snippets = await loadCookbookSnippets(genre.slug, role);
    if (snippets.length === 0) {
      // fallback: any role under genre
      snippets = await loadCookbookSnippets(genre.slug);
    }
    for (const sec of song.sections) {
      // Only generate a pattern if active in that section.
      const active = song.layer_activation[layer.id]?.sections[sec.id] ?? false;
      if (!active) continue;
      if (snippets.length === 0) {
        // Fallback default for any role with no cookbook snippet.
        patterns[layer.id]![sec.id] = { mini_notation: defaultPatternForRole(layer.role) };
        continue;
      }
      const pick = pickSnippet(snippets, bpm, rng);
      if (pick?.mini_notation) {
        patterns[layer.id]![sec.id] = { mini_notation: pick.mini_notation };
      } else if (pick?.raw) {
        patterns[layer.id]![sec.id] = { raw: pick.raw };
      } else {
        patterns[layer.id]![sec.id] = { mini_notation: defaultPatternForRole(layer.role) };
      }
    }
  }
  return { patterns };
}

function roleToCookbookKey(role: Role): string {
  switch (role) {
    case 'kick': return 'kick';
    case 'snare': return 'snare';
    case 'clap': return 'clap';
    case 'hat': return 'hat';
    case 'percussion': return 'perc';
    case 'rim': return 'perc';
    case 'cymbal': return 'perc';
    case 'bass':
    case 'sub': return 'bass';
    case 'chord': return 'chord';
    case 'pad': return 'pad';
    case 'lead':
    case 'arp':
    case 'pluck': return 'lead';
    case 'noise':
    case 'fx':
    case 'riser':
    case 'impact': return 'fx';
    default: return 'kick';
  }
}

function defaultPatternForRole(role: Role): string {
  switch (role) {
    case 'kick': return 'bd ~ ~ ~ bd ~ ~ ~';
    case 'snare': return '~ ~ sd ~ ~ ~ ~ ~';
    case 'clap': return '~ ~ cp ~';
    case 'hat': return '[~ hh]*4';
    case 'percussion': return 'rim ~ ~ ~';
    case 'bass': return 'a1 ~ ~ ~';
    case 'sub': return 'a1';
    case 'chord': return '<a3 c4 e4>';
    case 'pad': return 'a3';
    case 'lead': return '<a4 c5 e5>';
    case 'noise':
    case 'fx': return '~';
    default: return '~';
  }
}

function buildSoundPalette(genre: GenreSpec, layers: LayerGraph[], brief: BriefGraph): SoundPalette {
  const palette: SoundPalette = { layers: {} };
  const gPalette = (genre.sound_palette ?? {}) as Record<string, string[] | undefined>;
  for (const layer of layers) {
    const key = roleToPaletteKey(layer.role);
    const candidates = gPalette[key] ?? [];
    const source = candidates[0] ?? defaultSourceFromRole(layer.role);
    const kind: 'sample' | 'synth' = isSampleSource(source) ? 'sample' : 'synth';
    palette.layers[layer.id] = {
      source: { kind, name: source, options: {} },
      effects: defaultEffectsForRole(layer.role, brief),
      envelope: defaultEnvelopeForRole(layer.role),
    };
  }
  return palette;
}

function roleToPaletteKey(role: Role): string {
  switch (role) {
    case 'kick': return 'kick';
    case 'snare': return 'snare';
    case 'clap': return 'clap';
    case 'hat': return 'hat';
    case 'rim':
    case 'percussion':
    case 'cymbal': return 'perc';
    case 'bass':
    case 'sub': return 'bass';
    case 'chord': return 'chord';
    case 'pad': return 'pad';
    case 'lead':
    case 'arp':
    case 'pluck': return 'lead';
    case 'noise':
    case 'fx':
    case 'riser':
    case 'impact': return 'fx';
    default: return 'pad';
  }
}

function isSampleSource(name: string): boolean {
  // Two-letter or alphabetic short codes often map to dirt samples.
  if (/^[a-z]+(?::\d+)?$/.test(name)) {
    return !['sine','sawtooth','square','triangle','fm','noise','pluck','voice','one','user'].includes(name);
  }
  return false;
}

function defaultSourceFromRole(role: Role): string {
  return defaultSourceForRoleStr(role);
}

function defaultSourceForRoleStr(role: Role): string {
  switch (role) {
    case 'kick': return 'bd';
    case 'snare': return 'sn';
    case 'clap': return 'cp';
    case 'hat': return 'hh';
    case 'rim': return 'rim';
    case 'cymbal': return 'cy';
    case 'percussion': return 'tom';
    case 'bass': return 'sawtooth';
    case 'sub': return 'sine';
    case 'chord': return 'square';
    case 'pad': return 'fm';
    case 'lead': return 'sawtooth';
    case 'arp': return 'square';
    case 'pluck': return 'pluck';
    case 'noise': return 'noise';
    case 'fx': return 'noise';
    case 'riser': return 'noise';
    case 'impact': return 'kick';
    case 'vocal': return 'voice';
    case 'foley': return 'noise';
    default: return 'sine';
  }
}

function defaultEffectsForRole(role: Role, brief: BriefGraph): Array<{ type: string; params: Record<string, unknown> }> {
  switch (role) {
    case 'bass': return [{ type: 'lpf', params: { freq: 250 } }];
    case 'sub': return [{ type: 'lpf', params: { freq: 80 } }];
    case 'chord': return [{ type: 'lpf', params: { freq: brief.modifiers?.includes('haunted') ? 800 : 1200 } }];
    case 'pad': return [{ type: 'lpf', params: { freq: 1200 } }];
    case 'lead': return [{ type: 'lpf', params: { freq: 2400 } }];
    case 'hat': return [{ type: 'hpf', params: { freq: 6000 } }];
    case 'snare': return [{ type: 'hpf', params: { freq: 200 } }];
    case 'noise':
    case 'fx': return [{ type: 'bpf', params: { freq: 1500 } }];
    default: return [];
  }
}

function defaultEnvelopeForRole(role: Role): { a?: number; d?: number; s?: number; r?: number } | undefined {
  switch (role) {
    case 'kick': return { a: 0.001, d: 0.18, s: 0, r: 0.05 };
    case 'snare': return { a: 0.001, d: 0.1, s: 0, r: 0.05 };
    case 'pad': return { a: 4, s: 1, r: 4 };
    case 'chord': return { a: 0.05, d: 0.3, s: 0.6, r: 0.6 };
    case 'lead': return { a: 0.01, d: 0.2, s: 0.5, r: 0.3 };
    default: return undefined;
  }
}

function buildMixGraph(genre: GenreSpec, layers: LayerGraph[], brief: BriefGraph): MixGraph {
  const orbits: MixGraph['orbits'] = {};
  for (const layer of layers) {
    const o = String(layer.orbit);
    orbits[o] = orbitDefaults(layer.role, brief);
  }
  const sidechain: MixGraph['sidechain'] = [];
  const kick = layers.find((l) => l.role === 'kick');
  if (kick) {
    for (const layer of layers) {
      if (layer.id === kick.id) continue;
      const depth = sidechainDepthForRole(layer.role);
      if (depth > 0) {
        sidechain.push({
          layer: layer.id,
          source: kick.id,
          depth,
          attack_ms: 5,
          release_ms: 150,
        });
      }
    }
  }
  return {
    orbits,
    master: {
      gain: 1,
      lufs_target: genre.mix_targets.lufs,
      true_peak_max: genre.mix_targets.true_peak_max,
    },
    sidechain,
    bus_sends: [],
  };
}

function orbitDefaults(role: Role, brief: BriefGraph): MixGraph['orbits'][string] {
  const haunted = brief.modifiers?.includes('haunted') ?? false;
  switch (role) {
    case 'kick':  return { gain: 1.0, pan: 0, width: 1.0, room_send: 0.05, delay_send: 0 };
    case 'snare': return { gain: 0.85, pan: 0, width: 1.1, room_send: 0.18, delay_send: 0 };
    case 'hat':   return { gain: 0.6, pan: 0.15, width: 1.3, room_send: haunted ? 0.3 : 0.1, delay_send: haunted ? 0.1 : 0 };
    case 'percussion':
    case 'rim':   return { gain: 0.6, pan: -0.1, width: 1.3, room_send: 0.2, delay_send: 0.1 };
    case 'bass':
    case 'sub':   return { gain: 0.9, pan: 0, width: 0.5, room_send: 0.05, delay_send: 0 };
    case 'chord': return { gain: 0.7, pan: -0.1, width: 1.4, room_send: haunted ? 0.55 : 0.3, delay_send: haunted ? 0.4 : 0.1 };
    case 'pad':   return { gain: 0.55, pan: 0.2, width: 1.6, room_send: 0.5, delay_send: 0.3 };
    case 'lead':  return { gain: 0.7, pan: -0.1, width: 1.4, room_send: 0.3, delay_send: 0.4 };
    case 'noise':
    case 'fx':    return { gain: 0.2, pan: 0, width: 1.5, room_send: 0.4, delay_send: 0.2 };
    default:      return { gain: 0.7, pan: 0, width: 1, room_send: 0.1, delay_send: 0 };
  }
}

function sidechainDepthForRole(role: Role): number {
  switch (role) {
    case 'bass':
    case 'sub': return 0.5;
    case 'chord':
    case 'pad': return 0.3;
    default: return 0;
  }
}
