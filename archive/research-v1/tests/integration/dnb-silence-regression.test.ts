// G9C §1 + §10: dnb enabled-mode silence regression. Pinned test that
// verifies the smoke-real failing brief no longer produces the silence
// bug; uses the full producer path with seed=7 to match the captured
// fixtures under tests/fixtures/cookbook-impact/dnb-enabled-silence-regression/.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  parseBrief, buildSessionGraphFromBrief, _resetCookbookCacheForTests,
  type CookbookTrace,
} from '@cactus/agent-runtime';
import { compileSessionGraph } from '@cactus/strudel-compiler';

const FIXTURE_DIR = path.resolve(import.meta.dirname ?? __dirname, '..', 'fixtures', 'cookbook-impact', 'dnb-enabled-silence-regression');

beforeEach(() => {
  delete process.env.CACTUS_COOKBOOK_MODE;
  _resetCookbookCacheForTests();
});

afterEach(() => {
  delete process.env.CACTUS_COOKBOOK_MODE;
});

describe('dnb enabled-mode silence regression (G9C §1)', () => {
  const BRIEF_TEXT = 'dnb 174 BPM, 16 bars, rolling reese sub';
  const SEED = 7;

  it('captured fixture exists with all required artifacts', async () => {
    for (const sub of ['pre-fix-enabled', 'post-fix-enabled', 'minimal']) {
      for (const f of ['session-graph.json', 'compiled.strudel.js', 'cookbook-trace.json']) {
        await fs.access(path.join(FIXTURE_DIR, sub, f));
      }
    }
  });

  it('pre-fix-enabled fixture demonstrates the silence bug — pad pattern uses bd/sd tokens', async () => {
    const graph = JSON.parse(await fs.readFile(path.join(FIXTURE_DIR, 'pre-fix-enabled', 'session-graph.json'), 'utf8'));
    const padLayer = graph.layers.find((l: { role: string }) => l.role === 'pad');
    expect(padLayer).toBeDefined();
    const padPatterns = graph.pattern_bank.patterns[padLayer.id];
    expect(padPatterns).toBeDefined();
    const padTokens = Object.values(padPatterns)
      .map((p) => (p as { mini_notation?: string }).mini_notation ?? '')
      .join(' ');
    // Pre-fix bug: pad got drum samples assigned (bd / sd).
    const hasDrumTokens = /\bbd\b|\bsd\b/.test(padTokens);
    expect(hasDrumTokens, 'pre-fix pad layer should still have drum tokens (preserved as historical evidence)').toBe(true);
  });

  it('post-fix enabled mode no longer assigns drum tokens to pad layer', async () => {
    process.env.CACTUS_COOKBOOK_MODE = 'enabled';
    const brief = parseBrief(BRIEF_TEXT);
    const trace: CookbookTrace[] = [];
    const graph = await buildSessionGraphFromBrief(brief, { seed: SEED, traceOut: trace });
    const padLayer = graph.layers.find((l) => l.role === 'pad');
    if (!padLayer) return; // dnb might not include pad; that's also OK
    const padPatterns = graph.pattern_bank.patterns[padLayer.id] ?? {};
    for (const [, pat] of Object.entries(padPatterns)) {
      const mini = (pat as { mini_notation?: string }).mini_notation ?? '';
      // The compiler emits note() for pad role; "bd" / "sd" / "hh" cannot be
      // parsed as notes and would cause silence. The fix bans drum-token
      // assignment to tonal layers.
      expect(mini, `pad pattern "${mini}" must not contain drum-sample tokens`).not.toMatch(/\b(bd|sd|hh|cp|oh)\b/);
    }
  });

  it('post-fix enabled mode still uses cookbook for kick/snare/bass (where dnb has entries)', async () => {
    process.env.CACTUS_COOKBOOK_MODE = 'enabled';
    const brief = parseBrief(BRIEF_TEXT);
    const trace: CookbookTrace[] = [];
    await buildSessionGraphFromBrief(brief, { seed: SEED, traceOut: trace });
    const picks = trace[0]!.picks;
    const kickWithSelection = picks.find((p) => p.layer_role === 'kick' && p.selected_id !== null);
    expect(kickWithSelection, 'kick should still be picked from the dnb cookbook').toBeDefined();
  });

  it('post-fix compiles cleanly to valid Strudel for dnb enabled mode', async () => {
    process.env.CACTUS_COOKBOOK_MODE = 'enabled';
    const brief = parseBrief(BRIEF_TEXT);
    const graph = await buildSessionGraphFromBrief(brief, { seed: SEED });
    const compiled = compileSessionGraph(graph);
    // Compiled code must NOT contain note("bd...") — the silence trigger.
    expect(compiled.code).not.toMatch(/note\("[^"]*bd[^"]*"\)/);
    expect(compiled.code).not.toMatch(/note\("[^"]*sd[^"]*"\)/);
    expect(compiled.code).not.toMatch(/note\("[^"]*hh[^"]*"\)/);
  });
});
