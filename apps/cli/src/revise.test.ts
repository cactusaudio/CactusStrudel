// G3: revise loop integration. Builds a fresh session via produce(skipRender),
// then runs revise() with Chinese feedback and asserts:
// - synthetic targets become applied patches
// - revised graph differs from prior on requested paths
// - locality unrelated_change_ratio low
// - BPM/genre/key invariants preserved

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { produce } from '@cactus/agent-runtime';
import { revise } from './revise.js';

const TMP = path.join(os.tmpdir(), 'cactus-revise-tests');

async function newSession(): Promise<string> {
  await fs.mkdir(TMP, { recursive: true });
  const r = await produce('peak time techno 130 BPM, 10 seconds', {
    sessionsRoot: TMP, seed: 42, skipRender: true, skipAnalyze: true,
  });
  return r.sessionDir;
}

describe('revise (G3)', () => {
  it('applies kick-harder + bass-stable from Chinese feedback', async () => {
    const sessionDir = await newSession();
    const r = await revise({
      sessionDir,
      feedback: '底鼓更硬，低频要稳',
      bestEffort: true, // skip render to keep test fast
    });
    // Planner may bundle the two synthetic targets into one mix-controller
    // patch or emit them separately — both are acceptable. The meaningful
    // assertion is that the kick orbit gain actually moved up.
    expect(r.patchesPlanned).toBeGreaterThanOrEqual(1);
    expect(r.patchesApplied).toBeGreaterThanOrEqual(1);
    expect(r.nextIter).toBe(1);

    const nextGraph = JSON.parse(await fs.readFile(path.join(sessionDir, 'iter_0001.json'), 'utf8'));
    const prevGraph = JSON.parse(await fs.readFile(path.join(sessionDir, 'iter_0000.json'), 'utf8'));
    // Kick orbit gain should have increased.
    const kickLayer = (prevGraph.layers as Array<{ id: string; role: string; orbit: number }>).find((l) => l.role === 'kick')!;
    const before = prevGraph.mix_graph.orbits[String(kickLayer.orbit)].gain;
    const after = nextGraph.mix_graph.orbits[String(kickLayer.orbit)].gain;
    expect(after).toBeGreaterThan(before);
  }, 60_000);

  it('preserves BPM / primary_genre / key invariants when feedback does not mention them', async () => {
    const sessionDir = await newSession();
    const r = await revise({
      sessionDir,
      feedback: '和弦别太甜',
      bestEffort: true,
    });
    expect(r.invariant_violations).toBe(0);
    const next = JSON.parse(await fs.readFile(path.join(sessionDir, 'iter_0001.json'), 'utf8'));
    const prev = JSON.parse(await fs.readFile(path.join(sessionDir, 'iter_0000.json'), 'utf8'));
    expect(next.brief.bpm).toBe(prev.brief.bpm);
    expect(next.brief.primary_genre).toBe(prev.brief.primary_genre);
  }, 60_000);

  it('writes revision-report.md and locality.json artifacts', async () => {
    const sessionDir = await newSession();
    const r = await revise({
      sessionDir,
      feedback: 'hat 刺耳，低频糊',
      bestEffort: true,
    });
    const report = await fs.readFile(r.reportPath, 'utf8');
    expect(report).toContain('## locality');
    expect(report).toContain('## planned patches');
    const locality = JSON.parse(await fs.readFile(path.join(sessionDir, 'iter_0001.locality.json'), 'utf8'));
    expect(locality.changed_paths).toBeDefined();
    expect(locality.drift_severity).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('throws when no iterations exist', async () => {
    const empty = path.join(TMP, `no-iters-${Date.now()}`);
    await fs.mkdir(empty, { recursive: true });
    await expect(revise({ sessionDir: empty, feedback: 'kick 更硬', bestEffort: true })).rejects.toThrow(/no iterations found/);
  });

  it('low drift_severity for surgical feedback ("kick 更硬" only touches kick orbit)', async () => {
    const sessionDir = await newSession();
    const r = await revise({
      sessionDir,
      feedback: '底鼓更硬',
      bestEffort: true,
    });
    expect(r.drift_severity).toBeLessThan(0.5); // mostly local change
  }, 60_000);
});
