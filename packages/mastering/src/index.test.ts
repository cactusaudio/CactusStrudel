import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import wavefilePkg from 'wavefile';
import { masterTrack } from './index.js';

const { WaveFile } = wavefilePkg;
const TMP = path.join(os.tmpdir(), 'cactus-mastering-tests');

beforeAll(async () => {
  await fs.mkdir(TMP, { recursive: true });
});

function makeSineWav(freq: number, sec: number, amp: number, sr = 48000): Uint8Array {
  const n = Math.floor(sec * sr);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = amp * Math.sin(2 * Math.PI * freq * i / sr);
  const wav = new WaveFile();
  wav.fromScratch(2, sr, '32f', [Array.from(ch), Array.from(ch)] as unknown as number[][]);
  return wav.toBuffer();
}

describe('masterTrack', () => {
  it('boosts a quiet input toward the LUFS target', async () => {
    const input = path.join(TMP, 'quiet.wav');
    const output = path.join(TMP, 'quiet.master.wav');
    await fs.writeFile(input, makeSineWav(1000, 5, 0.05));
    const r = await masterTrack({
      inputWavPath: input,
      outputWavPath: output,
      targets: { lufs: -10, true_peak_max: -1 },
    });
    expect(r.appliedGainDb).toBeGreaterThan(5);
    expect(r.postLoudness.lufs).toBeGreaterThan(r.preLoudness.lufs);
  }, 30_000);

  it('limits true peak when boosting a hot input', async () => {
    const input = path.join(TMP, 'hot.wav');
    const output = path.join(TMP, 'hot.master.wav');
    // Write a near-clip input (-3 dBFS sine)
    await fs.writeFile(input, makeSineWav(1000, 5, 0.7));
    const r = await masterTrack({
      inputWavPath: input,
      outputWavPath: output,
      targets: { lufs: -8, true_peak_max: -1 }, // demand louder
    });
    expect(r.postLoudness.truePeakDb).toBeLessThan(-0.5);
  }, 30_000);
});
