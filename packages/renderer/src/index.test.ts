import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { render, renderPeak, releaseRenderer } from './index.js';

const SHOULD_RUN = process.env.CACTUS_RENDER_E2E === '1';

const TMP = path.join(os.tmpdir(), 'cactus-render-tests');

afterAll(async () => {
  // Best-effort: drain shared renderer handle.
  try { await releaseRenderer(); } catch { /* */ }
});

describe.runIf(SHOULD_RUN)('renderer conformance (E2E)', () => {
  it('renders a synth pattern to non-silent audio (no network needed)', async () => {
    const out = path.join(TMP, 'synth-basic.wav');
    const r = await render({
      code: 'setcps(0.5)\nnote("c2 e2 g2 c3").s("sawtooth").gain(0.5)',
      durationCycles: 2,
      outputPath: out,
    });
    expect(await fileExists(r.wavPath)).toBe(true);
    expect(r.durationSec).toBeGreaterThan(3.5);
    const { peakDb } = await renderPeak(r.wavPath);
    expect(peakDb).toBeGreaterThan(-60);
  }, 90_000);

  it('renders a kick pattern (dirt-samples loaded at boot)', async () => {
    const out = path.join(TMP, 'kick.wav');
    const r = await render({
      code: 'setcps(0.5)\ns("bd*4").gain(0.9)',
      durationCycles: 2,
      outputPath: out,
    });
    expect(await fileExists(r.wavPath)).toBe(true);
    expect(r.durationSec).toBeGreaterThan(3.5);
    const { peakDb } = await renderPeak(r.wavPath);
    expect(peakDb).toBeGreaterThan(-60);
  }, 120_000);

  it('renders synth + filter chain', async () => {
    const out = path.join(TMP, 'synth.wav');
    const r = await render({
      code: 'setcps(0.5)\nnote("c2 e2 g2 b2").s("sawtooth").lpf(800)',
      durationCycles: 2,
      outputPath: out,
    });
    const { peakDb } = await renderPeak(r.wavPath);
    expect(peakDb).toBeGreaterThan(-60);
  }, 90_000);

  it('renders tonal chord progression', async () => {
    const out = path.join(TMP, 'chord.wav');
    const r = await render({
      code: 'setcps(0.5)\nnote("<c3 e3 g3 b3>").s("triangle").gain(0.7).room(0.4)',
      durationCycles: 2,
      outputPath: out,
    });
    const { peakDb } = await renderPeak(r.wavPath);
    expect(peakDb).toBeGreaterThan(-60);
  }, 90_000);

  it('returns deterministic duration for the same input', async () => {
    const out1 = path.join(TMP, 'det1.wav');
    const out2 = path.join(TMP, 'det2.wav');
    const code = 'setcps(0.5)\ns("bd*4").gain(0.9)';
    const a = await render({ code, durationCycles: 2, outputPath: out1 });
    const b = await render({ code, durationCycles: 2, outputPath: out2 });
    expect(Math.abs(a.durationSec - b.durationSec)).toBeLessThan(0.01);
  }, 180_000);

  it('populates packageVersions metadata', async () => {
    const out = path.join(TMP, 'meta.wav');
    const r = await render({
      code: 'setcps(0.5)\ns("bd")',
      durationCycles: 1,
      outputPath: out,
    });
    expect(r.packageVersions['@strudel/web']).toBeDefined();
  }, 90_000);
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
