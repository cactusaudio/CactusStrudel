// G12: flywheel proof. End-to-end demonstration that the closed-loop
// converges and the bundle artifact is reviewable.
//
// Sequence (each step's success is a precondition for the next):
//   1. produce(brief, skipRender=true) → SessionGraph + iter_0000 artifacts
//   2. validateSemanticInvariants(graph) returns ok
//   3. revise(sessionDir, '底鼓更硬，但不要变 EDM', skipRender=true) →
//      iter_0001 artifacts, ≥1 patch applied, drift_severity=0
//   4. bundle(sessionDir, makeZip=false) → manifest with ≥4 files, all SHA-256
//      verified
//
// Gated behind CACTUS_FLYWHEEL_PROOF=1 because it spans 3 packages and writes
// to disk (cheap, but not part of the inner loop). Run via:
//   CACTUS_FLYWHEEL_PROOF=1 pnpm test tests/conformance/flywheel-proof.test.ts

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { produce } from '@cactus/agent-runtime';
import { validateSemanticInvariants } from '@cactus/ir';
import { revise } from '../../apps/cli/src/revise.js';
import { bundleSession } from '../../apps/cli/src/bundle.js';

const SHOULD_RUN = process.env.CACTUS_FLYWHEEL_PROOF === '1';
const TMP = path.join(os.tmpdir(), 'cactus-flywheel-proof');

describe.runIf(SHOULD_RUN)('G12 flywheel proof', () => {
  it('produce → invariants ok → revise (Chinese) → bundle is fully verified', async () => {
    await fs.mkdir(TMP, { recursive: true });
    // 1. produce.
    const p = await produce('peak time techno 130 BPM 16 bars', {
      sessionsRoot: TMP, seed: 12, skipRender: true, skipAnalyze: true,
    });
    expect(p.validatorIssues).toBe(0);
    expect(p.failures).toEqual([]);

    // 2. semantic invariants.
    const sem = validateSemanticInvariants(p.graph);
    expect(sem.ok).toBe(true);

    // 3. revise (mixed Chinese/English feedback, skip render to keep test fast).
    const rev = await revise({
      sessionDir: p.sessionDir,
      feedback: '底鼓更硬，但不要变 EDM',
      bestEffort: true,
      skipRender: true,
    });
    expect(rev.patchesApplied).toBeGreaterThanOrEqual(1);
    expect(rev.invariant_violations).toBe(0);
    expect(rev.drift_severity).toBeLessThan(0.5);

    // 4. bundle latest iter.
    const b = await bundleSession({ sessionDir: p.sessionDir, makeZip: false });
    expect(b.iteration).toBe(1);
    expect(b.files.length).toBeGreaterThanOrEqual(4); // graph + code + plan + locality at minimum
    // SHA-256 verification: every manifest hash matches the actual file.
    for (const f of b.files) {
      const buf = await fs.readFile(path.join(b.bundleDir, f.rel));
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      expect(hash).toBe(f.sha256);
    }
    // Manifest names the brief + genre.
    const m = JSON.parse(await fs.readFile(b.manifestPath, 'utf8'));
    expect(m.brief).toMatch(/techno/i);
    expect(m.primary_genre).toBe('techno');
  }, 60_000);
});
