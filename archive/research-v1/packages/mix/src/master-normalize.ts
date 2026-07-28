// Post-render LUFS normalization to genre target, with a structural-failure
// guard: if the input LUFS is far from target AND the input is at a brittle
// peak, classify and refuse to "fix" by purely lowering gain — that masks a
// real mix issue. Caller should react by repairing the graph and re-rendering.

import { promises as fs } from 'node:fs';
import wavefilePkg from 'wavefile';
import { readWav, computeLoudness } from '@cactus/analyzer';

const { WaveFile } = wavefilePkg;

export interface MasterNormalizeInput {
  inputWavPath: string;
  outputWavPath?: string;
  targetLufs: number;
  /** Reject the gain-only fix when (a) LUFS is far below target AND (b) true peak is near or over ceiling. */
  refuseStructuralFailure?: boolean;
  /** Limit applied gain to avoid runaway boost. Default ±18 dB. */
  maxGainDb?: number;
}

export interface MasterNormalizeResult {
  applied_gain_db: number;
  pre_lufs: number;
  post_lufs: number;
  pre_true_peak_db: number;
  post_true_peak_db: number;
  refused: boolean;
  refusal_reason?: string;
}

export async function masterNormalize(input: MasterNormalizeInput): Promise<MasterNormalizeResult> {
  const decoded = await readWav(input.inputWavPath);
  const pre = computeLoudness({ channels: decoded.channels, sampleRate: decoded.sampleRate });
  const maxGainDb = input.maxGainDb ?? 18;

  // Structural-failure detection: input is way too quiet (peak/body imbalance)
  // — bumping gain enough to hit the LUFS target would slam true peak well above ceiling.
  // Refuse, leave WAV unchanged, and report.
  let appliedGainDb = input.targetLufs - pre.integratedLufs;
  if (!Number.isFinite(appliedGainDb)) appliedGainDb = 0;

  // Refuse only when the gap is genuinely structural (>12 dB AND projected peak
  // > +4 dBTP — at that point peak guard's soft-clip would distort audibly).
  // Smaller gaps go through; downstream peak guard handles overshoot.
  if (input.refuseStructuralFailure !== false) {
    const projectedPeak = pre.truePeakDb + appliedGainDb;
    if (appliedGainDb > 12 && projectedPeak > 4) {
      const out = input.outputWavPath ?? input.inputWavPath;
      if (out !== input.inputWavPath) {
        await fs.copyFile(input.inputWavPath, out);
      }
      return {
        applied_gain_db: 0,
        pre_lufs: pre.integratedLufs,
        post_lufs: pre.integratedLufs,
        pre_true_peak_db: pre.truePeakDb,
        post_true_peak_db: pre.truePeakDb,
        refused: true,
        refusal_reason: `LUFS gap ${appliedGainDb.toFixed(1)} dB would push peak ${projectedPeak.toFixed(1)} dBTP — fix layer gains/envelopes upstream`,
      };
    }
  }

  appliedGainDb = Math.max(-maxGainDb, Math.min(maxGainDb, appliedGainDb));
  const factor = Math.pow(10, appliedGainDb / 20);
  for (const ch of decoded.channels) {
    for (let i = 0; i < ch.length; i++) ch[i] = (ch[i] ?? 0) * factor;
  }
  const post = computeLoudness({ channels: decoded.channels, sampleRate: decoded.sampleRate });

  const wav = new WaveFile();
  wav.fromScratch(decoded.channels.length, decoded.sampleRate, '32f', decoded.channels.map((c) => Array.from(c)) as unknown as number[][]);
  await fs.writeFile(input.outputWavPath ?? input.inputWavPath, wav.toBuffer());
  return {
    applied_gain_db: appliedGainDb,
    pre_lufs: pre.integratedLufs,
    post_lufs: post.integratedLufs,
    pre_true_peak_db: pre.truePeakDb,
    post_true_peak_db: post.truePeakDb,
    refused: false,
  };
}
