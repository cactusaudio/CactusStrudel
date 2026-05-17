// P0 guard (2026-05-17): the harmonic-spine redesign compiles to
// scale/add/sub/struct/layer/superimpose/run/rootNotes/
// setDefaultVoicings/transpose/arp/ply (+ chord/voicing/anchor/mode).
// The auto-extractor only sees `register(Control)?(...)` calls so it
// silently dropped every @strudel/tonal `export const` and every
// Pattern-class method — that's why `scale` (used by 48% of the
// reference corpus) was missing and our output could never be
// harmonic.
//
// This test fails LOUDLY on two regressions:
//   1. a harmony-critical name is dropped from STRUDEL_FUNCTIONS
//   2. a name we whitelisted is NOT actually present in the installed
//      @strudel packages (i.e. we hallucinated a function)
// So a Strudel upgrade that renames one cannot silently re-break the
// harmonic compiler.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRUDEL_FUNCTIONS, TONAL_AND_COMBINATORS } from './registry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

// Names the harmony schema's compiled output depends on. chord/voicing/
// anchor/mode are covered by the auto-extracted REGISTRY_LIST; the rest
// are the hand-curated TONAL_AND_COMBINATORS supplement.
const HARMONY_CRITICAL = [
  'scale', 'chord', 'voicing', 'anchor', 'mode', 'transpose',
  'add', 'sub', 'struct', 'layer', 'superimpose', 'run',
  'rootNotes', 'setDefaultVoicings', 'arp', 'ply',
];

describe('P0: harmony-critical functions are whitelisted', () => {
  for (const fn of HARMONY_CRITICAL) {
    it(`'${fn}' is in STRUDEL_FUNCTIONS`, () => {
      expect(STRUDEL_FUNCTIONS.has(fn), `${fn} missing from validator registry — harmonic compiler output would be falsely rejected`).toBe(true);
    });
  }

  it('every HAND-CURATED harmony name is genuinely present in installed @strudel (no hallucinated functions)', () => {
    // Only cross-check the hand-curated supplement. Auto-extracted
    // REGISTRY_LIST names (chord/voicing/anchor/mode) exist by
    // construction — the extractor found them via register(...) in the
    // packages. Hallucination risk is only for names a human typed.
    const pnpm = path.join(ROOT, 'node_modules', '.pnpm');
    const missing: string[] = [];
    for (const fn of TONAL_AND_COMBINATORS) {
      const esc = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // export const/function NAME | register*('NAME' | Pattern.prototype.NAME = | a method `  NAME(...) {`
      const pat = `export (const|function) ${esc}\\b|register[A-Za-z]*\\(\\s*['\\"]${esc}['\\"]|prototype\\.${esc}\\s*=|^\\s*${esc}\\([^)]*\\)\\s*\\{`;
      const cmd = `find ${pnpm} -path '*@strudel*' -name '*.mjs' -print0 2>/dev/null | xargs -0 grep -lE "${pat}" 2>/dev/null | head -1`;
      const hit = execSync(cmd, { shell: '/bin/bash' }).toString().trim();
      if (!hit) missing.push(fn);
    }
    expect(missing, `whitelisted but NOT found in installed @strudel (hallucinated or renamed by an upgrade): ${missing.join(', ')}`).toEqual([]);
  });
});
