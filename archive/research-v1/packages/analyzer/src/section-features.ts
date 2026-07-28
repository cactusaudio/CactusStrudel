// Section-aware audio analysis. Slices a rendered WAV by SongGraph section
// boundaries (using brief.bpm to map bars → seconds) and computes per-section
// rms, lufs proxy, onset count, and spectral centroid.

import { readWav, mixToMono, type DecodedAudio } from './wav-io.js';
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
  return computeSectionFeaturesFromAudio(audio, graph);
}

export async function computeSectionFeaturesFromAudio(
  audio: DecodedAudio,
  graph: SessionGraph,
): Promise<SectionFeatures> {
  const mono = mixToMono(audio.channels);
  const totalSec = mono.length / audio.sampleRate;
  const cps = (graph.brief.bpm ?? 120) / 240;
  // Map bar index → second using cps and the graph's explicit cycle density.
  const barsToSec = (bars: number) => (bars * graph.song.cycles_per_bar) / cps;

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
  // Zero-crossings.
  let zc = 0;
  for (let i = 1; i < slice.length; i++) {
    if ((slice[i - 1]! >= 0) !== (slice[i]! >= 0)) zc++;
  }
  const zcPerSec = (zc * sr) / slice.length;
  // Cheap per-section brightness proxy. For a sine wave, zero-crossings/sec
  // is 2× frequency, so this gives a stable centroid-like signal without the
  // former O(N²) DFT hot path. Full spectral centroid remains in spectral.ts.
  const centroid = estimateCentroidFromZeroCrossings(zcPerSec, sr);
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

function estimateCentroidFromZeroCrossings(zeroCrossingsPerSec: number, sr: number): number {
  if (!Number.isFinite(zeroCrossingsPerSec) || zeroCrossingsPerSec <= 0) return 0;
  return Math.min(sr / 2, zeroCrossingsPerSec / 2);
}
