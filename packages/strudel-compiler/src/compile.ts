import type {
  SessionGraph,
  LayerGraph,
  Section,
  PatternEntry,
  SoundDecoration,
  Effect,
  OrbitMix,
  SidechainEdge,
  HarmonyGraph,
  HarmonicDerivation,
} from '@cactus/ir';
import { HarmonicDerivationSchema } from '@cactus/ir';
import { CodeBuilder, quoteJsString } from './code-builder.js';

export interface CompileOptions {
  /** If set, only this orbit gets audio; others muted to silence (gain 0) but still rendered. */
  solo?: number | undefined;
  /** Tag the compiled code with a header banner comment. */
  banner?: string | undefined;
}

export interface CompiledStrudel {
  code: string;
  sourceMap: Array<{ start: number; end: number; graphPath: string }>;
  warnings: string[];
}

const SECTION_PATH = (sectionId: string) => `/song/sections[${sectionId}]`;

export function compileSessionGraph(
  graph: SessionGraph,
  options: CompileOptions = {},
): CompiledStrudel {
  const cb = new CodeBuilder();
  const warnings: string[] = [];

  const cps = bpmToCps(graph.brief.bpm ?? 120);

  if (options.banner) {
    cb.emit(`// ${options.banner}\n`);
  }
  cb.emit(`// session ${graph.session_id}\n`);
  cb.emit(`// brief: ${oneLine(graph.brief.text)}\n`);
  cb.emit(`setcps(${cps})\n`, '/brief/bpm');
  // NOTE (2026-05-17): design §5 proposed a `setDefaultVoicings(...)`
  // preamble to pin the voicing dictionary for determinism. Render
  // evidence FALSIFIED that sign-off item: in @strudel/tonal@1.2.6 any
  // user-code setDefaultVoicings('legacy' OR 'ireal') routes voicing()
  // through voicingRegistry[name] — which has no 'ireal' key and a
  // bare-triad-free 'legacy' dict — so voicing() throws → returns
  // `silence` → 0 haps (every voiced chord went silent; that was the
  // ambient-demo regression). Unpinned, voicing() uses the library's
  // constant internal default (voicings.mjs sets it once at load) and
  // works (-1.5 dB). That internal default is fixed per build, so
  // determinism holds WITHOUT the pin. Therefore: emit no preamble.
  cb.newline();

  const sortedSections = [...graph.song.sections].sort((a, b) => a.start_bar - b.start_bar);

  cb.emit('stack(\n', '/layers');

  const layerExprs = graph.layers.map((layer, i) => {
    const last = i === graph.layers.length - 1;
    return compileLayer(cb, graph, layer, sortedSections, options, warnings, last);
  });

  if (layerExprs.length === 0) {
    cb.emit('  silence\n');
    warnings.push('no layers defined; emitted silence');
  }

  cb.emit(')');

  // Master gain
  if (graph.mix_graph.master.gain !== 1) {
    cb.emit(`.gain(${trim(graph.mix_graph.master.gain)})`, '/mix_graph/master/gain');
  }

  return { code: cb.build().code, sourceMap: cb.build().sourceMap, warnings };
}

function compileLayer(
  cb: CodeBuilder,
  graph: SessionGraph,
  layer: LayerGraph,
  sections: Section[],
  options: CompileOptions,
  warnings: string[],
  isLast: boolean,
): void {
  const layerPath = `/layers/${layer.id}`;
  cb.emit(`  // ${layer.id} (${layer.role}) → orbit ${layer.orbit}\n`);
  cb.emit('  ', layerPath);

  // Build arrange(...) — one [bars, sectionExpr] tuple per section.
  cb.emit('arrange(', layerPath);

  const activation = graph.song.layer_activation[layer.id];
  for (let si = 0; si < sections.length; si++) {
    const section = sections[si]!;
    const bars = section.end_bar - section.start_bar;
    const active = activation?.sections[section.id] ?? false;
    const pattern = graph.pattern_bank.patterns[layer.id]?.[section.id];
    if (si > 0) cb.emit(',');
    cb.emit('\n    ');
    cb.emit(`[${bars}, `);
    if (!active || !pattern) {
      cb.emit('silence', `/song/sections/${section.id}`);
    } else {
      emitPatternForLayer(cb, layer, pattern, graph.sound_palette.layers[layer.id], graph.harmony, warnings, `/pattern_bank/patterns/${layer.id}/${section.id}`);
    }
    cb.emit(']');
  }
  cb.emit('\n  )');

  // Effect chain from sound palette applies globally to the layer.
  const decoration = graph.sound_palette.layers[layer.id];
  if (decoration) {
    emitEffects(cb, decoration.effects, `/sound_palette/layers/${layer.id}/effects`);
  }

  // Mix graph orbit. Skip controls that the sound palette already covers
  // (e.g., if the palette has a delay effect, don't emit orbit-level .delay() again —
  // that would double-call a single-use effect and trip the validator).
  const orbitMix = graph.mix_graph.orbits[String(layer.orbit)];
  if (orbitMix) {
    const palettedTypes = new Set((decoration?.effects ?? []).map((e) => e.type));
    emitOrbitMix(cb, orbitMix, layer.orbit, `/mix_graph/orbits/${layer.orbit}`, palettedTypes);
  } else {
    warnings.push(`layer ${layer.id} (orbit ${layer.orbit}) has no mix_graph entry`);
  }

  // Sidechain: if any edge targets this layer, emit a duck call.
  const incomingDucks = graph.mix_graph.sidechain.filter((e) => e.layer === layer.id);
  for (const edge of incomingDucks) {
    emitDuck(cb, edge, graph, `/mix_graph/sidechain`);
  }

  // .orbit(N) routes to that orbit
  cb.emit(`.orbit(${layer.orbit})`, layerPath);

  // Solo: if option.solo is set and this layer's orbit is not the soloed one, mute.
  if (options.solo !== undefined && options.solo !== layer.orbit) {
    cb.emit('.gain(0)');
  }

  cb.emit(isLast ? '\n' : ',\n');
}

function emitPatternForLayer(
  cb: CodeBuilder,
  layer: LayerGraph,
  pattern: PatternEntry,
  decoration: SoundDecoration | undefined,
  harmony: HarmonyGraph | undefined,
  warnings: string[],
  graphPath: string,
): void {
  // 0) Harmonic spine (schema 1.1.0). HIGHEST precedence: a layer that
  // derives from the shared progression overrides raw/mini/euclid —
  // that derivation IS the point (it's what makes layers share a key).
  // Gated on BOTH /harmony existing AND a valid /harmonic entry, so
  // pre-harmony graphs are byte-identical. pattern.harmonic is typed
  // `unknown` (zod-default annotation), narrow via safeParse — verify,
  // don't assume.
  if (harmony) {
    const parsed = HarmonicDerivationSchema.safeParse(pattern.harmonic);
    if (parsed.success) {
      emitHarmonicSource(cb, layer, parsed.data, harmony, decoration, warnings, graphPath);
      return;
    }
    if (pattern.harmonic !== undefined) {
      warnings.push(`layer ${layer.id}: /harmonic present but invalid; fell back to literal pattern`);
    }
  }

  // 1) raw mode bypasses all source/effects logic — caller takes responsibility.
  if (pattern.raw) {
    cb.emit(pattern.raw, graphPath);
    return;
  }

  // 2) decide source: sample (s) or note+synth (note)
  const kind = decoration?.source.kind ?? 'sample';
  const source = decoration?.source.name ?? defaultSourceForRole(layer.role);

  let mini: string;
  if (pattern.mini_notation) {
    mini = pattern.mini_notation;
  } else if (pattern.notes) {
    mini = pattern.notes;
  } else if (pattern.euclid) {
    mini = `${defaultSourceForRole(layer.role)}(${pattern.euclid[0]}, ${pattern.euclid[1]})`;
  } else {
    mini = '~';
  }

  if (kind === 'sample') {
    cb.emit(`s(${quoteJsString(mini)})`, graphPath);
    if (decoration?.source.options && Object.keys(decoration.source.options).length > 0) {
      const opts = decoration.source.options as Record<string, unknown>;
      if (typeof opts.n === 'number') {
        cb.emit(`.n(${opts.n})`);
      }
    }
  } else if (kind === 'synth' || kind === 'soundfont' || kind === 'csound' || kind === 'gm') {
    // synth/soundfont/csound/gm: treat mini as a note pattern. `gm`
    // (General MIDI soundfont, schema 1.1.0) routes here too — Strudel
    // plays `gm_*` instruments via the same note().s() form.
    cb.emit(`note(${quoteJsString(mini)}).s(${quoteJsString(source)})`, graphPath);
  }
}

// Expand `harmony.progression_rhythm` (mini-notation over the
// progression INDEX space, e.g. "<0 1 2 3>/4") into a chord-symbol
// pattern ("<Am F C G>/4") by substituting each integer token with
// progression[idx]. Deterministic: the `/N` slow-suffix and `@weight`
// digits are NOT indices and are left intact; an out-of-range index is
// modulo-clamped (musical + deterministic) with a warning.
function compileProgressionPattern(
  harmony: HarmonyGraph,
  warnings: string[],
  graphPath: string,
): string {
  const prog = harmony.progression;
  const m = harmony.progression_rhythm.match(/^(.*?)(\/\d+)?$/s);
  const body = m?.[1] ?? harmony.progression_rhythm;
  const slow = m?.[2] ?? '';
  // Replace integer tokens not part of a `@weight` and not mid-number.
  const expanded = body.replace(/(^|[^@\d])(\d+)/g, (_full, pre: string, dig: string) => {
    const i = Number(dig);
    if (i < 0 || i >= prog.length) {
      warnings.push(
        `${graphPath}: progression index ${i} out of range (len ${prog.length}); modulo-clamped`,
      );
    }
    const idx = ((i % prog.length) + prog.length) % prog.length;
    return pre + prog[idx];
  });
  return expanded + slow;
}

// Map a `(harmony, role_derivation)` pair to a deterministic Strudel
// pitch-source expression per design doc §4. Emits ONLY the pitched
// source (chord()/n() + voicing/mode/anchor/add + .s(source)); the
// existing pipeline appends palette effects + orbit mix downstream.
function emitHarmonicSource(
  cb: CodeBuilder,
  layer: LayerGraph,
  h: HarmonicDerivation,
  harmony: HarmonyGraph,
  decoration: SoundDecoration | undefined,
  warnings: string[],
  graphPath: string,
): void {
  const prog = compileProgressionPattern(harmony, warnings, graphPath);
  const src = decoration?.source.name ?? defaultSourceForRole(layer.role);
  const sQ = quoteJsString(src);
  // Octave for arp/degree_line is applied in scale-degree space: one
  // diatonic octave = 7 degrees (design §4 `.add(octShift*7)`).
  // chord_voiced/root carry octave in the anchor note instead.
  const addOct = h.octave_shift !== 0 ? `.add(${h.octave_shift * 7})` : '';

  switch (h.role_derivation) {
    case 'chord_voiced': {
      const anchor = layer.role === 'pad' ? harmony.anchors.pad : harmony.anchors.chord;
      cb.emit(
        `chord(${quoteJsString(prog)}).voicing().anchor(${quoteJsString(anchor)}).s(${sQ})`,
        graphPath,
      );
      return;
    }
    case 'root': {
      cb.emit(
        `chord(${quoteJsString(prog)}).mode("root").anchor(${quoteJsString(harmony.anchors.bass)}).s(${sQ})`,
        graphPath,
      );
      return;
    }
    case 'arp': {
      const degrees = h.degrees ?? '0';
      const struct = h.rhythm ? `.struct(${quoteJsString(h.rhythm)})` : '';
      cb.emit(
        `n(${quoteJsString(degrees)})${struct}.chord(${quoteJsString(prog)}).voicing()${addOct}.s(${sQ})`,
        graphPath,
      );
      return;
    }
    case 'degree_line': {
      const degrees = h.degrees ?? '0';
      cb.emit(
        `n(${quoteJsString(degrees)}).chord(${quoteJsString(prog)}).voicing()${addOct}.s(${sQ})`,
        graphPath,
      );
      return;
    }
  }
}

function emitEffects(cb: CodeBuilder, effects: Effect[], graphPath: string): void {
  for (let i = 0; i < effects.length; i++) {
    const eff = effects[i]!;
    emitEffect(cb, eff, `${graphPath}/${i}`);
  }
}

function emitEffect(cb: CodeBuilder, eff: Effect, graphPath: string): void {
  const params = eff.params as Record<string, unknown>;
  switch (eff.type) {
    case 'lpf':
      cb.emit(`.lpf(${trim(toNumber(params.freq, 800))})`, graphPath);
      if (typeof params.q === 'number') cb.emit(`.lpq(${trim(params.q)})`);
      break;
    case 'hpf':
      cb.emit(`.hpf(${trim(toNumber(params.freq, 80))})`, graphPath);
      break;
    case 'bpf':
      cb.emit(`.bpf(${trim(toNumber(params.freq, 800))})`, graphPath);
      if (typeof params.q === 'number') cb.emit(`.bpq(${trim(params.q)})`);
      break;
    case 'crush':
      cb.emit(`.crush(${trim(toNumber(params.bits, 8))})`, graphPath);
      break;
    case 'distort':
      cb.emit(`.distort(${trim(toNumber(params.amount, 0.5))})`, graphPath);
      break;
    case 'shape':
      cb.emit(`.shape(${trim(toNumber(params.amount, 0.4))})`, graphPath);
      break;
    case 'delay':
      cb.emit(`.delay(${trim(toNumber(params.send, 0.3))})`, graphPath);
      if (typeof params.time === 'number') cb.emit(`.delaytime(${trim(params.time)})`);
      if (typeof params.feedback === 'number') cb.emit(`.delayfeedback(${trim(params.feedback)})`);
      break;
    case 'room':
      cb.emit(`.room(${trim(toNumber(params.amount, 0.4))})`, graphPath);
      if (typeof params.size === 'number') cb.emit(`.roomsize(${trim(params.size)})`);
      break;
    case 'vowel':
      if (typeof params.value === 'string') cb.emit(`.vowel(${quoteJsString(params.value)})`, graphPath);
      break;
    case 'coarse':
      cb.emit(`.coarse(${trim(toNumber(params.amount, 4))})`, graphPath);
      break;
    default:
      // Generic fallback: emit as `.<type>(<value>)` if there's a single numeric param under .value
      if (typeof params.value === 'number') {
        cb.emit(`.${eff.type}(${trim(params.value)})`, graphPath);
      }
  }
}

function emitOrbitMix(
  cb: CodeBuilder,
  mix: OrbitMix,
  _orbit: number,
  graphPath: string,
  skipPaletteTypes: ReadonlySet<string>,
): void {
  if (mix.gain !== 1) cb.emit(`.gain(${trim(mix.gain)})`, `${graphPath}/gain`);
  if (mix.pan !== 0) cb.emit(`.pan(${trim(mix.pan)})`, `${graphPath}/pan`);
  if (mix.room_send > 0 && !skipPaletteTypes.has('room')) {
    cb.emit(`.room(${trim(mix.room_send)})`, `${graphPath}/room_send`);
  }
  if (mix.delay_send > 0 && !skipPaletteTypes.has('delay')) {
    cb.emit(`.delay(${trim(mix.delay_send)})`, `${graphPath}/delay_send`);
  }
}

function emitDuck(cb: CodeBuilder, edge: SidechainEdge, graph: SessionGraph, graphPath: string): void {
  // Find the source layer's orbit
  const srcLayer = graph.layers.find((l) => l.id === edge.source);
  if (!srcLayer) return;
  cb.emit(`.duck(${srcLayer.orbit}).duckdepth(${trim(edge.depth)})`, graphPath);
  if (edge.attack_ms > 0) cb.emit(`.duckattack(${trim(edge.attack_ms / 1000)})`);
}

function defaultSourceForRole(role: string): string {
  switch (role) {
    case 'kick': return 'bd';
    case 'snare': return 'sn';
    case 'clap': return 'cp';
    case 'hat': return 'hh';
    case 'cymbal': return 'cy';
    case 'percussion': return 'tom';
    case 'rim': return 'rim';
    case 'bass': return 'sawtooth';
    case 'sub': return 'sine';
    case 'chord': return 'square';
    case 'pad': return 'triangle';
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

function bpmToCps(bpm: number): number {
  // 4 beats per cycle is Strudel default. cps = bpm / (60 * 4) = bpm / 240.
  return Math.round((bpm / 240) * 1000) / 1000;
}

function trim(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

function toNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number') return v;
  return fallback;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 200);
}
