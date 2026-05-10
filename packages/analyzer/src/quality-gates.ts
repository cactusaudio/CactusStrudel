// Quality gates that elevate "valid WAV" to "musically inhabited audio".
// Each gate returns a passed/failed verdict + numeric value + threshold so
// failures cite measurable evidence (per dispatch §2.5 / §7).

import { readWav, mixToMono } from './wav-io.js';
import { computeSectionFeatures, type SectionFeatures } from './section-features.js';
import type { AnalyzerFeatures, SessionGraph } from '@cactus/ir';

export interface QualityGateResult {
  name: string;
  passed: boolean;
  value: number;
  threshold: number;
  severity: number; // 0..1
  notes?: string;
}

export interface QualityGatesReport {
  gates: QualityGateResult[];
  pass_count: number;
  fail_count: number;
  overall_pass: boolean;
  per_section?: SectionFeatures;
}

export interface QualityGatesInput {
  wavPath: string;
  graph: SessionGraph;
  features: AnalyzerFeatures;
  /** Genre-aware thresholds. Provide the loaded GenreSpec where available. */
  genreTargets?: {
    lufs?: number;
    true_peak_max?: number;
    onset_density_high_floor?: number;
    stereo_mono_low_compliance_min?: number;
  };
}

const SILENCE_DB_FLOOR = -55;

export async function runQualityGates(input: QualityGatesInput): Promise<QualityGatesReport> {
  const audio = await readWav(input.wavPath);
  const mono = mixToMono(audio.channels);
  const sectionFeatures = await computeSectionFeatures(input.wavPath, input.graph);

  const gates: QualityGateResult[] = [];
  gates.push(gateNonSilentRatio(mono, audio.sampleRate));
  gates.push(gateActiveBandCount(input.features));
  gates.push(gateLowBandEnergyFloor(input.features, input.genreTargets));
  gates.push(gateOnsetCountFloor(input.features, input.genreTargets, audio.sampleRate, mono.length));
  gates.push(gateSectionEnergyDelta(sectionFeatures, input.graph));
  gates.push(gateFeatureNoveltyPer8Bars(mono, audio.sampleRate, input.graph));
  gates.push(gateArrangementArc(sectionFeatures, input.graph));
  gates.push(gateLoopFatigue(mono, audio.sampleRate, input.graph));
  gates.push(gateStereoLowMonoGuard(input.features, input.genreTargets));
  gates.push(gateTruePeak(input.features, input.genreTargets));
  gates.push(gateLufsTargetDistance(input.features, input.genreTargets));

  const pass_count = gates.filter((g) => g.passed).length;
  const fail_count = gates.length - pass_count;
  const overall_pass = fail_count === 0;
  return { gates, pass_count, fail_count, overall_pass, per_section: sectionFeatures };
}

// ---- gate implementations ----

function gateNonSilentRatio(mono: Float32Array, sr: number): QualityGateResult {
  const win = Math.max(256, Math.floor(sr * 0.05));
  let nonSilent = 0;
  let total = 0;
  for (let i = 0; i + win <= mono.length; i += win) {
    let sumSq = 0;
    for (let j = 0; j < win; j++) sumSq += mono[i + j]! * mono[i + j]!;
    const rms = Math.sqrt(sumSq / win);
    const db = 20 * Math.log10(Math.max(1e-12, rms));
    if (db > SILENCE_DB_FLOOR) nonSilent++;
    total++;
  }
  const ratio = total > 0 ? nonSilent / total : 0;
  const threshold = 0.6;
  return {
    name: 'non_silent_ratio',
    passed: ratio >= threshold,
    value: ratio,
    threshold,
    severity: ratio < threshold ? Math.min(1, (threshold - ratio) * 2) : 0,
    notes: `${(ratio * 100).toFixed(1)}% of windows above ${SILENCE_DB_FLOOR} dB`,
  };
}

function gateActiveBandCount(f: AnalyzerFeatures): QualityGateResult {
  const bands = f.spectral?.band_rms ?? {};
  const threshold_rms = 0.005; // -46 dBFS
  let active = 0;
  for (const v of Object.values(bands)) {
    if (typeof v === 'number' && v > threshold_rms) active++;
  }
  const threshold = 3;
  return {
    name: 'active_band_count',
    passed: active >= threshold,
    value: active,
    threshold,
    severity: active < threshold ? Math.min(1, (threshold - active) / 4) : 0,
    notes: `${active}/7 bands active above -46 dBFS`,
  };
}

function gateLowBandEnergyFloor(f: AnalyzerFeatures, gt?: QualityGatesInput['genreTargets']): QualityGateResult {
  const lowRms = (f.spectral?.band_rms?.low ?? 0) + (f.spectral?.band_rms?.sub ?? 0);
  const threshold = 0.01; // -40 dBFS combined low+sub
  // ambient drone genres can legitimately under-shoot — relax for those.
  const relaxed = (gt && gt.onset_density_high_floor !== undefined && gt.onset_density_high_floor < 1) ? threshold * 0.3 : threshold;
  return {
    name: 'low_band_energy_floor',
    passed: lowRms >= relaxed,
    value: lowRms,
    threshold: relaxed,
    severity: lowRms < relaxed ? Math.min(1, (relaxed - lowRms) / relaxed) : 0,
  };
}

function gateOnsetCountFloor(
  f: AnalyzerFeatures, gt: QualityGatesInput['genreTargets'] | undefined,
  sr: number, len: number,
): QualityGateResult {
  const totalSec = len / sr;
  const totalOnsets = Object.values(f.rhythmic?.onset_density ?? {}).reduce((a, b) => a + b, 0);
  // Genre-aware: ambient/drone allowed near zero; default ≥ 0.5/sec (one event every 2s).
  const threshold = gt?.onset_density_high_floor ?? 0.5;
  return {
    name: 'onset_count_floor',
    passed: totalOnsets >= threshold,
    value: totalOnsets,
    threshold,
    severity: totalOnsets < threshold ? Math.min(1, (threshold - totalOnsets) / Math.max(0.001, threshold)) : 0,
    notes: `total onset density ${totalOnsets.toFixed(2)}/s over ${totalSec.toFixed(1)}s`,
  };
}

function gateSectionEnergyDelta(sf: SectionFeatures, graph?: SessionGraph): QualityGateResult {
  // ADR 0005: skip on sub-12-bar tracks for the same reason as arrangement_arc.
  if (graph && graph.song.total_bars < 12) {
    return { name: 'section_energy_delta', passed: true, value: 0, threshold: 3, severity: 0, notes: `skipped: total_bars=${graph.song.total_bars} < 12` };
  }
  if (sf.sections.length < 2) {
    return { name: 'section_energy_delta', passed: true, value: 0, threshold: 3, severity: 0, notes: 'single-section track' };
  }
  const energies = sf.sections.map((s) => s.energy_db).filter((v) => Number.isFinite(v));
  if (energies.length === 0) {
    return { name: 'section_energy_delta', passed: false, value: 0, threshold: 3, severity: 1, notes: 'all sections silent' };
  }
  const max = Math.max(...energies);
  const min = Math.min(...energies);
  const range = max - min;
  const threshold = 3;
  return {
    name: 'section_energy_delta',
    passed: range >= threshold,
    value: range,
    threshold,
    severity: range < threshold ? Math.min(1, (threshold - range) / threshold) : 0,
    notes: `loudest section ${max.toFixed(1)} dB, quietest ${min.toFixed(1)} dB`,
  };
}

function gateFeatureNoveltyPer8Bars(mono: Float32Array, sr: number, graph: SessionGraph): QualityGateResult {
  const cps = (graph.brief.bpm ?? 120) / 240;
  const eightBarsSec = 8 / cps;
  const windowSamples = Math.floor(eightBarsSec * sr);
  if (windowSamples < 1024 || mono.length < windowSamples * 2) {
    return { name: 'feature_novelty_per_8_bars', passed: true, value: 1, threshold: 0.05, severity: 0, notes: 'track too short for novelty test' };
  }
  // Compute RMS-by-window and its variance.
  const windows: number[] = [];
  for (let i = 0; i + windowSamples <= mono.length; i += windowSamples) {
    let s = 0;
    for (let j = 0; j < windowSamples; j++) s += mono[i + j]! * mono[i + j]!;
    windows.push(Math.sqrt(s / windowSamples));
  }
  if (windows.length < 2) {
    return { name: 'feature_novelty_per_8_bars', passed: true, value: 1, threshold: 0.05, severity: 0 };
  }
  const mean = windows.reduce((a, b) => a + b, 0) / windows.length;
  const variance = windows.reduce((a, b) => a + (b - mean) ** 2, 0) / windows.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0; // coefficient of variation
  const threshold = 0.05;
  return {
    name: 'feature_novelty_per_8_bars',
    passed: cv >= threshold,
    value: cv,
    threshold,
    severity: cv < threshold ? Math.min(1, (threshold - cv) * 10) : 0,
    notes: `CV across ${windows.length} eight-bar windows = ${cv.toFixed(3)}`,
  };
}

function gateArrangementArc(sf: SectionFeatures, graph: SessionGraph): QualityGateResult {
  // ADR 0005: skip on tracks shorter than 12 bars — the metric uses p95
  // windowed RMS, which is biased toward peaky-sparse intros (kick-only) and
  // unreliable when each section is only 1-2 seconds.
  if (graph.song.total_bars < 12) {
    return { name: 'arrangement_arc_score', passed: true, value: 0, threshold: 1, severity: 0, notes: `skipped: total_bars=${graph.song.total_bars} < 12` };
  }
  const sectionByName = new Map(graph.song.sections.map((s) => [s.id, s]));
  let dropSum = 0, dropN = 0;
  let introSum = 0, introN = 0;
  for (const sa of sf.sections) {
    const meta = sectionByName.get(sa.section_id);
    if (!meta) continue;
    if (!Number.isFinite(sa.energy_db)) continue;
    if (meta.function === 'drop' || meta.function === 'main' || meta.function === 'chorus') {
      dropSum += sa.energy_db; dropN++;
    } else if (meta.function === 'intro' || meta.function === 'outro') {
      introSum += sa.energy_db; introN++;
    }
  }
  if (dropN === 0 || introN === 0) {
    return { name: 'arrangement_arc_score', passed: true, value: 0, threshold: 1, severity: 0, notes: 'no drop/intro contrast pair' };
  }
  const dropMean = dropSum / dropN;
  const introMean = introSum / introN;
  const delta = dropMean - introMean;
  const threshold = 1;
  return {
    name: 'arrangement_arc_score',
    passed: delta >= threshold,
    value: delta,
    threshold,
    severity: delta < threshold ? Math.min(1, (threshold - delta) / Math.max(1, threshold * 4)) : 0,
    notes: `drop sections avg ${dropMean.toFixed(1)} dB; intro/outro avg ${introMean.toFixed(1)} dB`,
  };
}

function gateLoopFatigue(mono: Float32Array, sr: number, graph: SessionGraph): QualityGateResult {
  // Compare RMS-shape similarity between consecutive 8-bar windows. If every
  // window has a near-identical RMS envelope, declare loop fatigue.
  const cps = (graph.brief.bpm ?? 120) / 240;
  const winSec = 8 / cps;
  const winSamples = Math.floor(winSec * sr);
  const innerWin = Math.floor(sr * 0.1);
  if (winSamples < innerWin * 4 || mono.length < winSamples * 2) {
    return { name: 'loop_fatigue_score', passed: true, value: 0, threshold: 0.95, severity: 0, notes: 'track too short' };
  }
  // Compute RMS envelope per outer window.
  const envelopes: number[][] = [];
  for (let i = 0; i + winSamples <= mono.length; i += winSamples) {
    const env: number[] = [];
    for (let j = 0; j + innerWin <= winSamples; j += innerWin) {
      let s = 0;
      for (let k = 0; k < innerWin; k++) s += mono[i + j + k]! * mono[i + j + k]!;
      env.push(Math.sqrt(s / innerWin));
    }
    envelopes.push(env);
  }
  if (envelopes.length < 2) {
    return { name: 'loop_fatigue_score', passed: true, value: 0, threshold: 0.95, severity: 0 };
  }
  // Mean cosine similarity between consecutive envelopes.
  let sumSim = 0;
  let pairs = 0;
  for (let i = 1; i < envelopes.length; i++) {
    sumSim += cosineSimilarity(envelopes[i - 1]!, envelopes[i]!);
    pairs++;
  }
  const meanSim = pairs > 0 ? sumSim / pairs : 0;
  const threshold = 0.95; // anything above this = boring loop
  return {
    name: 'loop_fatigue_score',
    passed: meanSim < threshold,
    value: meanSim,
    threshold,
    severity: meanSim >= threshold ? Math.min(1, (meanSim - threshold) * 20) : 0,
    notes: `${envelopes.length} consecutive 8-bar windows; mean cosine similarity ${meanSim.toFixed(3)}`,
  };
}

function gateStereoLowMonoGuard(f: AnalyzerFeatures, gt?: QualityGatesInput['genreTargets']): QualityGateResult {
  const compliance = f.stereo?.mono_low_compliance ?? 1;
  const threshold = gt?.stereo_mono_low_compliance_min ?? 0.85;
  return {
    name: 'stereo_low_mono_guard',
    passed: compliance >= threshold,
    value: compliance,
    threshold,
    severity: compliance < threshold ? Math.min(1, (threshold - compliance) * 4) : 0,
  };
}

function gateTruePeak(f: AnalyzerFeatures, gt?: QualityGatesInput['genreTargets']): QualityGateResult {
  const peak = f.loudness?.true_peak_db ?? -1;
  const ceiling = gt?.true_peak_max ?? -1;
  return {
    name: 'true_peak_guard',
    passed: peak <= ceiling,
    value: peak,
    threshold: ceiling,
    severity: peak > ceiling ? Math.min(1, (peak - ceiling) / 1) : 0,
    notes: `peak ${peak.toFixed(2)} dBTP vs ceiling ${ceiling}`,
  };
}

function gateLufsTargetDistance(f: AnalyzerFeatures, gt?: QualityGatesInput['genreTargets']): QualityGateResult {
  const integrated = f.loudness?.lufs_integrated ?? -30;
  const target = gt?.lufs ?? -10;
  if (!Number.isFinite(integrated)) {
    return { name: 'lufs_target_distance', passed: false, value: -Infinity, threshold: target, severity: 1, notes: 'silent — LUFS undefined' };
  }
  const dist = Math.abs(integrated - target);
  const threshold = 4;
  return {
    name: 'lufs_target_distance',
    passed: dist <= threshold,
    value: dist,
    threshold,
    severity: dist > threshold ? Math.min(1, (dist - threshold) / 8) : 0,
    notes: `integrated ${integrated.toFixed(1)} LUFS vs target ${target} (Δ=${dist.toFixed(1)})`,
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na * nb);
  return denom > 0 ? dot / denom : 0;
}
