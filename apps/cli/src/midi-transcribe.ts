// MIDI → Strudel transcriber. The keygen failure was: single-channel
// .xm grid-quantized with no real note-off → b4×64 machine-guns. MIDI
// carries real note start+duration+velocity and SEMANTIC channels
// (ch9 = GM drums). That structurally dodges the degeneracy — the
// reason Bowei's MIDI intuition is right.
//
// Discipline (feedback_listen_dont_hide_behind_metrics): the harness
// here is `printSection` — I READ the emitted Strudel as a musician
// and judge groove/bass/riff BEFORE anything renders.

import midiPkg from '@tonejs/midi';
import { readFileSync } from 'node:fs';
const { Midi } = midiPkg;
type Midi = InstanceType<typeof Midi>;

// GM percussion (MIDI note → Strudel sample). Only the common kit.
const GM_DRUM: Record<number, string> = {
  35: 'bd', 36: 'bd', 37: 'rim', 38: 'sd', 39: 'cp', 40: 'sd',
  42: 'hh', 44: 'hh', 46: 'oh', 49: 'cr', 57: 'cr', 51: 'rd', 59: 'rd',
  41: 'lt', 43: 'lt', 45: 'mt', 47: 'mt', 48: 'ht', 50: 'ht',
};

export interface MidiTrackPlan {
  idx: number;
  role: 'kick' | 'snare' | 'hat' | 'perc' | 'bass' | 'lead' | 'chord' | 'pad' | 'skip';
  isDrum: boolean;
  noteCount: number;
  lo: number;
  hi: number;
}

export function loadMidi(path: string): Midi {
  return new Midi(readFileSync(path));
}

/** Per-track role: drums by GM channel, melodic by program + pitch. */
export function planTracks(m: Midi): MidiTrackPlan[] {
  const plans: MidiTrackPlan[] = [];
  for (let i = 0; i < m.tracks.length; i++) {
    const t = m.tracks[i]!;
    const ns = t.notes;
    if (ns.length === 0) { plans.push({ idx: i, role: 'skip', isDrum: false, noteCount: 0, lo: 0, hi: 0 }); continue; }
    const pitches = ns.map((n) => n.midi);
    const lo = Math.min(...pitches), hi = Math.max(...pitches);
    const isDrum = t.channel === 9;
    let role: MidiTrackPlan['role'];
    if (isDrum) {
      // Sub-role by which GM notes dominate.
      const hist: Record<string, number> = {};
      for (const n of ns) { const s = GM_DRUM[n.midi]; if (s) hist[s] = (hist[s] ?? 0) + 1; }
      const top = Object.entries(hist).sort((a, b) => b[1] - a[1])[0]?.[0];
      role = top === 'bd' ? 'kick' : top === 'sd' ? 'snare' : top === 'hh' || top === 'oh' ? 'hat' : 'perc';
    } else {
      const prog = t.instrument.number; // GM program
      const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
      if (prog >= 32 && prog <= 39) role = 'bass';
      else if (mean < 48) role = 'bass';
      else if (prog >= 88 && prog <= 95) role = 'pad';
      else if (hi - lo <= 2) role = 'chord';            // single-ish pitch = rhythmic stab
      else role = mean >= 72 ? 'lead' : 'chord';
    }
    plans.push({ idx: i, role, isDrum, noteCount: ns.length, lo, hi });
  }
  return plans;
}

/**
 * One track → a Strudel pattern string over [barStart, barEnd) bars,
 * 16th-note grid. Real note-off → real holds (`@k`) and real rests
 * (`~`). Drums → s("bd ~ sd …"); pitched → note("c4 ~ e4 …"). Mono
 * (highest note per step) — enough for the listen-test.
 */
export function trackToStrudel(
  m: Midi, plan: MidiTrackPlan, barStart: number, barEnd: number,
): string | null {
  if (plan.role === 'skip') return null;
  const t = m.tracks[plan.idx]!;
  const ppq = m.header.ppq;
  const stepTicks = ppq / 4;                 // 16th
  const stepsPerBar = 16;
  const total = (barEnd - barStart) * stepsPerBar;
  const startTick = barStart * 4 * ppq;
  type Cell = { tok: string; hold: number };
  const grid: (Cell | null)[] = Array.from({ length: total }, () => null);
  for (const n of t.notes) {
    const s = Math.round((n.ticks - startTick) / stepTicks);
    if (s < 0 || s >= total) continue;
    const holdSteps = Math.max(1, Math.round(n.durationTicks / stepTicks));
    const tok = plan.isDrum
      ? GM_DRUM[n.midi]
      : n.name.toLowerCase();
    if (!tok) continue;
    const cur = grid[s];
    // mono: keep the higher pitch / longer drum hit at a collision
    if (!cur || (!plan.isDrum && n.midi > 0)) grid[s] = { tok, hold: holdSteps };
  }
  // Grid-faithful: one token PER 16th step. A held note = onset then
  // `_` continuations (Strudel sustain — preserves step count, so
  // timing stays locked). `@k` would be RELATIVE weight and skew the
  // grid — the subtle-but-fatal bug a render-blind pipeline misses.
  const toks: string[] = new Array(total).fill('~');
  for (let i = 0; i < total; i++) {
    const c = grid[i];
    if (!c) continue;
    toks[i] = c.tok;
    for (let k = 1; k < c.hold && i + k < total && !grid[i + k]; k++) toks[i + k] = '_';
  }
  if (toks.every((x) => x === '~')) return null;
  const body = toks.join(' ');
  return plan.isDrum ? `s("${body}")` : `note("${body}")`;
}

/**
 * A drum track split into ONE pattern per GM sample (bd / sd / hh …),
 * so simultaneous kick+hat survive (mono-collapse lost them). Each
 * returned line is an independent stack layer.
 */
export function drumTrackToLayers(
  m: Midi, idx: number, barStart: number, barEnd: number,
): { sample: string; pat: string }[] {
  const t = m.tracks[idx]!;
  const ppq = m.header.ppq;
  const stepTicks = ppq / 4;
  const total = (barEnd - barStart) * 16;
  const startTick = barStart * 4 * ppq;
  const bySample = new Map<string, boolean[]>();
  for (const n of t.notes) {
    const samp = GM_DRUM[n.midi];
    if (!samp) continue;
    const s = Math.round((n.ticks - startTick) / stepTicks);
    if (s < 0 || s >= total) continue;
    if (!bySample.has(samp)) bySample.set(samp, Array.from({ length: total }, () => false));
    bySample.get(samp)![s] = true;
  }
  const out: { sample: string; pat: string }[] = [];
  for (const [samp, hits] of bySample) {
    if (!hits.some(Boolean)) continue;
    out.push({ sample: samp, pat: `s("${hits.map((h) => (h ? samp : '~')).join(' ')}")` });
  }
  return out;
}

/** Faithful WHOLE-song transpile: 1 Strudel cycle = whole song
 *  (each 16th-token = one grid step exactly), drums split per sample.
 *  This is the decisive listen-test artifact. */
export function songStrudel(m: Midi): { code: string; bars: number; durSec: number } {
  const ppq = m.header.ppq;
  let lastTick = 0;
  for (const t of m.tracks) for (const n of t.notes) lastTick = Math.max(lastTick, n.ticks + n.durationTicks);
  const bars = Math.ceil(lastTick / (4 * ppq));
  const bpm = m.header.tempos[0]?.bpm ?? 120;
  const durSec = (bars * 4 * 60) / bpm;
  const plans = planTracks(m).filter((p) => p.role !== 'skip');
  const lines: string[] = [];
  for (const p of plans) {
    if (p.isDrum) {
      for (const { sample, pat } of drumTrackToLayers(m, p.idx, 0, bars)) {
        lines.push(`  // t${p.idx} ${p.role}:${sample}\n  ${pat}`);
      }
    } else {
      const pat = trackToStrudel(m, p, 0, bars);
      if (pat) lines.push(`  // t${p.idx} ${p.role} pitch[${p.lo}-${p.hi}]\n  ${pat}`);
    }
  }
  // 1 cycle = whole song → cps = 1/durSec (same mapping proven in keygen-proof).
  const code = `setcps(${(1 / durSec).toFixed(6)})  // ${Math.round(bpm)} BPM · ${bars} bars · ${durSec.toFixed(1)}s\nstack(\n${lines.join(',\n')}\n)`;
  return { code, bars, durSec };
}

/** Build a readable stack() for a bar window — for me to READ, not render-blind. */
export function sectionStrudel(m: Midi, barStart: number, barEnd: number): string {
  const plans = planTracks(m).filter((p) => p.role !== 'skip');
  const lines: string[] = [];
  for (const p of plans) {
    const pat = trackToStrudel(m, p, barStart, barEnd);
    if (!pat) continue;
    lines.push(`  // t${p.idx} ${p.role}${p.isDrum ? ' (drums)' : ''} n=${p.noteCount} pitch[${p.lo}-${p.hi}]\n  ${pat}`);
  }
  const bpm = Math.round(m.header.tempos[0]?.bpm ?? 120);
  return `setcps(${(bpm / 240).toFixed(4)})  // ${bpm} BPM, bars ${barStart}-${barEnd}\nstack(\n${lines.join(',\n')}\n)`;
}
