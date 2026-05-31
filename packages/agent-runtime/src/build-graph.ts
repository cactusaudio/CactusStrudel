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
  applyArrangementCoverage,
  type GenreSpec,
} from '@cactus/genres';
import { applyGainStaging, applyBandBalance } from '@cactus/mix';
import { tryMutate } from '@cactus/cookbook';
import { genreHarmony, roleDerivation } from './harmony-spine.js';
import { createRng, hashStringToSeed } from './seed-rng.js';
import {
  selectPrior, getCookbookMode,
  type CookbookTrace, type CookbookTracePick,
} from './cookbook-prior.js';

export interface BuildGraphOptions {
  /** PRNG seed; defaults to hash of brief.text. */
  seed?: number;
  /**
   * G9B: out-param. When supplied, build-graph appends a CookbookTrace
   * describing every cookbook pick. Producer writes this to
   * sessions/<id>/cookbook-trace.json.
   */
  traceOut?: CookbookTrace[];
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
  const layerActivation = buildLayerActivation(layers, song, briefFinal);
  song.layer_activation = layerActivation;

  // Phase 15 fix: arrangement coverage BEFORE pattern bank so any layer the
  // coverage applier activates gets a real pattern (not compile-time silence).
  // Build a temporary graph stub the applier can mutate; the final graph below
  // re-uses the same song + layers references so the activation persists.
  const stub = {
    brief: briefFinal,
    layers,
    song,
  } as unknown as SessionGraph;
  applyArrangementCoverage(stub);

  const cookbookMode = getCookbookMode();
  const tracePicks: CookbookTracePick[] = [];
  const patternBank = await buildPatternBank(
    genre, briefFinal, layers, song, rng,
    cookbookMode, tracePicks,
  );

  if (options.traceOut) {
    options.traceOut.push({
      mode: cookbookMode,
      genre: genre.slug,
      bpm,
      picks: tracePicks,
      ...(cookbookMode === 'minimal' ? { baseline_only: true } : {}),
    });
  }
  const soundPalette = buildSoundPalette(genre, layers, briefFinal);
  const mixGraph = buildMixGraph(genre, layers, briefFinal);

  const graph: SessionGraph = {
    schema_version: SCHEMA_VERSION,
    session_id: uuid(),
    created_at: new Date().toISOString(),
    brief: briefFinal,
    // Shared harmonic spine (schema 1.1.0) derived from the genre's
    // OWN harmonic_palette — the fix for the corpus study's root cause
    // (pitched layers were never in the same key). Additive: optional
    // field, pitched layers reference it via pattern_bank /harmonic.
    harmony: genreHarmony(genre),
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

  // Deterministic mix controller: per-genre layer gain defaults + band-balance
  // HPF defaults to keep low_mid clean. Compile happens downstream.
  applyGainStaging(graph);
  applyBandBalance(graph);

  return graph;
}

function buildSong(genre: GenreSpec, brief: BriefGraph, rng: () => number): SongGraph {
  const targetSec = brief.duration_target_sec ?? 180;
  const cps = (brief.bpm ?? 120) / 240;
  const targetCycles = targetSec * cps;

  // Phase 15 fix: a short brief (≤ 30 s) used to be forced into the genre's
  // full template via a 0.5 scale clamp, producing a 64-bar arrangement that
  // no audit could ever render past intro+build. Switch to a compact
  // intro/main/outro template that fits the requested duration so renders
  // contain real groove, not dead air.
  const sections: Section[] = [];
  let bar = 0;
  if (brief.duration_target_sec !== undefined && targetSec <= 30) {
    const totalCompact = Math.max(4, Math.ceil(targetCycles));
    const introBars = Math.max(1, Math.round(totalCompact * 0.15));
    const outroBars = Math.max(1, Math.round(totalCompact * 0.15));
    const mainBars = Math.max(2, totalCompact - introBars - outroBars);
    const compactTpl: Array<{ name: string; fn: SectionFunction; len: number }> = [
      { name: 'intro', fn: 'intro', len: introBars },
      { name: 'main',  fn: 'main',  len: mainBars },
      { name: 'outro', fn: 'outro', len: outroBars },
    ];
    for (const t of compactTpl) {
      sections.push({
        id: deterministicUuid(rng),
        name: t.name,
        start_bar: bar,
        end_bar: bar + t.len,
        energy: energyForFunction(t.fn, brief.energy ?? 'mid'),
        function: t.fn,
      });
      bar += t.len;
    }
  } else {
    const templateTotal = genre.section_template.reduce((a, s) => a + s.length_bars, 0);
    let scale = templateTotal === 0 ? 1 : Math.max(0.5, targetCycles / templateTotal);
    scale = Math.min(scale, 2.0);
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

function buildLayerActivation(layers: LayerGraph[], song: SongGraph, brief: BriefGraph): SongGraph['layer_activation'] {
  const map: SongGraph['layer_activation'] = {};
  for (const layer of layers) {
    const sections: Record<string, boolean> = {};
    for (const sec of song.sections) {
      sections[sec.id] = activationFor(layer.role, sec.function, sec.energy, brief);
    }
    map[layer.id] = { sections };
  }
  return map;
}

function activationFor(role: Role, fn: SectionFunction, energy: number, brief: BriefGraph): boolean {
  if (role === 'kick' && brief.constraints?.no_four_on_floor === true) return false;
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
  cookbookMode: 'minimal' | 'enabled' | 'enabled_mutating' = 'minimal',
  tracePicks: CookbookTracePick[] = [],
): Promise<PatternBank> {
  const bpm = brief.bpm ?? 120;
  const patterns: PatternBank['patterns'] = {};
  // Spine-bypass set (keygen-transcription contract §1, signed-off
  // 2026-05-17): a (layer,section) cell whose pattern came from a
  // transcribed `imported_public_domain` entry is REAL human music,
  // already harmonically coherent. The step-4 synthetic spine must
  // NOT override it — that would discard the entire keygen value.
  // Key = `${layerId}${secId}`.
  const transcribedCells = new Set<string>();

  // G9B: in enabled / enabled_mutating modes, route through the typed
  // retrieval API + trace. minimal mode preserves the legacy pickSnippet
  // path verbatim so the existing baseline tests stay stable.
  for (const layer of layers) {
    patterns[layer.id] = {};
    const seenIds: string[] = [];

    // Pre-load legacy snippets only once per layer; used for minimal mode + as
    // a final fallback when typed retrieval returns nothing in enabled mode.
    //
    // G9C fix: ROLE-AWARE FALLBACK ONLY. The pre-G9C code widened the lookup
    // to `loadCookbookSnippets(genre.slug)` (no role filter) when the
    // role-specific JSONL was empty. That widening caused dnb's enabled-mode
    // silence regression: dnb has no hat/pad entries, the wide lookup returned
    // kick+snare+bass entries, pickSnippet randomly assigned a kick pattern
    // (`bd ~ ~ ~`) to the pad layer, and the compiler then emitted
    // `note("bd ~ ~ ~").s("fm")` — Strudel cannot parse "bd" as a note name,
    // so the pad rendered as silence across most of the timeline. We now
    // fall through to defaultPatternForRole instead, preserving role
    // semantics. See docs/g9c-dnb-regression-root-cause.md.
    const legacyRole = roleToCookbookKey(layer.role);
    const legacySnippets = await loadCookbookSnippets(genre.slug, legacyRole);

    for (const sec of song.sections) {
      const active = song.layer_activation[layer.id]?.sections[sec.id] ?? false;
      if (!active) continue;

      if (cookbookMode === 'minimal') {
        // Legacy path — unchanged.
        const pick = legacySnippets.length > 0 ? pickSnippet(legacySnippets, bpm, rng) : undefined;
        if (pick?.mini_notation) patterns[layer.id]![sec.id] = enforcePatternConstraints(layer, { mini_notation: pick.mini_notation }, brief, sec);
        else if (pick?.raw) patterns[layer.id]![sec.id] = { raw: pick.raw };
        else patterns[layer.id]![sec.id] = enforcePatternConstraints(layer, { mini_notation: defaultPatternForRole(layer.role) }, brief, sec);
        continue;
      }

      // enabled / enabled_mutating: typed retrieval.
      const result = await selectPrior({
        genre: genre.slug,
        layer,
        section: { id: sec.id, function: sec.function, energy: sec.energy },
        bpm,
        seen_ids: seenIds,
      });
      let trace = result.trace;

      let chosenPattern: { mini_notation?: string; raw?: string } | undefined;
      if (result.entry) {
        let entry = result.entry;
        // enabled_mutating: try density-down for sparse sections, density-up
        // for dense ones. The first applicable operator wins; trace records
        // it. Mutation always validates the result against the schema.
        if (cookbookMode === 'enabled_mutating') {
          const wantsDense = sec.energy >= 0.6 && (sec.function === 'main' || sec.function === 'drop');
          const ops = wantsDense ? ['density_up', 'rest_insert'] as const : ['density_down', 'reverb_up'] as const;
          const mut = tryMutate(entry, [...ops]);
          if (mut) {
            entry = mut.after;
            trace = {
              ...trace,
              mutation_applied: { operator: mut.operator, before: mut.before.id, after: mut.after.id },
            };
          }
        }
        if (entry.mini_notation) chosenPattern = { mini_notation: entry.mini_notation };
        else if (entry.raw) chosenPattern = { raw: entry.raw };
        // Final (post-mutation) source_type: a mutated import is no
        // longer a faithful transcription (tryMutate → 'transformed'),
        // so it correctly does NOT bypass the spine; only an untouched
        // external reference transcription pick does.
        if (entry.source_type === 'external_reference_transcription') {
          transcribedCells.add(`${layer.id} ${sec.id}`);
        }
        seenIds.push(result.entry.id);
      }

      if (!chosenPattern) {
        // G11A iteration-4 fix: when activation policy says minimal_only for
        // this (genre, role), the legacy pickSnippet fallback would BYPASS
        // the policy by picking from the role's full JSONL. dub_techno
        // enabled at seed=2 hit this exact path: policy minimal_only,
        // typed retrieval returned null, legacy pickSnippet picked a
        // dub_techno chord_stab that produced non_silent_ratio=0.315
        // while minimal mode (which doesn't load legacy snippets in
        // enabled-mode-but-policy-disabled territory) used the role
        // default and stayed at nsr=0.655. The policy now covers BOTH the
        // typed path and the legacy fallback: a policy-disabled pick goes
        // straight to defaultPatternForRole.
        const policyDisabled = (trace.fallback_reason ?? '').startsWith('policy-disabled');
        const pick = (!policyDisabled && legacySnippets.length > 0)
          ? pickSnippet(legacySnippets, bpm, rng) : undefined;
        if (pick?.mini_notation) {
          chosenPattern = { mini_notation: pick.mini_notation };
          trace = { ...trace, fallback_reason: trace.fallback_reason ?? 'legacy-pickSnippet' };
        } else if (pick?.raw) {
          chosenPattern = { raw: pick.raw };
          trace = { ...trace, fallback_reason: trace.fallback_reason ?? 'legacy-pickSnippet-raw' };
        } else {
          chosenPattern = { mini_notation: defaultPatternForRole(layer.role) };
          trace = { ...trace, fallback_reason: trace.fallback_reason ?? 'role-default' };
        }
      }

      chosenPattern = enforcePatternConstraints(layer, chosenPattern, brief, sec);
      patterns[layer.id]![sec.id] = chosenPattern;
      // G9C: blame attribution. Record which graph path got which value so
      // an audit can correlate a hard failure back to a specific pick.
      const post = chosenPattern.mini_notation ?? chosenPattern.raw ?? '';
      tracePicks.push({
        ...trace,
        blame: {
          graph_path: `/pattern_bank/patterns/${layer.id}/${sec.id}`,
          pre_value: null,
          post_value: post,
          contributes_to_orbit: layer.orbit,
          suspected_in_hard_failure: false,
        },
      });
    }
  }
  // Harmonic spine post-pass (schema 1.1.0): pitched layers DERIVE
  // from the shared progression. Additive + role-driven — the literal
  // mini_notation/raw stays as a fallback (the compiler prefers
  // /harmonic); drums (roleDerivation → undefined) are untouched. One
  // surgical pass so no pattern-selection logic above is perturbed.
  for (const layer of layers) {
    const deriv = roleDerivation(layer.role);
    if (!deriv) continue;
    const bySec = patterns[layer.id];
    if (!bySec) continue;
    for (const secId of Object.keys(bySec)) {
      // Spine-bypass (contract §1): never override a faithfully
      // transcribed keygen cell with the synthetic spine.
      if (transcribedCells.has(`${layer.id} ${secId}`)) continue;
      bySec[secId] = { ...bySec[secId]!, harmonic: deriv };
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

function enforcePatternConstraints(
  layer: LayerGraph,
  pattern: { mini_notation?: string; raw?: string },
  brief: BriefGraph,
  section: Section,
): { mini_notation?: string; raw?: string } {
  if (layer.role !== 'kick' || !pattern.mini_notation) {
    return pattern;
  }
  if (brief.constraints?.no_four_on_floor !== true && section.energy >= 0.75 && (section.function === 'main' || section.function === 'drop')) {
    const hits = (pattern.mini_notation.match(/\b(?:bd|kick)\b|\b(?:bd|kick)\*\d+/gi) ?? []).length;
    const explicitFastKick = /\b(?:bd|kick)\*(?:[4-9]|[1-9]\d+)/i.test(pattern.mini_notation);
    if (!explicitFastKick && hits < 4) return { mini_notation: 'bd*4' };
  }
  if (brief.constraints?.no_four_on_floor !== true) {
    return pattern;
  }
  const compact = pattern.mini_notation.replace(/\s+/g, ' ').trim().toLowerCase();
  const fourOnFloor =
    compact === 'bd*4' ||
    compact === 'kick*4' ||
    compact === 'bd bd bd bd' ||
    compact === 'kick kick kick kick' ||
    compact === '[bd]*4' ||
    compact === '[kick]*4';
  return fourOnFloor ? { mini_notation: defaultPatternForRole('kick') } : pattern;
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
  const monoLow = brief.constraints?.mono_low === true;
  const lowWidth = monoLow ? 0 : undefined;
  switch (role) {
    case 'kick':  return { gain: 1.0, pan: 0, width: lowWidth ?? 1.0, room_send: 0.05, delay_send: 0 };
    case 'snare': return { gain: 0.85, pan: 0, width: 1.1, room_send: 0.18, delay_send: 0 };
    case 'hat':   return { gain: 0.6, pan: 0.15, width: 1.3, room_send: haunted ? 0.3 : 0.1, delay_send: haunted ? 0.1 : 0 };
    case 'percussion':
    case 'rim':   return { gain: 0.6, pan: -0.1, width: 1.3, room_send: 0.2, delay_send: 0.1 };
    case 'bass':
    case 'sub':   return { gain: 0.9, pan: 0, width: lowWidth ?? 0.5, room_send: 0.05, delay_send: 0 };
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
