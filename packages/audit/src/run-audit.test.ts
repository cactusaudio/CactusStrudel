import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runAudit } from './run-audit.js';

describe('runAudit (skipRender)', () => {
  it('runs the smoke suite and emits all 4 artifacts', async () => {
    const out = path.join(os.tmpdir(), `cactus-audit-smoke-${Date.now()}`);
    const r = await runAudit({ suite: 'smoke', seeds: 1, outDir: out, skipRender: true });
    expect(r.prompts_total).toBe(1);
    expect(await fs.stat(path.join(out, 'audit-report.md'))).toBeDefined();
    expect(await fs.stat(path.join(out, 'audit-summary.json'))).toBeDefined();
    expect(await fs.stat(path.join(out, 'genre-confusion.json'))).toBeDefined();
    expect(await fs.stat(path.join(out, 'champion-challenger.json'))).toBeDefined();
  }, 30_000);

  it('genre-core × 1 seed = 50 prompts, all classify into the failure taxonomy structure', async () => {
    const out = path.join(os.tmpdir(), `cactus-audit-gc-${Date.now()}`);
    const r = await runAudit({ suite: 'genre-core', seeds: 1, outDir: out, skipRender: true });
    expect(r.prompts_total).toBe(50);
    const summary = JSON.parse(await fs.readFile(path.join(out, 'audit-summary.json'), 'utf8'));
    expect(summary.suite).toBe('genre-core');
    expect(summary.prompts_total).toBe(50);
    expect(summary.champion_failures_by_category).toBeDefined();
  }, 60_000);
});
