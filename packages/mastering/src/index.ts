import { promises as fs } from 'node:fs';
import { computeLoudness, readWav } from '@cactus/analyzer';
import wavefilePkg from 'wavefile';
const { WaveFile } = wavefilePkg;

export interface MasteringTargets {
  lufs: number;
  true_peak_max: number;
}

export interface MasteringInput {
  inputWavPath: string;
  outputWavPath: string;
  targets: MasteringTargets;
  /** If true, also write a -features.json next to the output. */
  writeFeatures?: boolean;
}

export interface MasteringResult {
  appliedGainDb: number;
  preLoudness: { lufs: number; truePeakDb: number };
  postLoudness: { lufs: number; truePeakDb: number };
  truePeakLimited: boolean;
}

/**
 * Two-stage master:
 * 1. Linear gain to bring integrated LUFS to target.
 * 2. Continuous tanh soft true-peak limiter over the top 10%.
 *    Adequate for a producer-tool baseline, not lookahead-grade transparency.
 */
export async function masterTrack(input: MasteringInput): Promise<MasteringResult> {
  const audio = await readWav(input.inputWavPath);
  const pre = computeLoudness({ channels: audio.channels, sampleRate: audio.sampleRate });

  let gainDb = input.targets.lufs - pre.integratedLufs;
  if (!Number.isFinite(gainDb)) gainDb = 0;
  const gainLin = Math.pow(10, gainDb / 20);

  const channels = audio.channels.map((ch) => {
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) out[i] = (ch[i] ?? 0) * gainLin;
    return out;
  });

  const ceilingLin = Math.pow(10, input.targets.true_peak_max / 20);
  let limited = false;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i]!;
      const abs = Math.abs(v);
      if (abs > ceilingLin * 0.9) {
        if (abs > ceilingLin) limited = true;
        ch[i] = softLimitSample(v, ceilingLin);
      }
    }
  }

  let post = computeLoudness({ channels, sampleRate: audio.sampleRate });
  if (post.truePeakDb > input.targets.true_peak_max) {
    limited = true;
    const trimDb = input.targets.true_peak_max - post.truePeakDb - 0.1;
    const trimLin = Math.pow(10, trimDb / 20);
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) ch[i] = (ch[i] ?? 0) * trimLin;
    }
    post = computeLoudness({ channels, sampleRate: audio.sampleRate });
  }

  const wav = new WaveFile();
  wav.fromScratch(
    channels.length,
    audio.sampleRate,
    '32f',
    channels as unknown as number[][],
  );
  await fs.writeFile(input.outputWavPath, wav.toBuffer());

  if (input.writeFeatures) {
    const fpath = input.outputWavPath.replace(/\.wav$/, '.features.json');
    await fs.writeFile(
      fpath,
      JSON.stringify({ pre, post, applied_gain_db: gainDb, true_peak_limited: limited }, null, 2),
    );
  }

  return {
    appliedGainDb: gainDb,
    preLoudness: { lufs: pre.integratedLufs, truePeakDb: pre.truePeakDb },
    postLoudness: { lufs: post.integratedLufs, truePeakDb: post.truePeakDb },
    truePeakLimited: limited,
  };
}

function softLimitSample(v: number, ceilingLin: number): number {
  const abs = Math.abs(v);
  const sign = v < 0 ? -1 : 1;
  const knee = ceilingLin * 0.9;
  if (abs <= knee) return v;
  const span = Math.max(1e-12, ceilingLin - knee);
  const softened = knee + span * Math.tanh((abs - knee) / span);
  return sign * Math.min(ceilingLin - 1e-9, softened);
}

export function _softLimitSampleForTests(v: number, ceilingLin: number): number {
  return softLimitSample(v, ceilingLin);
}

export async function listBundleFiles(sessionDir: string): Promise<{ manifest: string; files: string[] }> {
  const entries = await fs.readdir(sessionDir);
  const files = entries.map((n) => `${sessionDir}/${n}`);
  const manifest = entries.sort().join('\n');
  return { manifest, files };
}

export { renderStemsByOrbit, type StemRenderInput, type StemRenderResult } from './stems.js';
