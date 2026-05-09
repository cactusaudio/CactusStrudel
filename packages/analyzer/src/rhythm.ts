import { getEssentia } from './essentia.js';
import { resample } from './wav-io.js';

export interface RhythmFeatures {
  bpm: number;
  bpm_confidence: number;
  onset_density: Record<string, number>; // events per second per band
  grid_regularity: number;               // 0..1 — how grid-aligned onsets are at the bpm
  syncopation_proxy: number;             // 0..1 — fraction of onsets falling off-grid
}

export async function computeRhythmFeatures(monoInput: Float32Array, sampleRate: number): Promise<RhythmFeatures> {
  const { essentia } = await getEssentia();
  // RhythmExtractor2013 requires 44.1 kHz.
  const targetSr = 44100;
  const audio = sampleRate === targetSr ? monoInput : resample(monoInput, sampleRate, targetSr);

  let bpm = 0, confidence = 0;
  let beats: Float32Array = new Float32Array(0);
  try {
    const rRes = essentia.RhythmExtractor2013(essentia.arrayToVector(audio), 208, 'multifeature', 40);
    bpm = rRes.bpm;
    confidence = rRes.confidence;
    beats = vectorToFloat32(rRes.ticks);
  } catch (e) {
    // Fall back: use OnsetRate
    try {
      const oRes = essentia.OnsetRate(essentia.arrayToVector(audio));
      bpm = oRes.onsetRate * 60;
      confidence = 0.3;
    } catch {
      bpm = 0; confidence = 0;
    }
  }

  // Per-band onset density via OnsetDetection on band-filtered signals.
  // Simplification: use single broadband OnsetRate per band by HPF/LPF with biquad.
  const bands = {
    low: filterBand(audio, targetSr, 20, 200),
    mid: filterBand(audio, targetSr, 200, 2000),
    high: filterBand(audio, targetSr, 4000, 16000),
  };
  const onsetDensity: Record<string, number> = {};
  const durationSec = audio.length / targetSr;
  for (const [name, band] of Object.entries(bands)) {
    try {
      const oRes = essentia.OnsetRate(essentia.arrayToVector(band));
      onsetDensity[name] = oRes.onsetRate;
    } catch {
      onsetDensity[name] = 0;
    }
  }

  // Grid regularity + syncopation proxy from beats array.
  let gridRegularity = 0;
  let syncopationProxy = 0;
  if (beats.length >= 2 && bpm > 0) {
    const beatInterval = 60 / bpm;
    const intervals: number[] = [];
    for (let i = 1; i < beats.length; i++) intervals.push(beats[i]! - beats[i - 1]!);
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + (b - meanInterval) ** 2, 0) / intervals.length;
    const stddev = Math.sqrt(variance);
    gridRegularity = Math.max(0, 1 - stddev / Math.max(1e-6, meanInterval));
    // Syncopation proxy: fraction of beat intervals that deviate >10% from quarter-note expected.
    let off = 0;
    for (const iv of intervals) {
      if (Math.abs(iv - beatInterval) > beatInterval * 0.1) off++;
    }
    syncopationProxy = off / Math.max(1, intervals.length);
  }

  return {
    bpm,
    bpm_confidence: confidence,
    onset_density: onsetDensity,
    grid_regularity: gridRegularity,
    syncopation_proxy: syncopationProxy,
  };
}

// 2nd-order Butterworth bandpass via cascaded HPF + LPF biquads.
function filterBand(input: Float32Array, sampleRate: number, lowHz: number, highHz: number): Float32Array {
  let x = highpass(input, sampleRate, lowHz);
  x = lowpass(x, sampleRate, highHz);
  return x;
}

function highpass(input: Float32Array, sampleRate: number, fc: number): Float32Array {
  const w0 = 2 * Math.PI * fc / sampleRate;
  const Q = 0.7071;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * Q);
  const b0 = (1 + cosw) / 2;
  const b1 = -(1 + cosw);
  const b2 = (1 + cosw) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw;
  const a2 = 1 - alpha;
  return biquad(input, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

function lowpass(input: Float32Array, sampleRate: number, fc: number): Float32Array {
  const w0 = 2 * Math.PI * fc / sampleRate;
  const Q = 0.7071;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * Q);
  const b0 = (1 - cosw) / 2;
  const b1 = 1 - cosw;
  const b2 = (1 - cosw) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw;
  const a2 = 1 - alpha;
  return biquad(input, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

function biquad(input: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < input.length; n++) {
    const x = input[n]!;
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[n] = y;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
  }
  return out;
}

function vectorToFloat32(vec: any): Float32Array {
  if (vec instanceof Float32Array) return vec;
  if (vec && typeof vec.size === 'function') {
    const n = vec.size();
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = vec.get(i);
    return out;
  }
  if (Array.isArray(vec)) return Float32Array.from(vec);
  return new Float32Array(0);
}
