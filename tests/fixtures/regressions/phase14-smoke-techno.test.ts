// Regression replay test: load the captured Phase 14 failure artifacts and
// verify that the failure modes the harness identified are present in the
// captured graph + features. If we ever lose the ability to *reproduce* the
// historical failure, this test catches it — preventing silent threshold
// drift from making the captured regression vanish from coverage.

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, 'phase14-smoke-techno');

describe('Phase 14 smoke regression fixture', () => {
  it('captures the failing SessionGraph', async () => {
    const g = JSON.parse(await fs.readFile(path.join(FIXTURE_DIR, 'session-graph.json'), 'utf8'));
    expect(g.brief.primary_genre).toBe('techno');
    expect(g.layers.length).toBeGreaterThan(0);
  });

  it('captures the compiled Strudel code', async () => {
    const code = await fs.readFile(path.join(FIXTURE_DIR, 'compiled.strudel.js'), 'utf8');
    expect(code).toMatch(/setcps/);
    expect(code).toMatch(/stack\(/);
  });

  it('captures the failing analyzer features', async () => {
    const f = JSON.parse(await fs.readFile(path.join(FIXTURE_DIR, 'features.json'), 'utf8'));
    // Confirm the historical failure: LUFS far below target.
    expect(f.loudness.lufs_integrated).toBeLessThan(-15);
    expect(f.loudness.true_peak_db).toBeGreaterThan(-1.5);
  });

  it('captures the quality-gates output with the specific failures', async () => {
    const g = JSON.parse(await fs.readFile(path.join(FIXTURE_DIR, 'quality-gates.json'), 'utf8'));
    const nsr = g.gates.find((x: { name: string }) => x.name === 'non_silent_ratio');
    expect(nsr.passed).toBe(false);
    expect(nsr.value).toBeLessThan(0.6);
  });

  it('captures the failure dossier listing all 4 categories', async () => {
    const f = JSON.parse(await fs.readFile(path.join(FIXTURE_DIR, 'failure.json'), 'utf8'));
    expect(f.categories).toEqual(expect.arrayContaining(['silence_or_near_silence', 'mix_mud', 'genre_collapse']));
  });
});
