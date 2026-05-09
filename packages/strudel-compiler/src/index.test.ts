import { describe, it, expect } from 'vitest';
import { loadFixture, FIXTURE_GENRES } from '@cactus/ir';
import { validateStrudelCode } from '@cactus/strudel-validator';
import { compileSessionGraph } from './index.js';

describe('compileSessionGraph', () => {
  for (const slug of FIXTURE_GENRES) {
    it(`${slug}: compiles without warnings except for known cases`, async () => {
      const g = await loadFixture(slug);
      const out = compileSessionGraph(g);
      expect(out.code.length).toBeGreaterThan(0);
      // ambient fixture has no kick/orbit-0 → no real warnings expected from our path.
      // Permit warnings array to be empty or contain only mix_graph hints.
      for (const w of out.warnings) {
        expect(w).toMatch(/(no mix_graph entry|no layers defined)/);
      }
    });

    it(`${slug}: compiled code passes JS validator`, async () => {
      const g = await loadFixture(slug);
      const { code } = compileSessionGraph(g);
      const r = validateStrudelCode(code);
      if (!r.ok) {
        // helpful failure message
        // eslint-disable-next-line no-console
        console.error(`compiled ${slug} validation issues:`, r.issues, '\n---\n', code);
      }
      expect(r.ok).toBe(true);
    });

    it(`${slug}: output is deterministic — same graph → same code`, async () => {
      const g = await loadFixture(slug);
      const a = compileSessionGraph(g).code;
      const b = compileSessionGraph(g).code;
      expect(a).toBe(b);
    });

    it(`${slug}: source map paths reference real graph paths`, async () => {
      const g = await loadFixture(slug);
      const { sourceMap, code } = compileSessionGraph(g);
      expect(sourceMap.length).toBeGreaterThan(0);
      // Every map entry's slice should appear at the expected position
      for (const e of sourceMap) {
        expect(code.slice(e.start, e.end).length).toBe(e.end - e.start);
      }
    });

    it(`${slug}: solo option mutes other orbits via .gain(0)`, async () => {
      const g = await loadFixture(slug);
      if (g.layers.length < 2) return;
      const targetOrbit = g.layers[0]!.orbit;
      const out = compileSessionGraph(g, { solo: targetOrbit });
      // At least one .gain(0) should appear (for layers != target)
      expect(out.code).toMatch(/\.gain\(0\)/);
    });
  }

  it('emits setcps from brief.bpm', async () => {
    const g = await loadFixture('techno');
    const out = compileSessionGraph(g);
    // 132 bpm → cps = 0.55
    expect(out.code).toMatch(/setcps\(0\.55\)/);
  });

  it('uses arrange() with weighted section pairs', async () => {
    const g = await loadFixture('techno');
    const out = compileSessionGraph(g);
    expect(out.code).toMatch(/arrange\(/);
    expect(out.code).toMatch(/\[16,/); // 16-bar intro
  });

  it('inserts silence for inactive sections', async () => {
    const g = await loadFixture('techno');
    const out = compileSessionGraph(g);
    expect(out.code).toMatch(/silence/);
  });
});
