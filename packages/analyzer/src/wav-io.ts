import { promises as fs } from 'node:fs';
import wavefilePkg from 'wavefile';
const { WaveFile } = wavefilePkg;

export interface DecodedAudio {
  channels: Float32Array[];
  sampleRate: number;
  durationSec: number;
}

export async function readWav(wavPath: string): Promise<DecodedAudio> {
  const buf = await fs.readFile(wavPath);
  const wav = new WaveFile(buf);
  // Convert to 32-bit float for uniform processing.
  wav.toBitDepth('32f');
  const sampleRate = (wav.fmt as { sampleRate: number }).sampleRate;
  const numChannels = (wav.fmt as { numChannels: number }).numChannels;
  const samples = wav.getSamples(false) as unknown as Float32Array | Float32Array[];
  let channels: Float32Array[];
  if (Array.isArray(samples)) {
    channels = samples;
  } else {
    channels = [samples];
  }
  // Ensure correct channel count.
  if (channels.length !== numChannels) {
    if (numChannels === 1 && Array.isArray(samples) === false) {
      channels = [samples as Float32Array];
    }
  }
  const length = channels[0]?.length ?? 0;
  return {
    channels,
    sampleRate,
    durationSec: length / sampleRate,
  };
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const length = channels[0]!.length;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i] ?? 0;
    out[i] = sum / channels.length;
  }
  return out;
}

export function resample(input: Float32Array, fromSr: number, toSr: number): Float32Array {
  if (fromSr === toSr) return input;
  // Linear interpolation resampling. Acceptable for analysis-grade use.
  const ratio = toSr / fromSr;
  const outLength = Math.round(input.length * ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = input[i0]! * (1 - frac) + input[i1]! * frac;
  }
  return out;
}
