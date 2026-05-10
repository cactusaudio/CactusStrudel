// Section-aware audio analysis. Slices a rendered WAV by SongGraph section
// boundaries (using brief.bpm to map bars → seconds) and computes per-section
// rms, lufs proxy, onset count, and spectral centroid.

import { readWav, mixToMono } from './wav-io.js';
import type { SessionGraph } from '@cactus/ir';

export interface SectionAnalysis {
  section_id: string;
  name: string;
  start_sec: number;
  end_sec: number;
  rms: number;
  rms_db: number;
  /** L-K-style energy proxy (peak-aware short-term average), in dBFS units. */
  energy_db: number;
  centroid: number;
  zero_crossings_per_sec: number;
  /** Count of onset-like transients per second (peak above 1.5× local-mean RMS). */
  onset_rate: number;
}

export interface SectionFeatures {
  total_duration_sec: number;
  sample_rate: number;
  sections: SectionAnalysis[];
}

export async function computeSectionFeatures(
  wavPath: string,
  graph: SessionGraph,
): Promise<SectionFeatures> {
  const audio = await readWav(wavPath);
  const mono = mixToMono(audio.channels);
  const totalSec = mono.length / audio.sampleRate;
  const cps = (graph.brief.bpm ?? 120) / 240;
  // Map bar index → second using cps. One cycle = 1 bar by default in our compiler.
  const barsToSec = (bars: number) => bars / cps;

  const out: SectionAnalysis[] = [];
  for (const sec of graph.song.sections) {
    const start = barsToSec(sec.start_bar);
    const endRequested = barsToSec(sec.end_bar);
    const start_sec = Math.min(start, totalSec);
    const end_sec = Math.min(endRequested, totalSec);
    if (end_sec <= start_sec) {
      out.push({
        section_id: sec.id,
        name: sec.name,
        start_sec, end_sec,
        rms: 0, rms_db: -Infinity, energy_db: -Infinity,
        centroid: 0, zero_crossings_per_sec: 0, onset_rate: 0,
      });
      continue;
    }
    const i0 = Math.floor(start_sec * audio.sampleRate);
    const i1 = Math.floor(end_sec * audio.sampleRate);
    const slice = mono.subarray(i0, i1);
    out.push(analyzeSlice(slice, audio.sampleRate, sec.id, sec.name, start_sec, end_sec));
  }
  return { total_duration_sec: totalSec, sample_rate: audio.sampleRate, sections: out };
}

function analyzeSlice(slice: Float32Array, sr: number, id: string, name: string, start: number, end: number): SectionAnalysis {
  if (slice.length === 0) {
    return { section_id: id, name, start_sec: start, end_sec: end, rms: 0, rms_db: -Infinity, energy_db: -Infinity, centroid: 0, zero_crossings_per_sec: 0, onset_rate: 0 };
  }
  // RMS
  let sumSq = 0;
  for (let i = 0; i < slice.length; i++) sumSq += slice[i]! * slice[i]!;
  const rms = Math.sqrt(sumSq / slice.length);
  const rmsDb = 20 * Math.log10(Math.max(1e-12, rms));
  // Energy (95th percentile of windowed RMS to capture peaky-but-loud sections).
  const win = Math.max(64, Math.floor(sr * 0.05));
  const windowedRms: number[] = [];
  for (let i = 0; i + win <= slice.length; i += win) {
    let s = 0;
    for (let j = 0; j < win; j++) s += slice[i + j]! * slice[i + j]!;
    windowedRms.push(Math.sqrt(s / win));
  }
  windowedRms.sort((a, b) => a - b);
  const p95 = windowedRms.length > 0 ? windowedRms[Math.floor(0.95 * (windowedRms.length - 1))]! : rms;
  const energyDb = 20 * Math.log10(Math.max(1e-12, p95));
  // Spectral centroid via FFT-free magnitude-weighted bin estimate using DFT on 2048 frame.
  const centroid = estimateCentroid(slice, sr);
  // Zero-crossings.
  let zc = 0;
  for (let i = 1; i < slice.length; i++) {
    if ((slice[i - 1]! >= 0) !== (slice[i]! >= 0)) zc++;
  }
  const zcPerSec = (zc * sr) / slice.length;
  // Onset rate via peak-vs-local-mean heuristic on 50ms windows.
  let onsets = 0;
  for (let k = 1; k < windowedRms.length; k++) {
    const prev = windowedRms[k - 1]!;
    const cur = windowedRms[k]!;
    if (cur > prev * 1.5 && cur > 1e-3) onsets++;
  }
  const onsetRate = onsets / Math.max(1e-6, end - start);
  return { section_id: id, name, start_sec: start, end_sec: end, rms, rms_db: rmsDb, energy_db: energyDb, centroid, zero_crossings_per_sec: zcPerSec, onset_rate: onsetRate };
}

function estimateCentroid(slice: Float32Array, sr: number): number {
  // Rough centroid: take a single 2048-sample DFT on the middle of the slice.
  const N = Math.min(2048, slice.length);
  if (N < 64) return 0;
  const start = Math.floor((slice.length - N) / 2);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  // Hann window
  for (let n = 0; n < N; n++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
    re[n] = (slice[start + n] ?? 0) * w;
  }
  // Naive O(N^2) DFT — fine for analysis at N=2048.
  const half = Math.floor(N / 2);
  let weighted = 0;
  let total = 0;
  const binHz = sr / N;
  for (let k = 1; k < half; k++) {
    let r = 0, i = 0;
    for (let n = 0; n < N; n++) {
      const ang = (-2 * Math.PI * k * n) / N;
      r += re[n]! * Math.cos(ang);
      i += re[n]! * Math.sin(ang);
    }
    const mag = Math.sqrt(r * r + i * i);
    weighted += mag * (k * binHz);
    total += mag;
  }
  return total > 0 ? weighted / total : 0;
}
