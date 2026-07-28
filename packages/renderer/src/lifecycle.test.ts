// Bookkeeping checks only. They make no browser/render claim; one focused real
// render is the appropriate proof when the production lifecycle changes.

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('renderer lifecycle (no boot)', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('shutdown() is safe when nothing is open', async () => {
    const mod = await import('./index.js');
    mod._resetLifecycleStateForTests();
    await mod.shutdown();
    const s = mod._getLifecycleStateForTests();
    expect(s.hasHandle).toBe(false);
    expect(s.activeRenders).toBe(0);
    expect(s.userWarmed).toBe(false);
  });

  it('renderMany([]) resolves immediately without booting', async () => {
    const mod = await import('./index.js');
    mod._resetLifecycleStateForTests();
    const out = await mod.renderMany([]);
    expect(out).toEqual([]);
    const s = mod._getLifecycleStateForTests();
    expect(s.hasHandle).toBe(false);
  });

  it('exports the new lifecycle + batch + registry surface', async () => {
    const mod = await import('./index.js');
    expect(typeof mod.warmup).toBe('function');
    expect(typeof mod.shutdown).toBe('function');
    expect(typeof mod.renderMany).toBe('function');
    expect(typeof mod.getSampleRegistry).toBe('function');
    // Back-compat preserved.
    expect(typeof mod.render).toBe('function');
    expect(typeof mod.ensureRenderer).toBe('function');
    expect(typeof mod.releaseRenderer).toBe('function');
  });

  it('releaseRenderer below zero clamps to 0 instead of going negative', async () => {
    const mod = await import('./index.js');
    mod._resetLifecycleStateForTests();
    // Two extra releases should not put activeRenders at -2.
    await mod.releaseRenderer();
    await mod.releaseRenderer();
    expect(mod._getLifecycleStateForTests().activeRenders).toBe(0);
  });

  it('uses deterministic strictPort candidates without a pre-bind probe', async () => {
    const mod = await import('./index.js');
    expect(mod._candidatePortForTests(6000, 0)).toBe(6000);
    expect(mod._candidatePortForTests(6000, 1)).toBe(6037);
    expect(mod._candidatePortForTests(6000, 2)).toBe(6074);
  });
});
