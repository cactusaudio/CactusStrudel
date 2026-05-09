import { getEssentia } from './essentia.js';

export interface SpectralFeatures {
  centroid: number;
  rolloff: number;
  flatness: number;
  flux: number;
  mfcc_mean: number[];
  mfcc_std: number[];
  band_rms: Record<string, number>;
}

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;

export async function computeSpectralFeatures(monoInput: Float32Array, sampleRate: number): Promise<SpectralFeatures> {
  const { essentia } = await getEssentia();
  const frames: Float32Array[] = [];
  for (let i = 0; i + FRAME_SIZE <= monoInput.length; i += HOP_SIZE) {
    frames.push(monoInput.subarray(i, i + FRAME_SIZE));
  }
  if (frames.length === 0) {
    return {
      centroid: 0, rolloff: 0, flatness: 0, flux: 0,
      mfcc_mean: [], mfcc_std: [], band_rms: {},
    };
  }

  const centroids: number[] = [];
  const rolloffs: number[] = [];
  const flatnesses: number[] = [];
  const fluxes: number[] = [];
  const mfccs: number[][] = [];
  const bandRmsAcc: Record<string, number[]> = {
    sub: [], low: [], low_mid: [], mid: [], high_mid: [], high: [], air: [],
  };
  const BAND_EDGES: Array<[string, number, number]> = [
    ['sub',      20,    60],
    ['low',      60,    250],
    ['low_mid',  250,   500],
    ['mid',      500,   2000],
    ['high_mid', 2000,  4000],
    ['high',     4000,  8000],
    ['air',      8000,  20000],
  ];

  let prevSpectrum: Float32Array | null = null;

  for (const frame of frames) {
    const windowedRes = essentia.Windowing(essentia.arrayToVector(frame), false, FRAME_SIZE, 'hann');
    const winVec = windowedRes.frame;
    const spectrumRes = essentia.Spectrum(winVec, FRAME_SIZE);
    const spectrum = vectorToFloat32(spectrumRes.spectrum);

    centroids.push(essentia.Centroid(spectrumRes.spectrum, sampleRate / 2).centroid);
    rolloffs.push(essentia.RollOff(spectrumRes.spectrum, 0.85, sampleRate).rollOff);
    flatnesses.push(essentia.Flatness(spectrumRes.spectrum).flatness);

    if (prevSpectrum) {
      let f = 0;
      const n = Math.min(prevSpectrum.length, spectrum.length);
      for (let i = 0; i < n; i++) {
        const d = spectrum[i]! - prevSpectrum[i]!;
        f += d * d;
      }
      fluxes.push(Math.sqrt(f));
    }
    prevSpectrum = spectrum;

    // MFCC
    try {
      const mfccRes = essentia.MFCC(spectrumRes.spectrum, 11, 16000, 13, FRAME_SIZE / 2 + 1, 'unit_sum', 0, sampleRate, 0);
      const m = vectorToFloat32(mfccRes.mfcc);
      mfccs.push(Array.from(m));
    } catch {
      /* MFCC may fail on very short input */
    }

    // Band RMS via spectrum bins
    const binHz = sampleRate / FRAME_SIZE;
    for (const [name, lo, hi] of BAND_EDGES) {
      const i0 = Math.max(0, Math.floor(lo / binHz));
      const i1 = Math.min(spectrum.length, Math.ceil(hi / binHz));
      let sumSq = 0, n = 0;
      for (let i = i0; i < i1; i++) {
        const v = spectrum[i] ?? 0;
        sumSq += v * v;
        n++;
      }
      const rms = n > 0 ? Math.sqrt(sumSq / n) : 0;
      bandRmsAcc[name]!.push(rms);
    }
  }

  const mfccLen = mfccs[0]?.length ?? 0;
  const mfccMean = new Array(mfccLen).fill(0);
  const mfccStd = new Array(mfccLen).fill(0);
  if (mfccLen > 0) {
    for (const m of mfccs) {
      for (let i = 0; i < mfccLen; i++) mfccMean[i]! += m[i]!;
    }
    for (let i = 0; i < mfccLen; i++) mfccMean[i]! /= mfccs.length;
    for (const m of mfccs) {
      for (let i = 0; i < mfccLen; i++) {
        const d = m[i]! - mfccMean[i]!;
        mfccStd[i]! += d * d;
      }
    }
    for (let i = 0; i < mfccLen; i++) mfccStd[i]! = Math.sqrt(mfccStd[i]! / mfccs.length);
  }

  const bandRms: Record<string, number> = {};
  for (const name of Object.keys(bandRmsAcc)) {
    const arr = bandRmsAcc[name]!;
    bandRms[name] = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }

  return {
    centroid: mean(centroids),
    rolloff: mean(rolloffs),
    flatness: mean(flatnesses),
    flux: mean(fluxes),
    mfcc_mean: mfccMean,
    mfcc_std: mfccStd,
    band_rms: bandRms,
  };
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
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
