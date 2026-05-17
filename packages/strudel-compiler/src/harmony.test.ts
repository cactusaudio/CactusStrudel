// Step 3 guard: harmony → Strudel emission (design doc §4 contract).
//
// The corpus study found "5首都难听爆了" had ONE root cause: no shared
// harmonic spine — pitched layers picked pitches independently so
// nothing was in the same key. This proves the compiler now derives
// every harmonic layer from the ONE progression, that the output is
// what §4 specifies, that it survives our own validator (the whole
// reason P0 existed), and that pre-harmony graphs are byte-identical.

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionGraphSchema, type SessionGraph } from '@cactus/ir';
import { validateStrudelCode } from '@cactus/strudel-validator';
import { compileSessionGraph } from './index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TECHNO = path.resolve(HERE, '..', '..', '..', 'tests', 'fixtures', 'session-graphs', 'techno.json');

async function rawTechno(): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(TECHNO, 'utf8'));
}

// Add a shared spine + attach a /harmonic derivation to every active
// pitched-layer pattern entry. `roleDeriv` lets each test pick the mode.
function harmonized(
  raw: Record<string, any>,
  bassDeriv: Record<string, unknown>,
  stabDeriv: Record<string, unknown>,
): SessionGraph {
  const g = JSON.parse(JSON.stringify(raw));
  g.schema_version = '1.1.0';
  g.harmony = {
    key: { tonic: 'a', mode: 'minor' },
    progression: ['Am', 'F', 'C', 'G'],
    progression_rhythm: '<0 1 2 3>/4',
    anchors: { bass: 'a1', chord: 'a3', lead: 'a4', pad: 'a3' },
  };
  for (const v of Object.keys(g.pattern_bank.patterns.bass)) {
    g.pattern_bank.patterns.bass[v].harmonic = bassDeriv;
  }
  for (const v of Object.keys(g.pattern_bank.patterns.stab)) {
    g.pattern_bank.patterns.stab[v].harmonic = stabDeriv;
  }
  return SessionGraphSchema.parse(g);
}

describe('harmony → Strudel (design §4)', () => {
  it('back-compat: no /harmony → no preamble, byte-identical', async () => {
    const raw = await rawTechno();
    const before = compileSessionGraph(SessionGraphSchema.parse(raw)).code;
    expect(before).not.toContain('setDefaultVoicings');
    // re-parse path used by harmonized() must not perturb the no-harmony case
    const again = compileSessionGraph(SessionGraphSchema.parse(JSON.parse(JSON.stringify(raw)))).code;
    expect(again).toBe(before);
  });

  it('emits the setDefaultVoicings("legacy") determinism preamble once', async () => {
    const g = harmonized(await rawTechno(),
      { source: 'progression', role_derivation: 'root' },
      { source: 'progression', role_derivation: 'chord_voiced' });
    const code = compileSessionGraph(g).code;
    expect(code.match(/setDefaultVoicings\("legacy"\)/g)).toHaveLength(1);
    expect(code.indexOf('setDefaultVoicings')).toBeLessThan(code.indexOf('stack('));
  });

  it('root → chord(prog).mode("root").anchor(bass).s(src)', async () => {
    const g = harmonized(await rawTechno(),
      { source: 'progression', role_derivation: 'root', octave_shift: -1 },
      { source: 'progression', role_derivation: 'chord_voiced' });
    const code = compileSessionGraph(g).code;
    expect(code).toContain('chord("<Am F C G>/4").mode("root").anchor("a1").s(');
  });

  it('chord_voiced → chord(prog).voicing().anchor(chord).s(src)', async () => {
    const g = harmonized(await rawTechno(),
      { source: 'progression', role_derivation: 'root' },
      { source: 'progression', role_derivation: 'chord_voiced' });
    const code = compileSessionGraph(g).code;
    expect(code).toContain('chord("<Am F C G>/4").voicing().anchor("a3").s(');
  });

  it('arp → n(degrees).struct(rhythm).chord(prog).voicing().s(src)', async () => {
    const g = harmonized(await rawTechno(),
      { source: 'progression', role_derivation: 'root' },
      { source: 'progression', role_derivation: 'arp', degrees: '<0 2 4 2>', rhythm: 'x ~ x x' });
    const code = compileSessionGraph(g).code;
    expect(code).toContain('n("<0 2 4 2>").struct("x ~ x x").chord("<Am F C G>/4").voicing().s(');
  });

  it('degree_line → n(degrees).chord(prog).voicing().add(oct*7).s(src)', async () => {
    const g = harmonized(await rawTechno(),
      { source: 'progression', role_derivation: 'root' },
      { source: 'progression', role_derivation: 'degree_line', degrees: '<0 1 [2 3] 4>', octave_shift: 1 });
    const code = compileSessionGraph(g).code;
    expect(code).toContain('n("<0 1 [2 3] 4>").chord("<Am F C G>/4").voicing().add(7).s(');
  });

  it('progression index expansion preserves @weight and /N', async () => {
    const raw = await rawTechno();
    raw.schema_version = '1.1.0';
    const g = JSON.parse(JSON.stringify(raw));
    g.harmony = {
      key: { tonic: 'a', mode: 'minor' },
      progression: ['Am', 'F', 'C', 'G'],
      progression_rhythm: '<0@2 1 3>/2',
    };
    for (const v of Object.keys(g.pattern_bank.patterns.stab)) {
      g.pattern_bank.patterns.stab[v].harmonic = { source: 'progression', role_derivation: 'chord_voiced' };
    }
    const code = compileSessionGraph(SessionGraphSchema.parse(g)).code;
    // @2 weight digit and /2 slow digit are NOT progression indices
    expect(code).toContain('chord("<Am@2 F G>/2")');
  });

  it('out-of-range index is modulo-clamped with a warning', async () => {
    const raw = await rawTechno();
    raw.schema_version = '1.1.0';
    const g = JSON.parse(JSON.stringify(raw));
    g.harmony = { key: { tonic: 'a', mode: 'minor' }, progression: ['Am', 'F'], progression_rhythm: '<0 5>/2' };
    for (const v of Object.keys(g.pattern_bank.patterns.stab)) {
      g.pattern_bank.patterns.stab[v].harmonic = { source: 'progression', role_derivation: 'chord_voiced' };
    }
    const out = compileSessionGraph(SessionGraphSchema.parse(g));
    expect(out.code).toContain('chord("<Am F>/2")'); // 5 % 2 == 1 → F
    expect(out.warnings.some((w) => /index 5 out of range/.test(w))).toBe(true);
  });

  it('compiled harmonic code passes the strudel validator (P0 closure)', async () => {
    for (const stab of [
      { source: 'progression', role_derivation: 'chord_voiced' },
      { source: 'progression', role_derivation: 'arp', degrees: '<0 2 4>', rhythm: 'x x x x' },
      { source: 'progression', role_derivation: 'degree_line', degrees: '<0 2 4 5>', octave_shift: 1 },
    ]) {
      const g = harmonized(await rawTechno(),
        { source: 'progression', role_derivation: 'root', octave_shift: -1 }, stab);
      const { code } = compileSessionGraph(g);
      const r = validateStrudelCode(code);
      if (!r.ok) console.error(`harmonic ${stab.role_derivation} validation:`, r.issues, '\n---\n', code);
      expect(r.ok).toBe(true);
    }
  });

  it('deterministic: same harmonized graph → byte-identical code', async () => {
    const raw = await rawTechno();
    const a = compileSessionGraph(harmonized(raw,
      { source: 'progression', role_derivation: 'root' },
      { source: 'progression', role_derivation: 'arp', degrees: '<0 2 4>', rhythm: 'x ~ x x' })).code;
    const b = compileSessionGraph(harmonized(raw,
      { source: 'progression', role_derivation: 'root' },
      { source: 'progression', role_derivation: 'arp', degrees: '<0 2 4>', rhythm: 'x ~ x x' })).code;
    expect(a).toBe(b);
  });

  it('harmonic outranks raw (committed precedence)', async () => {
    const raw = await rawTechno();
    raw.schema_version = '1.1.0';
    const g = JSON.parse(JSON.stringify(raw));
    g.harmony = { key: { tonic: 'a', mode: 'minor' }, progression: ['Am', 'F', 'C', 'G'] };
    // Unique sentinel — must NOT collide with any fixture pattern
    // (the techno kick legitimately is `s("bd*4")`).
    for (const v of Object.keys(g.pattern_bank.patterns.stab)) {
      g.pattern_bank.patterns.stab[v] = {
        raw: 's("RAW_SENTINEL_SHOULD_BE_BYPASSED")',
        harmonic: { source: 'progression', role_derivation: 'chord_voiced' },
      };
    }
    const code = compileSessionGraph(SessionGraphSchema.parse(g)).code;
    expect(code).toContain('chord("<Am>/1").voicing()'); // default rhythm <0>/1
    expect(code).not.toContain('RAW_SENTINEL_SHOULD_BE_BYPASSED');
  });
});
