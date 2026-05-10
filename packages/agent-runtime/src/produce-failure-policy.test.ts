// G2: failure-policy tests for produce(). Verifies:
// - render failure is fatal by default (throws)
// - render failure is non-fatal under bestEffort (returns with failures populated)
// - validator failure always throws (cannot be silenced)
// - skipRender path returns clean
//
// Renderer is mocked so the test never spins up Playwright/vite.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { produce } from './produce.js';

const TMP = path.join(os.tmpdir(), 'cactus-produce-failure-policy-tests');

beforeEach(async () => { await fs.mkdir(TMP, { recursive: true }); });
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

describe('produce — failure policy (G2)', () => {
  it('skipRender + skipAnalyze succeeds with empty failures array', async () => {
    const out = path.join(TMP, `skipboth-${Date.now()}`);
    const r = await produce('peak time techno 130 BPM, 10 seconds', {
      sessionsRoot: out, seed: 1, skipRender: true, skipAnalyze: true,
    });
    expect(r.failures).toEqual([]);
    expect(r.wavPath).toBeUndefined();
    expect(r.featuresPath).toBeUndefined();
    expect(r.compiledCode.length).toBeGreaterThan(50);
  });

  it('throws explicitly when render fails and bestEffort is false (default)', async () => {
    vi.doMock('@cactus/renderer', () => ({
      render: () => Promise.reject(new Error('mock: renderer unavailable')),
    }));
    // Re-import produce so the mock is picked up.
    const { produce: produceFresh } = await import('./produce.js?mock=fail-fatal');
    const out = path.join(TMP, `fatal-${Date.now()}`);
    await expect(
      produceFresh('peak time techno 130 BPM, 10 seconds', {
        sessionsRoot: out, seed: 2,
      }),
    ).rejects.toThrow(/render failed.*Pass bestEffort=true/);
  });

  it('returns with failures populated when render fails and bestEffort is true', async () => {
    vi.doMock('@cactus/renderer', () => ({
      render: () => Promise.reject(new Error('mock: renderer unavailable')),
    }));
    const { produce: produceFresh } = await import('./produce.js?mock=fail-best-effort');
    const out = path.join(TMP, `best-effort-${Date.now()}`);
    const r = await produceFresh('peak time techno 130 BPM, 10 seconds', {
      sessionsRoot: out, seed: 3, bestEffort: true,
    });
    expect(r.failures.length).toBeGreaterThan(0);
    expect(r.failures.some((f) => f.includes('render failed'))).toBe(true);
    expect(r.wavPath).toBeUndefined();
    // Report still written.
    const report = await fs.readFile(r.reportPath, 'utf8');
    expect(report).toContain('non-fatal failures');
  });

  it('analyze failure surfaces in failures array under bestEffort', async () => {
    // Make render succeed (write a tiny WAV file the analyzer will reject).
    vi.doMock('@cactus/renderer', () => ({
      render: async (input: { outputPath: string }) => {
        // Write a non-WAV file. analyzeWav will throw on parse.
        await fs.writeFile(input.outputPath, 'not-a-wav-file');
      },
    }));
    const { produce: produceFresh } = await import('./produce.js?mock=analyze-fail');
    const out = path.join(TMP, `analyze-fail-${Date.now()}`);
    const r = await produceFresh('peak time techno 130 BPM, 10 seconds', {
      sessionsRoot: out, seed: 4, bestEffort: true,
    });
    expect(r.failures.some((f) => f.includes('analyze failed'))).toBe(true);
  });

  it('throws when no genre is detectable from brief', async () => {
    await expect(
      produce('something nondescript without any keywords', {
        sessionsRoot: TMP, seed: 5, skipRender: true,
      }),
    ).rejects.toThrow(/primary_genre/);
  });
});
