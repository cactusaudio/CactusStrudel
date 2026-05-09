import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WaveFile } from 'wavefile';
import { analyzeWav, computeLoudness, generateSpectrogram } from './index.js';

const TMP = path.join(os.tmpdir(), 'cactus-analyzer-tests');

function makeSineWav(freq: number, durSec: number, sr = 48000, amp = 0.5, channels = 2): Uint8Array {
  const n = Math.floor(durSec * sr);
  const out: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++) arr[i] = amp * Math.sin(2 * Math.PI * freq * i / sr);
    out.push(arr);
  }
  const wav = new WaveFile();
  wav.fromScratch(channels, sr, '32f', out as unknown as number[][]);
  return wav.toBuffer();
}

function makeImpulseTrainWav(bpm: number, durSec: number, sr = 48000): Uint8Array {
  const n = Math.floor(durSec * sr);
  const left = new Float32Array(n);
  const samplesPerBeat = Math.round(60 / bpm * sr);
  for (let i = 0; i < n; i += samplesPerBeat) {
    // Short percussive burst
    for (let j = 0; j < 64 && i + j < n; j++) {
      left[i + j] = (1 - j / 64) * 0.7 * Math.sin(2 * Math.PI * 60 * j / sr);
    }
  }
  const wav = new WaveFile();
  wav.fromScratch(1, sr, '32f', [Array.from(left)] as unknown as number[][]);
  return wav.toBuffer();
}

beforeAll(async () => {
  await fs.mkdir(TMP, { recursive: true });
});

describe('LUFS', () => {
  it('a -20 dBFS sine reads near -23 LUFS integrated (with K-weighting boost)', async () => {
    const sr = 48000;
    const sine = new Float32Array(sr * 5);
    for (let i = 0; i < sine.length; i++) sine[i] = 0.1 * Math.sin(2 * Math.PI * 1000 * i / sr); // -20 dBFS @ 1kHz
    const r = computeLoudness({ channels: [sine, sine], sampleRate: sr });
    // K-weighted 1 kHz sine ≈ unity gain. -20 dBFS sine RMS ≈ -23 dBFS → LUFS ≈ -23.
    expect(r.integratedLufs).toBeGreaterThan(-26);
    expect(r.integratedLufs).toBeLessThan(-20);
  });

  it('silence reads as -Infinity LUFS', () => {
    const sr = 48000;
    const ch = new Float32Array(sr * 2);
    const r = computeLoudness({ channels: [ch, ch], sampleRate: sr });
    expect(r.integratedLufs).toBe(-Infinity);
  });

  it('true peak rises with amplitude', () => {
    const sr = 48000;
    const a = new Float32Array(sr);
    const b = new Float32Array(sr);
    for (let i = 0; i < sr; i++) {
      a[i] = 0.1 * Math.sin(2 * Math.PI * 1000 * i / sr);
      b[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr);
    }
    const ra = computeLoudness({ channels: [a, a], sampleRate: sr });
    const rb = computeLoudness({ channels: [b, b], sampleRate: sr });
    expect(rb.truePeakDb).toBeGreaterThan(ra.truePeakDb);
  });
});

describe('analyzeWav', () => {
  it('returns spectral features for a 1 kHz sine', async () => {
    const file = path.join(TMP, 'sine.wav');
    await fs.writeFile(file, makeSineWav(1000, 3));
    const f = await analyzeWav(file);
    expect(f.spectral?.centroid).toBeDefined();
    // For a 1 kHz sine, centroid should be near 1000 Hz.
    expect(f.spectral!.centroid).toBeGreaterThan(700);
    expect(f.spectral!.centroid).toBeLessThan(1500);
  }, 30_000);

  it('returns rhythmic features for an impulse train', async () => {
    const file = path.join(TMP, 'impulse120.wav');
    await fs.writeFile(file, makeImpulseTrainWav(120, 6));
    const f = await analyzeWav(file);
    expect(f.rhythmic?.bpm).toBeDefined();
    // Allow some tolerance — RhythmExtractor often picks half/double tempo.
    const bpm = f.rhythmic!.bpm!;
    const halfDoubleOk =
      Math.abs(bpm - 120) < 10 ||
      Math.abs(bpm - 60) < 10 ||
      Math.abs(bpm - 240) < 10;
    expect(halfDoubleOk, `bpm=${bpm}`).toBe(true);
  }, 60_000);

  it('returns LUFS within reasonable range for a -20 dBFS signal', async () => {
    const file = path.join(TMP, 'lufs-target.wav');
    await fs.writeFile(file, makeSineWav(1000, 5, 48000, 0.1));
    const f = await analyzeWav(file);
    expect(f.loudness?.lufs_integrated).toBeGreaterThan(-30);
    expect(f.loudness?.lufs_integrated).toBeLessThan(-15);
  }, 30_000);

  it('reports band_rms across bands', async () => {
    const file = path.join(TMP, 'sine-100.wav');
    await fs.writeFile(file, makeSineWav(100, 3));
    const f = await analyzeWav(file);
    expect(f.spectral?.band_rms?.low).toBeGreaterThan(0);
    // 100 Hz should put energy in low band, near-zero in high.
    expect(f.spectral!.band_rms!.low).toBeGreaterThan(f.spectral!.band_rms!.air ?? 0);
  }, 30_000);
});

describe.runIf(process.env.CACTUS_FFMPEG_AVAILABLE !== '0')('spectrogram', () => {
  it('writes a spectrogram PNG', async () => {
    const wav = path.join(TMP, 'spec-source.wav');
    await fs.writeFile(wav, makeSineWav(440, 2));
    const png = path.join(TMP, 'spec.png');
    const out = await generateSpectrogram(wav, { outputPath: png, mode: 'fullband' });
    expect(out).toBe(png);
    const stat = await fs.stat(png);
    expect(stat.size).toBeGreaterThan(1000);
  }, 30_000);
});
