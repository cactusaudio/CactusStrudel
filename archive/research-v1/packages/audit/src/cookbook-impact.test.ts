// G9 §8 + §11: cookbook impact verdict logic.

import { describe, it, expect } from 'vitest';
import { decideVerdict, type CookbookImpactRunSummary } from './cookbook-impact.js';

const baseSummary = (over: Partial<CookbookImpactRunSummary> = {}): CookbookImpactRunSummary => ({
  mode: 'enabled',
  prompts_total: 10, rendered: 10,
  render_failures: 0, analyzer_failures: 0,
  gate_pass: 8, gate_fail: 2,
  critic_issue_count: 0,
  ...over,
});

describe('cookbook-impact verdict (G9 §8)', () => {
  it('returns inconclusive when modes are missing', () => {
    const r = decideVerdict([]);
    expect(r.verdict).toBe('inconclusive');
  });

  it('returns improves when enabled gate-pass-rate beats minimal by ≥0.05', () => {
    const r = decideVerdict([
      baseSummary({ mode: 'minimal', gate_pass: 5, gate_fail: 5 }),  // 0.5
      baseSummary({ mode: 'enabled', gate_pass: 7, gate_fail: 3 }),  // 0.7
    ]);
    expect(r.verdict).toBe('cookbook_improves_quality');
  });

  it('returns regresses when enabled drops more than 0.05', () => {
    const r = decideVerdict([
      baseSummary({ mode: 'minimal', gate_pass: 8, gate_fail: 2 }),  // 0.8
      baseSummary({ mode: 'enabled', gate_pass: 5, gate_fail: 5 }),  // 0.5
    ]);
    expect(r.verdict).toBe('cookbook_regresses_quality');
  });

  it('returns neutral_preserves_diversity when no big delta and no diversity drop', () => {
    const r = decideVerdict([
      baseSummary({ mode: 'minimal', gate_pass: 8, gate_fail: 2, diversity_mean_overlap: 0.30 }),
      baseSummary({ mode: 'enabled', gate_pass: 8, gate_fail: 2, diversity_mean_overlap: 0.32 }),
    ]);
    expect(r.verdict).toBe('cookbook_neutral_preserves_diversity');
  });

  it('returns neutral_diversity_drop when overlap rises by more than 0.10 with no quality gain', () => {
    const r = decideVerdict([
      baseSummary({ mode: 'minimal', gate_pass: 8, gate_fail: 2, diversity_mean_overlap: 0.20 }),
      baseSummary({ mode: 'enabled', gate_pass: 8, gate_fail: 2, diversity_mean_overlap: 0.45 }),
    ]);
    expect(r.verdict).toBe('cookbook_neutral_diversity_drop');
  });

  it('the notes field carries the gate-pass-rate comparison verbatim', () => {
    const r = decideVerdict([
      baseSummary({ mode: 'minimal', gate_pass: 5, gate_fail: 5 }),
      baseSummary({ mode: 'enabled', gate_pass: 7, gate_fail: 3 }),
    ]);
    expect(r.notes.some((n) => /minimal=0\.50/.test(n))).toBe(true);
    expect(r.notes.some((n) => /enabled=0\.70/.test(n))).toBe(true);
  });
});

describe('Gap4: ceiling-aware verdict (post-Gap1 reality)', () => {
  it('at the gate ceiling it SAYS so instead of silently ignoring critic data', () => {
    const r = decideVerdict([
      baseSummary({ mode: 'minimal', gate_pass: 10, gate_fail: 0, critic_issue_count: 26 }),
      baseSummary({ mode: 'enabled', gate_pass: 10, gate_fail: 0, critic_issue_count: 24 }),
    ]);
    expect(r.notes.some((n) => /ceiling/.test(n))).toBe(true);
    expect(r.notes.some((n) => /critic issues\/prompt/.test(n))).toBe(true);
  });

  it('mild critic reduction at ceiling = neutral_preserves_diversity (honest: safe, not a lift)', () => {
    // The actual post-Gap1 smoke-real numbers: 26/10=2.60 vs 24/10=2.40, delta -0.20.
    const r = decideVerdict([
      baseSummary({ mode: 'minimal', gate_pass: 10, gate_fail: 0, critic_issue_count: 26 }),
      baseSummary({ mode: 'enabled', gate_pass: 10, gate_fail: 0, critic_issue_count: 24 }),
    ]);
    expect(r.verdict).toBe('cookbook_neutral_preserves_diversity');
    expect(r.notes.some((n) => /not a quality lift/.test(n))).toBe(true);
  });

  it('a MEANINGFUL critic reduction at ceiling (delta ≤ -0.5) earns improves_quality', () => {
    const r = decideVerdict([
      baseSummary({ mode: 'minimal', gate_pass: 10, gate_fail: 0, critic_issue_count: 40 }),
      baseSummary({ mode: 'enabled', gate_pass: 10, gate_fail: 0, critic_issue_count: 30 }), // 4.0 → 3.0
    ]);
    expect(r.verdict).toBe('cookbook_improves_quality');
  });

  it('increasing critic load at ceiling without a gate gain = regresses', () => {
    const r = decideVerdict([
      baseSummary({ mode: 'minimal', gate_pass: 10, gate_fail: 0, critic_issue_count: 20 }),
      baseSummary({ mode: 'enabled', gate_pass: 10, gate_fail: 0, critic_issue_count: 30 }), // 2.0 → 3.0
    ]);
    expect(r.verdict).toBe('cookbook_regresses_quality');
  });

  it('below the ceiling, gate-pass-rate is still the primary discriminant (unchanged)', () => {
    const r = decideVerdict([
      baseSummary({ mode: 'minimal', gate_pass: 5, gate_fail: 5, critic_issue_count: 50 }),
      baseSummary({ mode: 'enabled', gate_pass: 8, gate_fail: 2, critic_issue_count: 50 }),
    ]);
    expect(r.verdict).toBe('cookbook_improves_quality');
    expect(r.notes.some((n) => /ceiling/.test(n))).toBe(false);
  });
});
