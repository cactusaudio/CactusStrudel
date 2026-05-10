// Per-stem (per-orbit) diagnostic. Operates on a directory of stem WAVs
// produced by `mastering/renderStemsByOrbit`, or accepts a pre-built array of
// {orbit, layerIds, wavPath}.

import { readWav, mixToMono } from './wav-io.js';
import type { SessionGraph } from '@cactus/ir';

export interface StemDiagnostic {
  orbit: number;
  layer_ids: string[];
  wav_path: string;
  rms: number;
  rms_db: number;
  peak_db: number;
  active_ratio: number; // fraction of windows above silence floor
  duration_sec: number;
}

export interface StemDiagnosticsReport {
  stems: StemDiagnostic[];
  /** Layers in graph.layers without a corresponding stem (e.g. stem export skipped). */
  missing_orbits: number[];
}

const SILENCE_DB_FLOOR = -55;

export interface StemRef {
  orbit: number;
  layerIds: string[];
  wavPath: string;
}

export async function computeStemDiagnostics(
  stems: StemRef[],
  graph: SessionGraph,
): Promise<StemDiagnosticsReport> {
  const out: StemDiagnostic[] = [];
  const presentOrbits = new Set<number>();
  for (const s of stems) {
    presentOrbits.add(s.orbit);
    const audio = await readWav(s.wavPath);
    const mono = mixToMono(audio.channels);
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < mono.length; i++) {
      sumSq += mono[i]! * mono[i]!;
      const a = Math.abs(mono[i]!);
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, mono.length));
    const rms_db = 20 * Math.log10(Math.max(1e-12, rms));
    const peak_db = 20 * Math.log10(Math.max(1e-12, peak));
    const win = Math.max(256, Math.floor(audio.sampleRate * 0.05));
    let active = 0; let total = 0;
    for (let i = 0; i + win <= mono.length; i += win) {
      let ss = 0;
      for (let j = 0; j < win; j++) ss += mono[i + j]! * mono[i + j]!;
      const r = Math.sqrt(ss / win);
      const db = 20 * Math.log10(Math.max(1e-12, r));
      if (db > SILENCE_DB_FLOOR) active++;
      total++;
    }
    out.push({
      orbit: s.orbit,
      layer_ids: s.layerIds,
      wav_path: s.wavPath,
      rms,
      rms_db,
      peak_db,
      active_ratio: total > 0 ? active / total : 0,
      duration_sec: mono.length / audio.sampleRate,
    });
  }
  const missing = graph.layers
    .map((l) => l.orbit)
    .filter((o) => !presentOrbits.has(o));
  return { stems: out, missing_orbits: Array.from(new Set(missing)) };
}
