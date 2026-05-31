// Per-section diagnostic: takes a rendered WAV + SongGraph and reports for each
// section how silent / band-balanced / onset-heavy it is. Identifies which
// section is responsible when a global gate (e.g. non_silent_ratio) fails.

import { readWav, mixToMono, type DecodedAudio } from './wav-io.js';
import { nonSilentRatio as hysteresisNonSilentRatio } from './silence.js';
import type { SessionGraph } from '@cactus/ir';

export interface SectionDiagnostic {
  section_id: string;
  name: string;
  function: string;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  active_layer_count: number;
  active_layer_ids: string[];
  non_silent_ratio: number;
  rms: number;
  rms_db: number;
  short_term_lufs_proxy: number;
  band_rms: Record<string, number>;
  onset_density: number;
  true_peak_db: number;
}

export interface SectionDiagnosticsReport {
  total_duration_sec: number;
  rendered_sections: SectionDiagnostic[];
  /** Sections defined in the graph but past the rendered audio horizon. */
  unrendered_sections: Array<{ section_id: string; name: string; function: string; start_sec: number; end_sec: number }>;
}

const BAND_EDGES: Array<[string, number, number]> = [
  ['sub', 20, 60],
  ['low', 60, 250],
  ['low_mid', 250, 500],
  ['mid', 500, 2000],
  ['high_mid', 2000, 4000],
  ['high', 4000, 8000],
  ['air', 8000, 20000],
];

export async function computeSectionDiagnostics(
  wavPath: string,
  graph: SessionGraph,
): Promise<SectionDiagnosticsReport> {
  const audio = await readWav(wavPath);
  return computeSectionDiagnosticsFromAudio(audio, graph);
}

export async function computeSectionDiagnosticsFromAudio(
  audio: DecodedAudio,
  graph: SessionGraph,
): Promise<SectionDiagnosticsReport> {
  const mono = mixToMono(audio.channels);
  const totalSec = mono.length / audio.sampleRate;
  const cps = (graph.brief.bpm ?? 120) / 240;
  const barsToSec = (b: number) => (b * graph.song.cycles_per_bar) / cps;

  const rendered: SectionDiagnostic[] = [];
  const unrendered: SectionDiagnosticsReport['unrendered_sections'] = [];
  for (const sec of graph.song.sections) {
    const startReq = barsToSec(sec.start_bar);
    const endReq = barsToSec(sec.end_bar);
    if (startReq >= totalSec) {
      unrendered.push({
        section_id: sec.id, name: sec.name, function: sec.function,
        start_sec: startReq, end_sec: endReq,
      });
      continue;
    }
    const start = Math.min(startReq, totalSec);
    const end = Math.min(endReq, totalSec);
    const sliceL = audio.channels[0]!.subarray(Math.floor(start * audio.sampleRate), Math.floor(end * audio.sampleRate));
    const sliceR = (audio.channels[1] ?? audio.channels[0])!.subarray(Math.floor(start * audio.sampleRate), Math.floor(end * audio.sampleRate));
    const monoSlice = mono.subarray(Math.floor(start * audio.sampleRate), Math.floor(end * audio.sampleRate));

    const activation = graph.song.layer_activation[sec.id] ?? graph.song.layer_activation;
    const activeIds: string[] = [];
    for (const layer of graph.layers) {
      const sectionsMap = graph.song.layer_activation[layer.id]?.sections;
      if (sectionsMap?.[sec.id]) activeIds.push(layer.id);
    }

    rendered.push({
      section_id: sec.id,
      name: sec.name,
      function: sec.function,
      start_sec: start,
      end_sec: end,
      duration_sec: end - start,
      active_layer_count: activeIds.length,
      active_layer_ids: activeIds,
      non_silent_ratio: nonSilentRatio(monoSlice, audio.sampleRate),
      rms: rms(monoSlice),
      rms_db: rmsDb(monoSlice),
      short_term_lufs_proxy: lufsProxy(sliceL, sliceR, audio.sampleRate),
      band_rms: bandRms(monoSlice, audio.sampleRate),
      onset_density: onsetDensity(monoSlice, audio.sampleRate),
      true_peak_db: peakDb(sliceL, sliceR),
    });
    void activation;
  }

  return { total_duration_sec: totalSec, rendered_sections: rendered, unrendered_sections: unrendered };
}

function rms(slice: Float32Array): number {
  if (slice.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < slice.length; i++) s += slice[i]! * slice[i]!;
  return Math.sqrt(s / slice.length);
}

function rmsDb(slice: Float32Array): number {
  return 20 * Math.log10(Math.max(1e-12, rms(slice)));
}

// Gap1 fix: delegate to the shared hysteresis implementation so section
// diagnostics and the global gate agree on what "non-silent" means and
// inherit the same noise-immunity.
function nonSilentRatio(slice: Float32Array, sr: number): number {
  return hysteresisNonSilentRatio(slice, sr);
}

function bandRms(slice: Float32Array, sr: number): Record<string, number> {
  const N = Math.min(2048, slice.length);
  if (N < 64) return Object.fromEntries(BAND_EDGES.map(([n]) => [n, 0]));
  const start = Math.floor((slice.length - N) / 2);
  const re = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
    re[n] = (slice[start + n] ?? 0) * w;
  }
  const half = Math.floor(N / 2);
  const mag = new Float32Array(half);
  for (let k = 0; k < half; k++) {
    let r = 0, i = 0;
    for (let n = 0; n < N; n++) {
      const ang = (-2 * Math.PI * k * n) / N;
      r += re[n]! * Math.cos(ang);
      i += re[n]! * Math.sin(ang);
    }
    mag[k] = Math.sqrt(r * r + i * i);
  }
  const binHz = sr / N;
  const out: Record<string, number> = {};
  for (const [name, lo, hi] of BAND_EDGES) {
    const i0 = Math.max(0, Math.floor(lo / binHz));
    const i1 = Math.min(half, Math.ceil(hi / binHz));
    let sumSq = 0; let n = 0;
    for (let i = i0; i < i1; i++) {
      sumSq += mag[i]! * mag[i]!;
      n++;
    }
    out[name] = n > 0 ? Math.sqrt(sumSq / n) : 0;
  }
  return out;
}

function onsetDensity(slice: Float32Array, sr: number): number {
  if (slice.length < sr * 0.2) return 0;
  const win = Math.max(64, Math.floor(sr * 0.05));
  const env: number[] = [];
  for (let i = 0; i + win <= slice.length; i += win) {
    let s = 0;
    for (let j = 0; j < win; j++) s += slice[i + j]! * slice[i + j]!;
    env.push(Math.sqrt(s / win));
  }
  let onsets = 0;
  for (let k = 1; k < env.length; k++) {
    if (env[k]! > env[k - 1]! * 1.5 && env[k]! > 1e-3) onsets++;
  }
  return onsets / Math.max(1e-6, slice.length / sr);
}

function lufsProxy(L: Float32Array, R: Float32Array, sr: number): number {
  // K-weighting-free short-term loudness proxy: dBFS RMS over 400ms windows,
  // mean of top half. Not BS.1770 — purpose is per-section comparison only.
  const win = Math.max(256, Math.floor(sr * 0.4));
  const vals: number[] = [];
  for (let i = 0; i + win <= L.length; i += Math.max(1, Math.floor(win / 4))) {
    let s = 0;
    for (let j = 0; j < win; j++) {
      const m = ((L[i + j] ?? 0) + (R[i + j] ?? 0)) * 0.5;
      s += m * m;
    }
    const r = Math.sqrt(s / win);
    if (r > 1e-6) vals.push(20 * Math.log10(r));
  }
  if (vals.length === 0) return -Infinity;
  vals.sort((a, b) => b - a);
  const top = vals.slice(0, Math.max(1, Math.floor(vals.length / 2)));
  return top.reduce((a, b) => a + b, 0) / top.length;
}

function peakDb(L: Float32Array, R: Float32Array): number {
  let p = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.abs(L[i] ?? 0);
    const b = Math.abs(R[i] ?? 0);
    if (a > p) p = a;
    if (b > p) p = b;
  }
  return 20 * Math.log10(Math.max(1e-12, p));
}
