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
