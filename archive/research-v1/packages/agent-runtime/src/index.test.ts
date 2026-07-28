import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseBrief, produce } from './index.js';
import { compileSessionGraph } from '@cactus/strudel-compiler';
import { validateStrudelCode } from '@cactus/strudel-validator';
import { buildSessionGraphFromBrief } from './build-graph.js';

describe('parseBrief', () => {
  it('extracts BPM, genre, mood from a dub techno brief', () => {
    const b = parseBrief('dark spacious dub techno; Burial rain texture; 132 BPM; haunted; 909 core');
    expect(b.bpm).toBe(132);
    expect(b.primary_genre).toBe('dub_techno');
    expect(b.mood).toEqual(expect.arrayContaining(['dark', 'spacious', 'haunted']));
    expect(b.references.find((r) => r.value.toLowerCase() === 'burial')).toBeDefined();
  });

  it('extracts neurofunk modifier', () => {
    const b = parseBrief('rolling neurofunk dnb 174 BPM, dark');
    expect(b.primary_genre).toBe('dnb');
    expect(b.modifiers).toEqual(expect.arrayContaining(['neurofunk']));
    expect(b.bpm).toBe(174);
  });

  it('extracts duration', () => {
    const b = parseBrief('peak time techno 132 BPM, 4 minutes');
    expect(b.duration_target_sec).toBe(240);
  });

  it('extracts key', () => {
    const b = parseBrief('ambient drone in C minor, 60 BPM');
    expect(b.key).toEqual({ tonic: 'C', mode: 'minor' });
  });

  it('returns no genre if none detected', () => {
    const b = parseBrief('something nondescript');
    expect(b.primary_genre).toBeUndefined();
  });
});

describe('buildSessionGraphFromBrief', () => {
  it('builds techno graph that compiles to validator-clean code', async () => {
    const brief = parseBrief('peak time techno 132 BPM, driving');
    const graph = await buildSessionGraphFromBrief(brief);
    expect(graph.brief.bpm).toBe(132);
    expect(graph.layers.length).toBeGreaterThanOrEqual(3);
    const compiled = compileSessionGraph(graph);
    const r = validateStrudelCode(compiled.code);
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it('is deterministic for the same brief and seed', async () => {
    const brief = parseBrief('dark dub techno 130 BPM');
    const a = await buildSessionGraphFromBrief(brief, { seed: 42 });
    const b = await buildSessionGraphFromBrief(brief, { seed: 42 });
    // session_id and timestamps differ; pattern_bank should not.
    expect(a.pattern_bank).toEqual(b.pattern_bank);
  });

  it('respects ambient drone constraints (no kick)', async () => {
    const brief = parseBrief('ambient drone, slow evolving, no rhythm, 60 BPM');
    const graph = await buildSessionGraphFromBrief(brief);
    const hasKick = graph.layers.some((l) => l.role === 'kick');
    expect(hasKick).toBe(false);
  });

  it('respects no-four-on-floor by not activating a coverage kick', async () => {
    const brief = parseBrief('techno 132 BPM, no 4-on-the-floor');
    const graph = await buildSessionGraphFromBrief(brief);
    const kick = graph.layers.find((l) => l.role === 'kick');
    expect(kick).toBeDefined();
    const activeKickSections = Object.values(graph.song.layer_activation[kick!.id]!.sections).filter(Boolean);
    expect(activeKickSections.length).toBe(0);
  });

  it('respects mono low by narrowing kick and bass orbits', async () => {
    const brief = parseBrief('house 124 BPM, mono low');
    const graph = await buildSessionGraphFromBrief(brief);
    for (const layer of graph.layers.filter((l) => l.role === 'kick' || l.role === 'bass' || l.role === 'sub')) {
      expect(graph.mix_graph.orbits[String(layer.orbit)]?.width).toBe(0);
    }
  });

  it('produces total_bars within ±25% of duration target', async () => {
    const brief = parseBrief('dub techno 130 BPM, 3 minutes');
    const graph = await buildSessionGraphFromBrief(brief);
    const cps = 130 / 240;
    const expectedCycles = 180 * cps;
    expect(graph.song.total_bars).toBeGreaterThan(expectedCycles * 0.7);
    expect(graph.song.total_bars).toBeLessThan(expectedCycles * 1.5);
  });
});

describe('produce (E2E without render)', () => {
  it('produces a session bundle for 5 example briefs (skipRender=true)', async () => {
    const tmp = path.join(os.tmpdir(), `cactus-produce-${Date.now()}`);
    const briefs = [
      'dark dub techno 130 BPM, haunted, 909 core',
      'peak time techno 134 BPM, driving',
      'rolling neurofunk dnb 174 BPM, dark',
      'fractured idm 138 BPM, polyrhythmic',
      'ambient drone, slow evolving, in D dorian, 60 BPM',
    ];
    for (const text of briefs) {
      const r = await produce(text, { sessionsRoot: tmp, skipRender: true });
      expect(r.compiledCode.length).toBeGreaterThan(50);
      expect(r.validatorIssues).toBe(0);
      const graph = JSON.parse(await fs.readFile(path.join(r.sessionDir, 'iter_0000.json'), 'utf8'));
      expect(graph.session_id).toBe(r.graph.session_id);
      const report = await fs.readFile(r.reportPath, 'utf8');
      expect(report).toContain('# session');
    }
  });
});
