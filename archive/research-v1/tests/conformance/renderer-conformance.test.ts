// G4: renderer conformance suite. Runs each fixture twice and asserts that
// duration / RMS / sample-registry shape are deterministic across runs.
//
// Gated behind CACTUS_RENDER_E2E=1 because it boots Chromium + the renderer
// page (~10s warmup, ~5s per render).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  warmup, shutdown, renderMany, getSampleRegistry, renderPeak,
  queryHaps, type RenderInput,
} from '@cactus/renderer';

const SHOULD_RUN = process.env.CACTUS_RENDER_E2E === '1';
const TMP = path.join(os.tmpdir(), 'cactus-conformance');

const FIXTURES: Array<{ id: string; code: string; durationCycles: number }> = [
  {
    id: 'synth-saw-cm',
    code: 'setcps(0.5)\nnote("c2 e2 g2 c3").s("sawtooth").gain(0.5)',
    durationCycles: 2,
  },
  {
    id: 'kick-4on4',
    code: 'setcps(0.5)\ns("bd*4").gain(0.9)',
    durationCycles: 2,
  },
  {
    id: 'chord-tri-room',
    code: 'setcps(0.5)\nnote("<c3 e3 g3 b3>").s("triangle").gain(0.7).room(0.4)',
    durationCycles: 2,
  },
];

describe.runIf(SHOULD_RUN)('renderer conformance (G4)', () => {
  beforeAll(async () => {
    await fs.mkdir(TMP, { recursive: true });
    await warmup();
  }, 120_000);

  afterAll(async () => {
    await shutdown();
  });

  it('renderMany batches three fixtures without re-booting', async () => {
    const inputs: RenderInput[] = FIXTURES.map((f, i) => ({
      code: f.code,
      durationCycles: f.durationCycles,
      outputPath: path.join(TMP, `batch-${i}.wav`),
    }));
    const t0 = Date.now();
    const results = await renderMany(inputs);
    const elapsed = Date.now() - t0;
    expect(results.length).toBe(FIXTURES.length);
    for (const r of results) {
      expect(r.durationSec).toBeGreaterThan(3.5);
      const peak = await renderPeak(r.wavPath);
      expect(peak.peakDb).toBeGreaterThan(-60);
    }
    // Three renders + zero re-boots should be well under three boot times
    // (~30s each). 60s is a generous ceiling.
    expect(elapsed).toBeLessThan(60_000);
  }, 120_000);

  it('warmup boots the renderer-page and getSampleRegistry returns ≥1 loaded entry', async () => {
    const reg = await getSampleRegistry();
    expect(reg.total_probed).toBeGreaterThan(0);
    expect(reg.loaded_count).toBeGreaterThan(0);
    // Synth probes should always be present (no network needed).
    const synths = reg.entries.filter((e) => e.type === 'synth').map((e) => e.name);
    expect(synths).toContain('sawtooth');
    expect(synths).toContain('triangle');
    expect(synths).toContain('sine');
  }, 60_000);

  it('re-rendering each fixture produces feature-identical audio (duration ε<10ms, RMS ε<0.5dB)', async () => {
    for (const fix of FIXTURES) {
      const out1 = path.join(TMP, `det-${fix.id}-a.wav`);
      const out2 = path.join(TMP, `det-${fix.id}-b.wav`);
      const a = await renderMany([
        { code: fix.code, durationCycles: fix.durationCycles, outputPath: out1 },
      ]);
      const b = await renderMany([
        { code: fix.code, durationCycles: fix.durationCycles, outputPath: out2 },
      ]);
      expect(Math.abs(a[0]!.durationSec - b[0]!.durationSec)).toBeLessThan(0.01);
      const pa = await renderPeak(out1);
      const pb = await renderPeak(out2);
      expect(Math.abs(pa.rmsDb - pb.rmsDb)).toBeLessThan(0.5);
    }
  }, 240_000);

  it('sample registry is stable across calls (idempotent probe)', async () => {
    const r1 = await getSampleRegistry();
    const r2 = await getSampleRegistry();
    expect(r1.total_probed).toBe(r2.total_probed);
    expect(r1.loaded_count).toBe(r2.loaded_count);
    expect(r1.entries.map((e) => `${e.name}:${e.type}`).sort()).toEqual(
      r2.entries.map((e) => `${e.name}:${e.type}`).sort(),
    );
  }, 60_000);

  it('offline and realtime paths both render audible audio with bounded duration policy', async () => {
    const code = 'setcps(0.5)\nstack(s("bd*4").gain(0.85), note("c2 g2").s("sine").gain(0.45))';
    const expectedPlaySec = 2;
    const offlinePath = path.join(TMP, 'mode-offline.wav');
    const realtimePath = path.join(TMP, 'mode-realtime.wav');
    const offline = await renderMany([{ code, durationCycles: 1, outputPath: offlinePath }]);
    const realtime = await renderMany([{ code, durationCycles: 1, outputPath: realtimePath, realtime: true }]);

    expect(Math.abs(offline[0]!.durationSec - expectedPlaySec)).toBeLessThan(0.2);
    // Realtime deliberately captures a bounded tail so releases/reverbs are not
    // truncated. This pins the difference as a documented policy instead of an
    // unbounded offline/realtime drift.
    expect(realtime[0]!.durationSec).toBeGreaterThanOrEqual(expectedPlaySec);
    expect(realtime[0]!.durationSec).toBeLessThan(expectedPlaySec + 1.5);
    expect((await renderPeak(offlinePath)).peakDb).toBeGreaterThan(-60);
    expect((await renderPeak(realtimePath)).peakDb).toBeGreaterThan(-60);
  }, 60_000);

  it('queryHaps maps drum/sample haps to MIDI drum notes and channel 10', async () => {
    const r = await queryHaps({ code: 'setcps(0.5)\ns("bd sd hh oh")', durationCycles: 1, cps: 0.5 });
    expect(r.haps.length).toBeGreaterThanOrEqual(4);
    expect(r.haps.map((h) => h.note)).toEqual(expect.arrayContaining([36, 38, 42, 46]));
    expect(r.haps.every((h) => h.ch === 9)).toBe(true);
  }, 60_000);
});
