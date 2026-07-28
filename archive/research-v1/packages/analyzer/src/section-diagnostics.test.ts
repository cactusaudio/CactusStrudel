import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import wavefilePkg from 'wavefile';
import type { SessionGraph } from '@cactus/ir';
import { computeSectionDiagnostics } from './section-diagnostics.js';

const { WaveFile } = wavefilePkg;
const TMP = path.join(os.tmpdir(), 'cactus-section-diag-tests');

beforeAll(async () => { await fs.mkdir(TMP, { recursive: true }); });

function makeGraph(totalBars: number, bpm: number, sectionFn: 'intro' | 'main' | 'outro' = 'main'): SessionGraph {
  return {
    schema_version: '1.0.0',
    session_id: '00000000-0000-4000-8000-000000000000',
    created_at: '2026-05-10T00:00:00.000Z',
    brief: { text: 't', bpm, mood: [], references: [], modifiers: [], constraints: {} },
    song: {
      cycles_per_bar: 1,
      total_bars: totalBars,
      sections: [
        { id: 's1', name: 'intro', start_bar: 0, end_bar: Math.floor(totalBars / 3), energy: 0.3, function: 'intro' },
        { id: 's2', name: 'main',  start_bar: Math.floor(totalBars / 3), end_bar: 2 * Math.floor(totalBars / 3), energy: 0.8, function: sectionFn === 'main' ? 'main' : 'main' },
        { id: 's3', name: 'outro', start_bar: 2 * Math.floor(totalBars / 3), end_bar: totalBars, energy: 0.3, function: 'outro' },
      ],
      energy_curve: Array(totalBars).fill(0.5),
      layer_activation: { kick: { sections: { s1: true, s2: true, s3: false } }, hat: { sections: { s1: false, s2: true, s3: true } } },
    },
    layers: [{ id: 'kick', role: 'kick', orbit: 0 }, { id: 'hat', role: 'hat', orbit: 1 }],
    pattern_bank: { patterns: {} }, sound_palette: { layers: {} },
    mix_graph: { orbits: {}, master: { gain: 1, lufs_target: -10, true_peak_max: -1 }, sidechain: [], bus_sends: [] },
    render_graph: [], critique_graph: [],
    preference_graph: { decisions: [], weights: { genre_fit: 0.18, groove: 0.16, arrangement_arc: 0.13, sound_design: 0.1, mix_translation: 0.12, memorability_hook: 0.08, originality: 0.06, user_taste_fit: 0.05, technical_validity: 0.12 }, motif_likes: [], sound_likes: [], arrangement_likes: [] },
    iteration_log: [],
  };
}

async function writeWav(p: string, channels: Float32Array[], sr = 48000): Promise<void> {
  const wav = new WaveFile();
  wav.fromScratch(channels.length, sr, '32f', channels.map((c) => Array.from(c)) as unknown as number[][]);
  await fs.writeFile(p, wav.toBuffer());
}

describe('computeSectionDiagnostics', () => {
  it('emits per-section RMS, non_silent, band_rms, and active layer count', async () => {
    const sr = 48000;
    const seconds = 18;
    const ch = new Float32Array(seconds * sr);
    for (let i = 0; i < ch.length; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
    const wavPath = path.join(TMP, 'continuous.wav');
    await writeWav(wavPath, [ch, ch], sr);
    const graph = makeGraph(18, 240);
    const r = await computeSectionDiagnostics(wavPath, graph);
    expect(r.rendered_sections.length).toBe(3);
    for (const s of r.rendered_sections) {
      expect(s.non_silent_ratio).toBeGreaterThan(0.5);
      expect(s.rms).toBeGreaterThan(0);
      expect(s.band_rms.mid).toBeDefined();
      expect(s.active_layer_count).toBeGreaterThanOrEqual(0);
    }
  });

  it('flags silent sections with non_silent_ratio < 0.5', async () => {
    const sr = 48000;
    const seconds = 18;
    const ch = new Float32Array(seconds * sr);
    // Only the first 6 seconds are loud; rest is silence.
    for (let i = 0; i < 6 * sr; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
    const wavPath = path.join(TMP, 'half-silent.wav');
    await writeWav(wavPath, [ch, ch], sr);
    const graph = makeGraph(18, 240);
    const r = await computeSectionDiagnostics(wavPath, graph);
    const last = r.rendered_sections[2]!;
    expect(last.non_silent_ratio).toBeLessThan(0.5);
  });

  it('lists unrendered sections when audio is shorter than song schedule', async () => {
    const sr = 48000;
    const seconds = 6;
    const ch = new Float32Array(seconds * sr);
    for (let i = 0; i < ch.length; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
    const wavPath = path.join(TMP, 'short.wav');
    await writeWav(wavPath, [ch, ch], sr);
    const graph = makeGraph(18, 240);
    const r = await computeSectionDiagnostics(wavPath, graph);
    expect(r.unrendered_sections.length).toBeGreaterThan(0);
  });
});
