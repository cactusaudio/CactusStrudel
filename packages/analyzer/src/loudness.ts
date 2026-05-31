// ITU-R BS.1770-4 integrated LUFS + true-peak measurement.
// Reference: https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-4-201510-I!!PDF-E.pdf

export interface LoudnessResult {
  integratedLufs: number;
  shortTermMaxLufs: number; // 3-second sliding window max
  truePeakDb: number;
}

export interface LoudnessInput {
  channels: Float32Array[];
  sampleRate: number;
}

const BLOCK_DURATION_S = 0.4; // 400 ms gating block
const BLOCK_OVERLAP = 0.75; // 75% overlap
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
const SHORT_TERM_DURATION_S = 3.0;

/**
 * K-weighting biquad filters at 48 kHz. Coefficients from the spec.
 * Pre-stage: shelving filter (+4 dB high-shelf at ~1.5 kHz).
 * Stage 2: 60 Hz high-pass.
 *
 * For sample rates other than 48 kHz, we re-derive coefficients by frequency
 * mapping (impulse-invariance → bilinear). For typical rates (44.1, 48, 96), the
 * 48 kHz reference is close enough for our use; production-grade implementations
 * recompute. We compute live at all rates to avoid inaccuracy.
 */
function biquad(
  input: Float32Array,
  b0: number, b1: number, b2: number,
  a1: number, a2: number,
): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < input.length; n++) {
    const x = Number.isFinite(input[n]!) ? input[n]! : 0;
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[n] = Number.isFinite(y) ? y : 0;
    x2 = x1; x1 = x;
    y2 = y1; y1 = out[n]!;
  }
  return out;
}

// K-weighting at any sample rate. Coefficients derived per BS.1770-4 Annex 1.
// For sample rates other than 48 kHz, use bilinear pre-warping.
function kWeightingFilter(input: Float32Array, sampleRate: number): Float32Array {
  // Stage 1: high-shelf (~+4dB above ~1500Hz)
  // Reference 48k coefficients (Annex 1):
  //   b: [1.53512485958697, -2.69169618940638, 1.19839281085285]
  //   a: [1, -1.69065929318241, 0.73248077421585]
  // For other rates, we recompute via bilinear transform of the analog prototype.
  const stage1 = computeShelfCoeffs(sampleRate);
  // Stage 2: high-pass at ~38 Hz
  // Reference 48k:
  //   b: [1, -2, 1]
  //   a: [1, -1.99004745483398, 0.99007225036621]
  const stage2 = computeHighpassCoeffs(sampleRate);

  let x = biquad(input, stage1.b0, stage1.b1, stage1.b2, stage1.a1, stage1.a2);
  x = biquad(x, stage2.b0, stage2.b1, stage2.b2, stage2.a1, stage2.a2);
  return x;
}

interface BiquadCoeffs {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
}

// High-shelf coefficients per BS.1770-4 (recomputed from analog prototype).
function computeShelfCoeffs(fs: number): BiquadCoeffs {
  if (!Number.isFinite(fs) || fs <= 0) return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  // Analog prototype: f0=1681.974 Hz, gain=+3.999 dB, Q=0.7071.
  const f0 = 1681.974450955533;
  const gainDb = 3.999843853973347;
  const Q = 0.7071752369554196;
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * f0 / fs;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * Q);
  const b0 = A * ((A + 1) + (A - 1) * cosw + 2 * Math.sqrt(A) * alpha);
  const b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
  const b2 = A * ((A + 1) + (A - 1) * cosw - 2 * Math.sqrt(A) * alpha);
  const a0 = (A + 1) - (A - 1) * cosw + 2 * Math.sqrt(A) * alpha;
  const a1 = 2 * ((A - 1) - (A + 1) * cosw);
  const a2 = (A + 1) - (A - 1) * cosw - 2 * Math.sqrt(A) * alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// High-pass coefficients per BS.1770-4 stage 2.
function computeHighpassCoeffs(fs: number): BiquadCoeffs {
  if (!Number.isFinite(fs) || fs <= 0) return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  const f0 = 38.13547087602444;
  const Q = 0.5003270373238773;
  const w0 = 2 * Math.PI * f0 / fs;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * Q);
  const b0 = (1 + cosw) / 2;
  const b1 = -(1 + cosw);
  const b2 = (1 + cosw) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// Channel weights for stereo (L=1, R=1). Surround would weight LFE=0, others=1, surrounds=1.41.
const CHANNEL_WEIGHTS_STEREO = [1, 1];

/**
 * Compute mean-square energy per block, applying channel weights.
 * Returns array of block-level loudness values (LUFS scale: -0.691 + 10*log10(weighted_sum_ms))
 */
function blockLufs(channels: Float32Array[], sampleRate: number, blockDurationS: number, hopFrac: number): number[] {
  const blockLen = Math.floor(blockDurationS * sampleRate);
  const hopLen = Math.floor(blockLen * (1 - hopFrac));
  const length = channels[0]?.length ?? 0;
  const out: number[] = [];
  // Apply K-weighting to each channel
  const filtered = channels.map((ch) => kWeightingFilter(ch, sampleRate));
  const weights = CHANNEL_WEIGHTS_STEREO.slice(0, channels.length);
  // Block iteration
  for (let start = 0; start + blockLen <= length; start += hopLen) {
    let sumWeighted = 0;
    for (let c = 0; c < filtered.length; c++) {
      const ch = filtered[c]!;
      let sumSq = 0;
      for (let i = 0; i < blockLen; i++) {
        const v = ch[start + i] ?? 0;
        sumSq += v * v;
      }
      const ms = sumSq / blockLen;
      sumWeighted += (weights[c] ?? 1) * ms;
    }
    if (sumWeighted <= 0) {
      out.push(-Infinity);
    } else {
      out.push(-0.691 + 10 * Math.log10(sumWeighted));
    }
  }
  return out;
}

function gatedMeanLufs(blockLufsValues: number[]): number {
  // Absolute gate at -70 LUFS
  const aboveAbsolute = blockLufsValues.filter((l) => l > ABSOLUTE_GATE_LUFS && Number.isFinite(l));
  if (aboveAbsolute.length === 0) return -Infinity;
  const meanAfterAbs = lufsMean(aboveAbsolute);
  // Relative gate at meanAfterAbs - 10 LU
  const relativeThresh = meanAfterAbs + RELATIVE_GATE_LU;
  const aboveRelative = aboveAbsolute.filter((l) => l > relativeThresh);
  if (aboveRelative.length === 0) return -Infinity;
  return lufsMean(aboveRelative);
}

function lufsMean(values: number[]): number {
  // LUFS is logarithmic. Mean over LUFS values requires linearization.
  if (values.length === 0) return -Infinity;
  let sumLin = 0;
  for (const v of values) {
    if (Number.isFinite(v)) sumLin += Math.pow(10, (v + 0.691) / 10);
  }
  if (sumLin <= 0) return -Infinity;
  return -0.691 + 10 * Math.log10(sumLin / values.length);
}

function truePeakDb(channels: Float32Array[]): number {
  // Analyzer-grade 4x oversampled peak. This is intentionally not the old
  // linear-interpolation proxy: cubic interpolation at 1/4, 1/2, and 3/4
  // sample offsets is cheap enough for every quality gate and can expose
  // inter-sample overshoots that linear interpolation systematically misses.
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const samplePeak = Math.abs(ch[i] ?? 0);
      if (samplePeak > peak) peak = samplePeak;
      if (i >= ch.length - 1) continue;
      for (let f = 1; f < 4; f++) {
        const v = Math.abs(cubicInterpolate(ch, i, f / 4));
        if (v > peak) peak = v;
      }
    }
  }
  return 20 * Math.log10(Math.max(1e-12, peak));
}

function cubicInterpolate(ch: Float32Array, i: number, t: number): number {
  const y0 = ch[Math.max(0, i - 1)] ?? 0;
  const y1 = ch[i] ?? 0;
  const y2 = ch[Math.min(ch.length - 1, i + 1)] ?? 0;
  const y3 = ch[Math.min(ch.length - 1, i + 2)] ?? 0;
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  return ((a0 * t + a1) * t + a2) * t + y1;
}

export function computeLoudness(input: LoudnessInput): LoudnessResult {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0 || input.channels.length === 0) {
    return { integratedLufs: -Infinity, shortTermMaxLufs: -Infinity, truePeakDb: -240 };
  }
  const blocks = blockLufs(input.channels, input.sampleRate, BLOCK_DURATION_S, BLOCK_OVERLAP);
  const integrated = gatedMeanLufs(blocks);
  // Short-term: 3-second sliding blocks, 75% overlap → max value
  const shortBlocks = blockLufs(input.channels, input.sampleRate, SHORT_TERM_DURATION_S, BLOCK_OVERLAP);
  const shortMax = shortBlocks.length > 0 ? Math.max(...shortBlocks) : -Infinity;
  return {
    integratedLufs: integrated,
    shortTermMaxLufs: shortMax,
    truePeakDb: truePeakDb(input.channels),
  };
}
