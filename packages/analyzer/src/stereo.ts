export interface StereoFeatures {
  width_low: number;
  width_mid: number;
  width_high: number;
  mono_low_compliance: number; // 0..1; 1 = perfect mono compatibility in low band
}

const BAND_EDGES = {
  low:  { lo: 20,   hi: 200 },
  mid:  { lo: 200,  hi: 4000 },
  high: { lo: 4000, hi: 16000 },
};

export function computeStereoFeatures(channels: Float32Array[], sampleRate: number): StereoFeatures {
  if (channels.length < 2) {
    // Mono input — perfect mono compliance, zero width.
    return { width_low: 0, width_mid: 0, width_high: 0, mono_low_compliance: 1 };
  }
  const left = channels[0]!;
  const right = channels[1]!;
  const mid = new Float32Array(left.length);
  const side = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    mid[i] = (left[i]! + right[i]!) * 0.5;
    side[i] = (left[i]! - right[i]!) * 0.5;
  }

  const widthLow = bandWidth(mid, side, sampleRate, BAND_EDGES.low.lo, BAND_EDGES.low.hi);
  const widthMid = bandWidth(mid, side, sampleRate, BAND_EDGES.mid.lo, BAND_EDGES.mid.hi);
  const widthHigh = bandWidth(mid, side, sampleRate, BAND_EDGES.high.lo, BAND_EDGES.high.hi);

  // Mono-low compliance: 1 - (low-band side / (low-band mid + epsilon)).
  // Closer to 1 = lows are mono-compatible.
  const monoLowCompliance = Math.max(0, Math.min(1, 1 - widthLow));
  return { width_low: widthLow, width_mid: widthMid, width_high: widthHigh, mono_low_compliance: monoLowCompliance };
}

function bandWidth(mid: Float32Array, side: Float32Array, sr: number, lo: number, hi: number): number {
  const filteredMid = filterBand(mid, sr, lo, hi);
  const filteredSide = filterBand(side, sr, lo, hi);
  let mSq = 0, sSq = 0;
  for (let i = 0; i < filteredMid.length; i++) {
    mSq += filteredMid[i]! ** 2;
    sSq += filteredSide[i]! ** 2;
  }
  const total = mSq + sSq;
  if (total <= 0) return 0;
  return sSq / total;
}

function filterBand(x: Float32Array, sr: number, lo: number, hi: number): Float32Array {
  return lowpass(highpass(x, sr, lo), sr, hi);
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

function highpass(input: Float32Array, sr: number, fc: number): Float32Array {
  const w0 = 2 * Math.PI * fc / sr;
  const Q = 0.7071;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * Q);
  const b0 = (1 + cosw) / 2, b1 = -(1 + cosw), b2 = (1 + cosw) / 2;
  const a0 = 1 + alpha, a1 = -2 * cosw, a2 = 1 - alpha;
  return biquad(input, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

function lowpass(input: Float32Array, sr: number, fc: number): Float32Array {
  const w0 = 2 * Math.PI * fc / sr;
  const Q = 0.7071;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * Q);
  const b0 = (1 - cosw) / 2, b1 = 1 - cosw, b2 = (1 - cosw) / 2;
  const a0 = 1 + alpha, a1 = -2 * cosw, a2 = 1 - alpha;
  return biquad(input, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}
