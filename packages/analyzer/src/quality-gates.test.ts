import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import wavefilePkg from 'wavefile';
import type { AnalyzerFeatures, SessionGraph } from '@cactus/ir';
import { analyzeWav, runQualityGates } from './index.js';

const { WaveFile } = wavefilePkg;
const TMP = path.join(os.tmpdir(), 'cactus-quality-gates-tests');

function writeWav(name: string, channels: Float32Array[], sr = 48000): string {
  const wav = new WaveFile();
  wav.fromScratch(channels.length, sr, '32f', channels.map((c) => Array.from(c)) as unknown as number[][]);
  const filePath = path.join(TMP, name);
  return fs.writeFile(filePath, wav.toBuffer()).then(() => filePath) as unknown as string;
}

async function writeWavAsync(name: string, channels: Float32Array[], sr = 48000): Promise<string> {
  const wav = new WaveFile();
  wav.fromScratch(channels.length, sr, '32f', channels.map((c) => Array.from(c)) as unknown as number[][]);
  const filePath = path.join(TMP, name);
  await fs.writeFile(filePath, wav.toBuffer());
  return filePath;
}

function tinyGraph(totalBars = 32, bpm = 120): SessionGraph {
  return {
    schema_version: '1.0.0',
    session_id: '00000000-0000-4000-8000-000000000000',
    created_at: '2026-05-10T00:00:00.000Z',
    brief: { text: 'test', bpm, mood: [], references: [], modifiers: [], constraints: {} },
    song: {
      cycles_per_bar: 1,
      total_bars: totalBars,
      sections: [
        { id: 's1', name: 'intro',  start_bar: 0,                end_bar: Math.floor(totalBars * 0.25), energy: 0.3, function: 'intro' },
        { id: 's2', name: 'drop',   start_bar: Math.floor(totalBars * 0.25), end_bar: Math.floor(totalBars * 0.75), energy: 0.85, function: 'drop' },
        { id: 's3', name: 'outro',  start_bar: Math.floor(totalBars * 0.75), end_bar: totalBars,                   energy: 0.3, function: 'outro' },
      ],
      energy_curve: Array.from({ length: totalBars }, () => 0.5),
      layer_activation: {},
    },
    layers: [],
    pattern_bank: { patterns: {} },
    sound_palette: { layers: {} },
    mix_graph: { orbits: {}, master: { gain: 1, lufs_target: -10, true_peak_max: -1 }, sidechain: [], bus_sends: [] },
    render_graph: [],
    critique_graph: [],
    preference_graph: { decisions: [], weights: {
      genre_fit: 0.18, groove: 0.16, arrangement_arc: 0.13, sound_design: 0.1,
      mix_translation: 0.12, memorability_hook: 0.08, originality: 0.06,
      user_taste_fit: 0.05, technical_validity: 0.12,
    }, motif_likes: [], sound_likes: [], arrangement_likes: [] },
    iteration_log: [],
  };
}

beforeAll(async () => {
  await fs.mkdir(TMP, { recursive: true });
});

describe('runQualityGates — silence detection', () => {
  it('flags non_silent_ratio when WAV is silent', async () => {
    const sr = 48000;
    const seconds = 8;
    const wavPath = await writeWavAsync('silence.wav', [new Float32Array(seconds * sr), new Float32Array(seconds * sr)], sr);
    const features: AnalyzerFeatures = { loudness: { lufs_integrated: -Infinity, true_peak_db: -120 } };
    const graph = tinyGraph(8, 120);
    const r = await runQualityGates({ wavPath, graph, features });
    const nsr = r.gates.find((g) => g.name === 'non_silent_ratio');
    expect(nsr?.passed).toBe(false);
    expect(nsr?.severity).toBeGreaterThan(0.5);
  });

  it('passes non_silent_ratio for a continuous sine', async () => {
    const sr = 48000;
    const seconds = 8;
    const ch = new Float32Array(seconds * sr);
    for (let i = 0; i < ch.length; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
    const wavPath = await writeWavAsync('sine.wav', [ch, ch], sr);
    const f = await analyzeWav(wavPath);
    const graph = tinyGraph(8, 120);
    const r = await runQualityGates({ wavPath, graph, features: f });
    expect(r.gates.find((g) => g.name === 'non_silent_ratio')?.passed).toBe(true);
  });
});

describe('runQualityGates — loop fatigue (synthetic)', () => {
  it('flags identical-loop concatenation', async () => {
    // Build a 4-second loop, repeat 8 times → 32 seconds of identical loops.
    const sr = 48000;
    const loopSec = 4;
    const repeats = 8;
    const loop = new Float32Array(loopSec * sr);
    for (let i = 0; i < loop.length; i++) loop[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
    const full = new Float32Array(loop.length * repeats);
    for (let r = 0; r < repeats; r++) full.set(loop, r * loop.length);
    const wavPath = await writeWavAsync('loop-fatigue.wav', [full, full], sr);
    const f = await analyzeWav(wavPath);
    const graph = tinyGraph(64, 120); // 32s @ 0.5cps = 16 cycles, but graph just declares sections.
    const r = await runQualityGates({ wavPath, graph, features: f });
    const lf = r.gates.find((g) => g.name === 'loop_fatigue_score');
    expect(lf?.passed).toBe(false);
    expect(lf?.value).toBeGreaterThan(0.95);
  });

  it('passes loop_fatigue when amplitude envelope evolves', async () => {
    const sr = 48000;
    const seconds = 32;
    const ch = new Float32Array(seconds * sr);
    // Slow amp swell + decay so the RMS-by-window envelope changes shape per outer window.
    for (let i = 0; i < ch.length; i++) {
      const t = i / sr;
      const amp = 0.05 + 0.45 * Math.sin((Math.PI * t) / seconds);
      ch[i] = amp * Math.sin(2 * Math.PI * 440 * t);
    }
    const wavPath = await writeWavAsync('evolving-amp.wav', [ch, ch], sr);
    const f = await analyzeWav(wavPath);
    const graph = tinyGraph(64, 120);
    const r = await runQualityGates({ wavPath, graph, features: f });
    const lf = r.gates.find((g) => g.name === 'loop_fatigue_score');
    expect(lf?.passed, JSON.stringify(lf)).toBe(true);
  });
});

describe('runQualityGates — section_energy_delta', () => {
  it('flags a track with all sections at the same level', async () => {
    const sr = 48000;
    const seconds = 16;
    const ch = new Float32Array(seconds * sr);
    for (let i = 0; i < ch.length; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
    const wavPath = await writeWavAsync('flat.wav', [ch, ch], sr);
    const f = await analyzeWav(wavPath);
    const graph = tinyGraph(16, 120);
    const r = await runQualityGates({ wavPath, graph, features: f });
    const seg = r.gates.find((g) => g.name === 'section_energy_delta');
    expect(seg?.passed).toBe(false);
  });

  it('passes a track with quiet intro / loud drop / quiet outro', async () => {
    // bpm=240 → cps=1 → 1 bar = 1 second; section boundaries align with audio seconds.
    const sr = 48000;
    const seconds = 16;
    const ch = new Float32Array(seconds * sr);
    for (let i = 0; i < ch.length; i++) {
      const t = i / sr;
      let amp = 0.05;
      if (t >= 4 && t < 12) amp = 0.45;
      ch[i] = amp * Math.sin(2 * Math.PI * 440 * t);
    }
    const wavPath = await writeWavAsync('arc.wav', [ch, ch], sr);
    const f = await analyzeWav(wavPath);
    const graph = tinyGraph(16, 240);
    const r = await runQualityGates({ wavPath, graph, features: f });
    const seg = r.gates.find((g) => g.name === 'section_energy_delta');
    expect(seg?.passed, JSON.stringify(seg)).toBe(true);
  });
});

describe('runQualityGates — true peak + LUFS', () => {
  it('flags true peak above ceiling', async () => {
    const sr = 48000;
    const ch = new Float32Array(sr * 2);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(2 * Math.PI * 1000 * i / sr); // amplitude 1.0
    const wavPath = await writeWavAsync('hot.wav', [ch, ch], sr);
    const f = await analyzeWav(wavPath);
    const graph = tinyGraph(8, 120);
    const r = await runQualityGates({
      wavPath, graph, features: f,
      genreTargets: { lufs: -10, true_peak_max: -1 },
    });
    expect(r.gates.find((g) => g.name === 'true_peak_guard')?.passed).toBe(false);
  });

  it('flags LUFS far below target', async () => {
    const sr = 48000;
    const ch = new Float32Array(sr * 4);
    for (let i = 0; i < ch.length; i++) ch[i] = 0.005 * Math.sin(2 * Math.PI * 440 * i / sr); // very quiet
    const wavPath = await writeWavAsync('quiet.wav', [ch, ch], sr);
    const f = await analyzeWav(wavPath);
    const graph = tinyGraph(8, 120);
    const r = await runQualityGates({
      wavPath, graph, features: f,
      genreTargets: { lufs: -8, true_peak_max: -1 },
    });
    expect(r.gates.find((g) => g.name === 'lufs_target_distance')?.passed).toBe(false);
  });
});

describe('runQualityGates — onset count floor', () => {
  it('flags a near-static signal as failing onset_count_floor with strict threshold', async () => {
    const sr = 48000;
    const ch = new Float32Array(sr * 4);
    for (let i = 0; i < ch.length; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr); // smooth tone, no onsets
    const wavPath = await writeWavAsync('no-onsets.wav', [ch, ch], sr);
    const f = await analyzeWav(wavPath);
    const graph = tinyGraph(8, 120);
    // Use a dnb-style threshold: ≥5 onsets/s. Pure sine should not reach this.
    const r = await runQualityGates({
      wavPath, graph, features: f,
      genreTargets: { onset_density_high_floor: 5 },
    });
    expect(r.gates.find((g) => g.name === 'onset_count_floor')?.passed).toBe(false);
  });
});
