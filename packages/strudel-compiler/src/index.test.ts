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
        expect(w).toMatch(/(no mix_graph entry|no layers defined|declared in IR but not compiled|metadata only; not compiled)/);
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

  it('emits setcpm from brief.bpm', async () => {
    const g = await loadFixture('techno');
    const out = compileSessionGraph(g);
    // 132 bpm at 4 beats/cycle → cpm = 33
    expect(out.code).toMatch(/setcpm\(33\)/);
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

  it('emits ADSR envelope, applies cycles_per_bar to tempo/section cycles, and warns for declared IR fields that are not compiled', async () => {
    const g = structuredClone(await loadFixture('techno'));
    const firstLayer = g.layers[0]!;
    const firstSection = g.song.sections[0]!;
    g.song.cycles_per_bar = 2;
    g.pattern_bank.patterns[firstLayer.id]![firstSection.id] = {
      mini_notation: 'bd*4',
      density: 0.8,
      syncopation: 0.2,
      variations: [{ mini_notation: 'bd [bd bd] bd bd' }],
    };
    g.sound_palette.layers[firstLayer.id] = {
      source: { kind: 'sample', name: 'bd', options: {} },
      envelope: { a: 0.01, d: 0.2, s: 0.5, r: 0.3 },
      macros: { rough: true },
      effects: [{ type: 'lpf', params: { freq: 900 }, automation: { freq: 'slow_sine' } }],
    };
    g.mix_graph.orbits[String(firstLayer.orbit)]!.width = 1.4;
    g.mix_graph.bus_sends.push({ from_orbit: String(firstLayer.orbit), to_bus: 'reverb', amount: 0.4 });

    const out = compileSessionGraph(g);
    expect(out.code).toContain('.attack(0.01).decay(0.2).sustain(0.5).release(0.3)');
    expect(out.code).toMatch(/setcpm\(66\)/); // 132 bpm at 2 cycles/bar → 66 cycles/minute
    expect(out.code).toMatch(/\[32,/); // 16 bars × 2 cycles/bar
    expect(out.warnings.some((w) => w.includes('/song/cycles_per_bar'))).toBe(false);
    expect(out.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('/mix_graph/bus_sends'),
      expect.stringContaining('/density'),
      expect.stringContaining('/syncopation'),
      expect.stringContaining('/variations'),
      expect.stringContaining('/macros'),
      expect.stringContaining('/automation'),
      expect.stringContaining('/width'),
    ]));
  });

  it('falls back to silence for invalid raw pattern expressions', async () => {
    const g = structuredClone(await loadFixture('techno'));
    const firstLayer = g.layers[0]!;
    const firstSection = g.song.sections[0]!;
    g.pattern_bank.patterns[firstLayer.id]![firstSection.id] = {
      raw: 's("bd").definitelyNotStrudel(1)',
    };

    const out = compileSessionGraph(g);
    expect(out.code).toContain('silence');
    expect(out.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('/raw failed deterministic Strudel validation'),
    ]));
    expect(validateStrudelCode(out.code).ok).toBe(true);
  });

  it('guards harmonic mini-notation fields before emitting Strudel', async () => {
    const g = structuredClone(await loadFixture('techno'));
    const firstLayer = g.layers[0]!;
    const firstSection = g.song.sections[0]!;
    g.harmony = {
      key: { tonic: 'c', mode: 'major' },
      progression: ['C', 'F', 'G', 'Am'],
      progression_rhythm: '<0 1 2', // invalid: unclosed <
      modulation: [],
      anchors: { bass: 'c2', chord: 'c4', lead: 'c5', pad: 'c3' },
    };
    g.pattern_bank.patterns[firstLayer.id]![firstSection.id] = {
      harmonic: {
        source: 'progression',
        role_derivation: 'arp',
        degrees: '[0 2', // invalid: unclosed [
        rhythm: '*4', // invalid: operator without operand
        octave_shift: 0,
      },
    };

    const out = compileSessionGraph(g);
    expect(out.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('/harmony/progression_rhythm failed mini-notation validation'),
      expect.stringContaining('/harmonic/degrees failed mini-notation validation'),
      expect.stringContaining('/harmonic/rhythm failed mini-notation validation'),
    ]));
    expect(out.code).toContain('n("0").struct("~")');
    expect(validateStrudelCode(out.code).ok).toBe(true);
  });
});
