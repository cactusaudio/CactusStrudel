// G1 contract: every emitted gate carries a typed severity_tier + confidence.
// These tests exercise each gate via runQualityGates against a synthetic WAV
// and verify the tier matches ADR 0005's mapping.

import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import wavefilePkg from 'wavefile';
import type { SessionGraph } from '@cactus/ir';
import { runQualityGates, analyzeWav } from './index.js';

const { WaveFile } = wavefilePkg;
const TMP = path.join(os.tmpdir(), 'cactus-severity-tier-tests');

beforeAll(async () => { await fs.mkdir(TMP, { recursive: true }); });

async function writeWav(name: string, channels: Float32Array[], sr = 48000): Promise<string> {
  const wav = new WaveFile();
  wav.fromScratch(channels.length, sr, '32f', channels.map((c) => Array.from(c)) as unknown as number[][]);
  const p = path.join(TMP, name);
  await fs.writeFile(p, wav.toBuffer());
  return p;
}

function tinyGraph(totalBars = 32, bpm = 130): SessionGraph {
  return {
    schema_version: '1.0.0',
    session_id: '00000000-0000-4000-8000-000000000000',
    created_at: '2026-05-10T00:00:00.000Z',
    brief: { text: 'test', bpm, mood: [], references: [], modifiers: [], constraints: {} },
    song: {
      cycles_per_bar: 1, total_bars: totalBars,
      sections: [
        { id: 's1', name: 'intro', start_bar: 0, end_bar: Math.floor(totalBars / 4), energy: 0.3, function: 'intro' },
        { id: 's2', name: 'main', start_bar: Math.floor(totalBars / 4), end_bar: 3 * Math.floor(totalBars / 4), energy: 0.8, function: 'main' },
        { id: 's3', name: 'outro', start_bar: 3 * Math.floor(totalBars / 4), end_bar: totalBars, energy: 0.3, function: 'outro' },
      ],
      energy_curve: Array.from({ length: totalBars }, () => 0.5),
      layer_activation: {},
    },
    layers: [], pattern_bank: { patterns: {} }, sound_palette: { layers: {} },
    mix_graph: { orbits: {}, master: { gain: 1, lufs_target: -10, true_peak_max: -1 }, sidechain: [], bus_sends: [] },
    render_graph: [], critique_graph: [],
    preference_graph: { decisions: [], weights: { genre_fit: 0.18, groove: 0.16, arrangement_arc: 0.13, sound_design: 0.1, mix_translation: 0.12, memorability_hook: 0.08, originality: 0.06, user_taste_fit: 0.05, technical_validity: 0.12 }, motif_likes: [], sound_likes: [], arrangement_likes: [] },
    iteration_log: [],
  };
}

describe('severity tier classification (ADR 0005 + G1)', () => {
  it('non_silent_ratio failure is hard_fail; passes carry severity_tier too', async () => {
    const sr = 48000;
    const seconds = 8;
    const wavPath = await writeWav('silent.wav', [new Float32Array(seconds * sr), new Float32Array(seconds * sr)], sr);
    const r = await runQualityGates({ wavPath, graph: tinyGraph(8), features: { loudness: { lufs_integrated: -Infinity, true_peak_db: -120 } } });
    const g = r.gates.find((x) => x.name === 'non_silent_ratio')!;
    expect(g.passed).toBe(false);
    expect(g.severity_tier).toBe('hard_fail');
    expect(r.hard_fail_count).toBeGreaterThan(0);
    expect(r.overall_pass).toBe(false);
  }, 30_000);

  it('arrangement gates emit severity_tier=skipped on sub-12-bar tracks with reason in notes', async () => {
    const sr = 48000;
    const ch = new Float32Array(sr * 4);
    for (let i = 0; i < ch.length; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
    const wavPath = await writeWav('short.wav', [ch, ch], sr);
    const f = await analyzeWav(wavPath);
    const r = await runQualityGates({ wavPath, graph: tinyGraph(8), features: f });
    const arc = r.gates.find((x) => x.name === 'arrangement_arc_score')!;
    const seg = r.gates.find((x) => x.name === 'section_energy_delta')!;
    expect(arc.severity_tier).toBe('skipped');
    expect(arc.notes).toMatch(/skipped/i);
    expect(seg.severity_tier).toBe('skipped');
    expect(r.skipped_count).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('confidence override stamps every gate with the supplied label', async () => {
    const sr = 48000;
    const ch = new Float32Array(sr * 4);
    for (let i = 0; i < ch.length; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
    const wavPath = await writeWav('conf.wav', [ch, ch], sr);
    const f = await analyzeWav(wavPath);
    const r = await runQualityGates({ wavPath, graph: tinyGraph(8), features: f, confidence: 'static_estimate' });
    for (const g of r.gates) expect(g.confidence).toBe('static_estimate');
  }, 30_000);

  it('overall_pass is hard_fail-driven, not pass_count-driven', async () => {
    const sr = 48000;
    const ch = new Float32Array(sr * 4);
    // continuous sine = passes silence + most calibration warnings ought to be skipped
    for (let i = 0; i < ch.length; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
    const wavPath = await writeWav('clean.wav', [ch, ch], sr);
    const f = await analyzeWav(wavPath);
    const r = await runQualityGates({ wavPath, graph: tinyGraph(8), features: f, genreTargets: { lufs: -10, true_peak_max: -1 } });
    // Even if some calibration_warning gates fail, overall_pass remains true unless hard_fail.
    if (r.hard_fail_count === 0) expect(r.overall_pass).toBe(true);
  }, 30_000);

  it('lufs_target_distance > 8 LU graduates from severe to hard_fail', async () => {
    const sr = 48000;
    const ch = new Float32Array(sr * 4);
    for (let i = 0; i < ch.length; i++) ch[i] = 0.001 * Math.sin(2 * Math.PI * 1000 * i / sr); // very quiet
    const wavPath = await writeWav('quietlufs.wav', [ch, ch], sr);
    const f = await analyzeWav(wavPath);
    const r = await runQualityGates({ wavPath, graph: tinyGraph(8), features: f, genreTargets: { lufs: -8, true_peak_max: -1 } });
    const g = r.gates.find((x) => x.name === 'lufs_target_distance')!;
    expect(g.passed).toBe(false);
    expect(g.severity_tier).toBe('hard_fail'); // distance > 8 LU
  }, 30_000);

  it('every emitted gate has both severity_tier and confidence (full coverage)', async () => {
    const sr = 48000;
    const ch = new Float32Array(sr * 4);
    for (let i = 0; i < ch.length; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
    const wavPath = await writeWav('cover.wav', [ch, ch], sr);
    const f = await analyzeWav(wavPath);
    const r = await runQualityGates({ wavPath, graph: tinyGraph(8), features: f });
    for (const g of r.gates) {
      expect(g.severity_tier, `gate ${g.name} missing severity_tier`).toBeDefined();
      expect(g.confidence, `gate ${g.name} missing confidence`).toBeDefined();
    }
    expect(r.gates.length).toBeGreaterThanOrEqual(11);
  }, 30_000);
});
