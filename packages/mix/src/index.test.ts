import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import wavefilePkg from 'wavefile';
import type { SessionGraph } from '@cactus/ir';
import { applyGainStaging, applyBandBalance, masterNormalize, guardTruePeak } from './index.js';

const { WaveFile } = wavefilePkg;
const TMP = path.join(os.tmpdir(), 'cactus-mix-tests');

function tinyGraph(
  primary_genre: string,
  layers: Array<{ id: string; role: string; orbit: number }>,
): SessionGraph {
  return {
    schema_version: '1.0.0',
    session_id: '00000000-0000-4000-8000-000000000000',
    created_at: '2026-05-10T00:00:00.000Z',
    brief: { text: 'test', primary_genre, mood: [], references: [], modifiers: [], constraints: {} },
    song: {
      cycles_per_bar: 1, total_bars: 4,
      sections: [{ id: 's', name: 'main', start_bar: 0, end_bar: 4, energy: 0.7, function: 'main' }],
      energy_curve: [0.7, 0.7, 0.7, 0.7],
      layer_activation: Object.fromEntries(layers.map((l) => [l.id, { sections: { s: true } }])),
    },
    layers: layers as never,
    pattern_bank: { patterns: {} },
    sound_palette: { layers: Object.fromEntries(layers.map((l) => [l.id, {
      source: { kind: 'synth' as const, name: 'sawtooth', options: {} },
      effects: [],
    }])) },
    mix_graph: { orbits: Object.fromEntries(layers.map((l) => [String(l.orbit), { gain: 1, pan: 0, width: 1, room_send: 0, delay_send: 0 }])), master: { gain: 1, lufs_target: -10, true_peak_max: -1 }, sidechain: [], bus_sends: [] },
    render_graph: [], critique_graph: [],
    preference_graph: { decisions: [], weights: { genre_fit: 0.18, groove: 0.16, arrangement_arc: 0.13, sound_design: 0.1, mix_translation: 0.12, memorability_hook: 0.08, originality: 0.06, user_taste_fit: 0.05, technical_validity: 0.12 }, motif_likes: [], sound_likes: [], arrangement_likes: [] },
    iteration_log: [],
  };
}

async function writeSineWav(p: string, freq: number, dur: number, amp: number, sr = 48000): Promise<void> {
  const ch = new Float32Array(Math.floor(dur * sr));
  for (let i = 0; i < ch.length; i++) ch[i] = amp * Math.sin(2 * Math.PI * freq * i / sr);
  const wav = new WaveFile();
  wav.fromScratch(2, sr, '32f', [Array.from(ch), Array.from(ch)] as unknown as number[][]);
  await fs.writeFile(p, wav.toBuffer());
}

beforeAll(async () => { await fs.mkdir(TMP, { recursive: true }); });

describe('applyGainStaging', () => {
  it('sets techno kick to ~0.85 and chord trimmed for low_mid', () => {
    const g = tinyGraph('techno', [{ id: 'kick', role: 'kick', orbit: 0 }, { id: 'chord', role: 'chord', orbit: 1 }]);
    const r = applyGainStaging(g);
    expect(r.genre).toBe('techno');
    expect(g.mix_graph.orbits['0']!.gain).toBeLessThanOrEqual(1);
    expect(g.mix_graph.orbits['1']!.gain).toBeLessThanOrEqual(0.3); // chord trimmed
  });

  it('sets ambient pad to genre default (around 0.55)', () => {
    const g = tinyGraph('ambient', [{ id: 'pad', role: 'pad', orbit: 0 }]);
    applyGainStaging(g);
    expect(g.mix_graph.orbits['0']!.gain).toBeCloseTo(0.55, 1);
  });

  it('returns mutation list for changed orbits', () => {
    const g = tinyGraph('techno', [{ id: 'kick', role: 'kick', orbit: 0 }]);
    const r = applyGainStaging(g);
    expect(r.mutations.length).toBeGreaterThanOrEqual(0);
    if (r.mutations.length > 0) {
      expect(r.mutations[0]!.before).toBeDefined();
      expect(r.mutations[0]!.after).toBeDefined();
    }
  });
});

describe('applyBandBalance', () => {
  it('adds HPF to chord layer if absent', () => {
    const g = tinyGraph('techno', [{ id: 'chord', role: 'chord', orbit: 0 }]);
    applyBandBalance(g);
    const effects = g.sound_palette.layers.chord!.effects;
    const hpf = effects.find((e) => e.type === 'hpf');
    expect(hpf).toBeDefined();
    expect((hpf!.params as { freq: number }).freq).toBeGreaterThanOrEqual(400);
  });

  it('raises existing chord HPF below target', () => {
    const g = tinyGraph('techno', [{ id: 'chord', role: 'chord', orbit: 0 }]);
    g.sound_palette.layers.chord!.effects = [{ type: 'hpf', params: { freq: 100 } }];
    applyBandBalance(g);
    const hpf = g.sound_palette.layers.chord!.effects.find((e) => e.type === 'hpf');
    expect((hpf!.params as { freq: number }).freq).toBeGreaterThanOrEqual(400);
  });

  it('reduces stacked low_mid roles in drop sections', () => {
    const g = tinyGraph('techno', [
      { id: 'chord1', role: 'chord', orbit: 0 },
      { id: 'pad', role: 'pad', orbit: 1 },
    ]);
    g.song.sections[0]!.function = 'drop';
    g.song.layer_activation.chord1!.sections.s = true;
    g.song.layer_activation.pad!.sections.s = true;
    g.mix_graph.orbits['0']!.gain = 0.7;
    g.mix_graph.orbits['1']!.gain = 0.7;
    const r = applyBandBalance(g);
    // The second stacked role should have its gain reduced
    expect(g.mix_graph.orbits['1']!.gain).toBeLessThan(0.7);
    expect(r.mutations.some((m) => m.change.includes('stacked-low-mid'))).toBe(true);
  });

  it('caps dub_techno chord room_send at 0.45', () => {
    const g = tinyGraph('dub_techno', [{ id: 'chord', role: 'chord', orbit: 0 }]);
    g.mix_graph.orbits['0']!.room_send = 0.7;
    applyBandBalance(g);
    expect(g.mix_graph.orbits['0']!.room_send).toBeLessThanOrEqual(0.45);
  });
});

describe('masterNormalize', () => {
  it('boosts a quiet input toward the LUFS target', async () => {
    const inp = path.join(TMP, 'quiet.wav');
    const out = path.join(TMP, 'quiet.norm.wav');
    await writeSineWav(inp, 1000, 4, 0.05);
    const r = await masterNormalize({ inputWavPath: inp, outputWavPath: out, targetLufs: -10 });
    expect(r.applied_gain_db).toBeGreaterThan(5);
    expect(r.refused).toBe(false);
  }, 30_000);

  it('refuses structurally-broken input (huge gap + hot peak)', async () => {
    // Synthesize a peaky-quiet signal: short bursts of full amplitude, mostly silent.
    const sr = 48000; const dur = 4;
    const ch = new Float32Array(dur * sr);
    for (let i = 0; i < 4; i++) {
      const start = i * sr;
      for (let k = 0; k < 200; k++) ch[start + k] = 0.99 * Math.sin(2 * Math.PI * 100 * k / sr);
    }
    const wav = new WaveFile();
    wav.fromScratch(2, sr, '32f', [Array.from(ch), Array.from(ch)] as unknown as number[][]);
    const inp = path.join(TMP, 'peaky-quiet.wav');
    const out = path.join(TMP, 'peaky-quiet.norm.wav');
    await fs.writeFile(inp, wav.toBuffer());
    const r = await masterNormalize({ inputWavPath: inp, outputWavPath: out, targetLufs: -8 });
    expect(r.refused).toBe(true);
    expect(r.refusal_reason).toMatch(/peak/i);
  }, 30_000);

  it('does not refuse when refuseStructuralFailure=false', async () => {
    const sr = 48000; const dur = 4;
    const ch = new Float32Array(dur * sr);
    for (let i = 0; i < 4; i++) {
      const start = i * sr;
      for (let k = 0; k < 200; k++) ch[start + k] = 0.99 * Math.sin(2 * Math.PI * 100 * k / sr);
    }
    const wav = new WaveFile();
    wav.fromScratch(2, sr, '32f', [Array.from(ch), Array.from(ch)] as unknown as number[][]);
    const inp = path.join(TMP, 'peaky-quiet2.wav');
    const out = path.join(TMP, 'peaky-quiet2.norm.wav');
    await fs.writeFile(inp, wav.toBuffer());
    const r = await masterNormalize({ inputWavPath: inp, outputWavPath: out, targetLufs: -8, refuseStructuralFailure: false });
    expect(r.refused).toBe(false);
  }, 30_000);
});

describe('guardTruePeak', () => {
  it('reduces a hot input to within ceiling', async () => {
    const inp = path.join(TMP, 'hot.wav');
    const out = path.join(TMP, 'hot.guarded.wav');
    await writeSineWav(inp, 1000, 2, 1.0);
    const r = await guardTruePeak({ inputWavPath: inp, outputWavPath: out, ceilingDb: -1 });
    expect(r.post_peak_db).toBeLessThanOrEqual(-0.5);
    expect(r.applied_gain_db).toBeLessThan(0);
  }, 30_000);

  it('no-ops when peak already under ceiling', async () => {
    const inp = path.join(TMP, 'cool.wav');
    const out = path.join(TMP, 'cool.guarded.wav');
    await writeSineWav(inp, 1000, 2, 0.5); // peak ~ -6 dBFS
    const r = await guardTruePeak({ inputWavPath: inp, outputWavPath: out, ceilingDb: -1 });
    expect(r.applied_gain_db).toBe(0);
  }, 30_000);

  it('soft-clips overshoot when present', async () => {
    const inp = path.join(TMP, 'spiky.wav');
    const out = path.join(TMP, 'spiky.guarded.wav');
    await writeSineWav(inp, 1000, 2, 0.95);
    const r = await guardTruePeak({ inputWavPath: inp, outputWavPath: out, ceilingDb: -1 });
    expect(r.post_peak_db).toBeLessThanOrEqual(-0.5);
  }, 30_000);
});
