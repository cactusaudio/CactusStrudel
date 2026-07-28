import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import wavefilePkg from 'wavefile';
import type { SessionGraph } from '@cactus/ir';
import { computeStemDiagnostics } from './stem-diagnostics.js';

const { WaveFile } = wavefilePkg;
const TMP = path.join(os.tmpdir(), 'cactus-stem-diag-tests');

beforeAll(async () => { await fs.mkdir(TMP, { recursive: true }); });

async function makeStemWav(name: string, freq: number, dur: number, amp: number): Promise<string> {
  const sr = 48000;
  const ch = new Float32Array(dur * sr);
  for (let i = 0; i < ch.length; i++) ch[i] = amp * Math.sin(2 * Math.PI * freq * i / sr);
  const wav = new WaveFile();
  wav.fromScratch(1, sr, '32f', [Array.from(ch)] as unknown as number[][]);
  const p = path.join(TMP, name);
  await fs.writeFile(p, wav.toBuffer());
  return p;
}

function tinyGraph(): SessionGraph {
  return {
    schema_version: '1.0.0',
    session_id: '00000000-0000-4000-8000-000000000000',
    created_at: '2026-05-10T00:00:00.000Z',
    brief: { text: 't', mood: [], references: [], modifiers: [], constraints: {} },
    song: { cycles_per_bar: 1, total_bars: 4, sections: [{ id: 's', name: 'main', start_bar: 0, end_bar: 4, energy: 0.5, function: 'main' }], energy_curve: [0.5, 0.5, 0.5, 0.5], layer_activation: {} },
    layers: [{ id: 'k', role: 'kick', orbit: 0 }, { id: 'b', role: 'bass', orbit: 1 }, { id: 'h', role: 'hat', orbit: 2 }],
    pattern_bank: { patterns: {} }, sound_palette: { layers: {} },
    mix_graph: { orbits: {}, master: { gain: 1, lufs_target: -10, true_peak_max: -1 }, sidechain: [], bus_sends: [] },
    render_graph: [], critique_graph: [],
    preference_graph: { decisions: [], weights: { genre_fit: 0.18, groove: 0.16, arrangement_arc: 0.13, sound_design: 0.1, mix_translation: 0.12, memorability_hook: 0.08, originality: 0.06, user_taste_fit: 0.05, technical_validity: 0.12 }, motif_likes: [], sound_likes: [], arrangement_likes: [] },
    iteration_log: [],
  };
}

describe('computeStemDiagnostics', () => {
  it('reports per-stem rms / peak / active for two stems', async () => {
    const w0 = await makeStemWav('stem0.wav', 60, 2, 0.5);
    const w1 = await makeStemWav('stem1.wav', 200, 2, 0.3);
    const r = await computeStemDiagnostics([
      { orbit: 0, layerIds: ['k'], wavPath: w0 },
      { orbit: 1, layerIds: ['b'], wavPath: w1 },
    ], tinyGraph());
    expect(r.stems.length).toBe(2);
    expect(r.stems[0]!.rms).toBeGreaterThan(0);
    expect(r.stems[0]!.peak_db).toBeGreaterThan(-30);
    expect(r.stems[0]!.active_ratio).toBeGreaterThan(0.5);
  });

  it('reports missing orbits when graph layers exceed stems supplied', async () => {
    const w0 = await makeStemWav('stemA.wav', 60, 2, 0.5);
    const r = await computeStemDiagnostics([
      { orbit: 0, layerIds: ['k'], wavPath: w0 },
    ], tinyGraph());
    expect(r.missing_orbits).toContain(1);
    expect(r.missing_orbits).toContain(2);
  });
});
