// Post-render true-peak guard. Reads a rendered WAV, measures peak, applies
// a hard ceiling of -1 dBTP via uniform gain reduction + soft-clip on the
// remaining overshoot. Writes the corrected WAV back in place (or to a new
// path if requested).

import { promises as fs } from 'node:fs';
import wavefilePkg from 'wavefile';
import { readWav } from '@cactus/analyzer';

const { WaveFile } = wavefilePkg;

export interface PeakGuardInput {
  inputWavPath: string;
  outputWavPath?: string;
  /** Ceiling in dBTP. Default -1. */
  ceilingDb?: number;
}

export interface PeakGuardResult {
  applied_gain_db: number;
  pre_peak_db: number;
  post_peak_db: number;
  soft_clipped: boolean;
}

export async function guardTruePeak(input: PeakGuardInput): Promise<PeakGuardResult> {
  const decoded = await readWav(input.inputWavPath);
  const ceilingDb = input.ceilingDb ?? -1;
  const ceilingLin = Math.pow(10, ceilingDb / 20);

  let pre = 0;
  for (const ch of decoded.channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i] ?? 0);
      if (a > pre) pre = a;
    }
  }
  const preDb = 20 * Math.log10(Math.max(1e-12, pre));

  // Strategy: if pre_peak ≤ ceiling, no-op.
  // Else uniform gain reduction so the peak lands at ceiling, then soft-clip
  // anything that still exceeds (none should, but cheap insurance).
  let appliedGainDb = 0;
  let softClipped = false;
  if (pre > ceilingLin) {
    const factor = ceilingLin / pre;
    appliedGainDb = 20 * Math.log10(factor);
    for (const ch of decoded.channels) {
      for (let i = 0; i < ch.length; i++) {
        ch[i] = (ch[i] ?? 0) * factor;
        const v = ch[i]!;
        if (Math.abs(v) > ceilingLin) {
          // Soft-clip via tanh shaper, very low overdrive.
          const sign = v < 0 ? -1 : 1;
          const x = (Math.abs(v) - ceilingLin) / (ceilingLin * 0.1);
          ch[i] = sign * (ceilingLin + (ceilingLin * 0.05) * Math.tanh(x));
          softClipped = true;
        }
      }
    }
  }

  let post = 0;
  for (const ch of decoded.channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i] ?? 0);
      if (a > post) post = a;
    }
  }
  const postDb = 20 * Math.log10(Math.max(1e-12, post));

  const out = new WaveFile();
  out.fromScratch(decoded.channels.length, decoded.sampleRate, '32f', decoded.channels.map((c) => Array.from(c)) as unknown as number[][]);
  await fs.writeFile(input.outputWavPath ?? input.inputWavPath, out.toBuffer());

  return { applied_gain_db: appliedGainDb, pre_peak_db: preDb, post_peak_db: postDb, soft_clipped: softClipped };
}
