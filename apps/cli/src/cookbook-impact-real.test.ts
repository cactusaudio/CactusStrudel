// G11A audit-closeout (F): pin the smoke-real harness contract that the
// v2 audit fix relies on. Two pre-fix bugs:
//   - underscore-spelled briefs silently dropped (prompts_total under-counted)
//   - --seeds N was being treated as the seed VALUE, not "iterate N seeds"
// Both fixes added structural fields (dropped_briefs, seeds_per_prompt,
// per-row `seed`); these tests pin those properties as invariants so a
// future refactor can't silently re-introduce the same class of regression.
//
// We don't run the actual renderer here (Chromium-bound, ~minutes). Instead
// we assert on the report-shape contract by mocking @cactus/renderer and
// checking the orchestration emits the structural fields with the right
// arity.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the renderer + analyzer + master so the harness runs in milliseconds.
// We're testing orchestration, not rendering. Real-render coverage is the
// audit:cookbook-impact CLI itself, not a unit test.
vi.mock('@cactus/renderer', () => ({
  warmup: vi.fn(async () => undefined),
  shutdown: vi.fn(async () => undefined),
  render: vi.fn(async () => undefined),
}));
vi.mock('@cactus/analyzer', async (orig) => {
  const m = await orig() as Record<string, unknown>;
  return {
    ...m,
    analyzeWav: vi.fn(async () => ({
      loudness: { lufs_integrated: -10, true_peak_db: -1.5 },
      rhythmic: { onset_density: { low: 4, mid: 3, high: 5 }, grid_regularity: 0.9, syncopation_proxy: 0.1, bpm: 130, bpm_confidence: 0.9 },
      stereo: { width_low: 0.4, width_mid: 0.5, width_high: 0.6, mono_low_compliance: 0.95 },
      spectral: { centroid: 2000, rolloff: 5000, flatness: 0.12, flux: 0.5, mfcc_mean: [], mfcc_std: [], band_rms: { low: 0.3, mid: 0.25, high: 0.2 } },
    })),
    runQualityGates: vi.fn(async () => ({
      overall_pass: true, hard_fail_count: 0, severe_warning_count: 0,
      gates: [
        { name: 'lufs_target_distance', passed: true, value: 0.5, threshold: 2, severity: 0.1 },
        { name: 'true_peak', passed: true, value: -1.5, threshold: -1, severity: 0 },
        { name: 'non_silent_ratio', passed: true, value: 1.0, threshold: 0.5, severity: 0 },
      ],
    })),
  };
});
vi.mock('@cactus/mastering', () => ({
  masterTrack: vi.fn(async () => ({ appliedGainDb: 0 })),
}));

beforeEach(() => {
  delete process.env.CACTUS_COOKBOOK_MODE;
});

describe('audit:cookbook-impact-real contract (G11A closeout F)', () => {
  it('reports dropped_briefs as a first-class field — silent dropouts impossible', async () => {
    const { runRealRenderImpactAudit } = await import('./cookbook-impact-real.js');
    const r = await runRealRenderImpactAudit({
      suite: 'smoke-real', seeds: 1, genres: ['techno'],
      outDir: `/tmp/g11a-closeout-${Date.now()}`,
    });
    expect(r).toHaveProperty('dropped_briefs');
    expect(Array.isArray(r.dropped_briefs)).toBe(true);
    // Well-formed smoke briefs (verified by brief-parser-contract.test.ts) must drop nothing.
    expect(r.dropped_briefs).toEqual([]);
  });

  it('reports seeds_per_prompt and per-row seed when --seeds N is passed', async () => {
    const { runRealRenderImpactAudit } = await import('./cookbook-impact-real.js');
    const r = await runRealRenderImpactAudit({
      suite: 'smoke-real', seeds: 3, genres: ['techno'],
      outDir: `/tmp/g11a-closeout-seeds-${Date.now()}`,
    });
    expect(r.seeds_per_prompt).toBe(3);
    // 1 brief × 3 seeds × 2 modes = 6 rows
    expect(r.per_brief.length).toBe(1);
    expect(r.per_brief[0]!.rows.length).toBe(6);
    // Every row must carry a numeric seed; seeds 1, 2, 3 must each be present.
    const seedsPresent = new Set(r.per_brief[0]!.rows.map((row) => row.seed));
    expect(seedsPresent).toEqual(new Set([1, 2, 3]));
    // Every row must have seed as a real number, not undefined.
    for (const row of r.per_brief[0]!.rows) {
      expect(typeof row.seed).toBe('number');
    }
  });

  it('--seeds 1 still produces exactly 1 seed per (brief × mode)', async () => {
    const { runRealRenderImpactAudit } = await import('./cookbook-impact-real.js');
    const r = await runRealRenderImpactAudit({
      suite: 'smoke-real', seeds: 1, genres: ['techno'],
      outDir: `/tmp/g11a-closeout-1seed-${Date.now()}`,
    });
    expect(r.seeds_per_prompt).toBe(1);
    expect(r.per_brief[0]!.rows.length).toBe(2); // 1 seed × 2 modes
    expect(r.per_brief[0]!.rows[0]!.seed).toBe(1);
  });

  it('per_mode.prompts_total scales with seeds × briefs (not just briefs)', async () => {
    const { runRealRenderImpactAudit } = await import('./cookbook-impact-real.js');
    const r = await runRealRenderImpactAudit({
      suite: 'smoke-real', seeds: 3, genres: ['techno', 'dnb'],
      outDir: `/tmp/g11a-closeout-scale-${Date.now()}`,
    });
    // 2 briefs × 3 seeds = 6 prompts per mode
    for (const m of r.per_mode) {
      expect(m.prompts_total, `mode ${m.mode} should have 2×3=6 prompts`).toBe(6);
    }
  });
});
