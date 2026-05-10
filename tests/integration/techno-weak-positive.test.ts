// G9C §8: techno enabled-mode weak-positive fixture protection. The
// smoke-real audit (post-G9C) showed enabled mode improving on every
// metric for the techno smoke brief. We pin this so future cookbook
// changes can't silently destroy the only protected positive case.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  parseBrief, buildSessionGraphFromBrief, _resetCookbookCacheForTests,
  type CookbookTrace,
} from '@cactus/agent-runtime';

const FIXTURE_DIR = path.resolve(import.meta.dirname ?? __dirname, '..', 'fixtures', 'cookbook-impact', 'techno-enabled-weak-positive');

beforeEach(() => {
  delete process.env.CACTUS_COOKBOOK_MODE;
  _resetCookbookCacheForTests();
});

afterEach(() => {
  delete process.env.CACTUS_COOKBOOK_MODE;
});

describe('techno weak-positive fixture (G9C §8)', () => {
  const BRIEF_TEXT = 'peak time techno 132 BPM, 16 bars, hypnotic';
  const SEED = 7;

  it('captured fixture has both modes', async () => {
    for (const sub of ['enabled', 'minimal']) {
      for (const f of ['session-graph.json', 'compiled.strudel.js', 'cookbook-trace.json']) {
        await fs.access(path.join(FIXTURE_DIR, sub, f));
      }
    }
  });

  it('enabled mode for techno picks cookbook entries traceably', async () => {
    process.env.CACTUS_COOKBOOK_MODE = 'enabled';
    const brief = parseBrief(BRIEF_TEXT);
    const trace: CookbookTrace[] = [];
    await buildSessionGraphFromBrief(brief, { seed: SEED, traceOut: trace });
    const t = trace[0]!;
    expect(t.mode).toBe('enabled');
    const kickPicks = t.picks.filter((p) => p.cookbook_role === 'kick' && p.selected_id !== null);
    expect(kickPicks.length).toBeGreaterThan(0);
    const hatPicks = t.picks.filter((p) => p.cookbook_role === 'hat' && p.selected_id !== null);
    expect(hatPicks.length).toBeGreaterThan(0);
  });

  it('enabled mode produces a different pattern bank than minimal', async () => {
    process.env.CACTUS_COOKBOOK_MODE = 'enabled';
    const briefA = parseBrief(BRIEF_TEXT);
    const enGraph = await buildSessionGraphFromBrief(briefA, { seed: SEED });
    process.env.CACTUS_COOKBOOK_MODE = 'minimal';
    _resetCookbookCacheForTests();
    const briefB = parseBrief(BRIEF_TEXT);
    const minGraph = await buildSessionGraphFromBrief(briefB, { seed: SEED });
    // Some sections must differ.
    let differs = false;
    for (const lid of Object.keys(enGraph.pattern_bank.patterns)) {
      const enSecs = enGraph.pattern_bank.patterns[lid] ?? {};
      const minSecs = minGraph.pattern_bank.patterns[lid] ?? {};
      for (const sid of Object.keys(enSecs)) {
        if (JSON.stringify(enSecs[sid]) !== JSON.stringify(minSecs[sid])) {
          differs = true;
          break;
        }
      }
      if (differs) break;
    }
    expect(differs, 'enabled techno must produce a different graph than minimal').toBe(true);
  });

  it('enabled mode trace includes blame attribution for every pick', async () => {
    process.env.CACTUS_COOKBOOK_MODE = 'enabled';
    const brief = parseBrief(BRIEF_TEXT);
    const trace: CookbookTrace[] = [];
    await buildSessionGraphFromBrief(brief, { seed: SEED, traceOut: trace });
    for (const p of trace[0]!.picks) {
      expect(p.blame).toBeDefined();
      expect(p.blame!.graph_path).toMatch(/^\/pattern_bank\/patterns\//);
      expect(typeof p.blame!.post_value).toBe('string');
    }
  });
});
