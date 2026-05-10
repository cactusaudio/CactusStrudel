// G9 §8: A/B audit comparing cookbook variants. The producer's
// retrieval is gated by an env flag (CACTUS_COOKBOOK_MODE) so an
// audit run can fairly evaluate:
//
//   - 'minimal' : cookbook returns nothing (baseline)
//   - 'enabled' : cookbook retrieval enabled (default)
//   - 'mutated' : enabled + mutation operators
//   - 'hybrid'  : enabled + dispatcher (only if CACTUS_CLAUDE_DISPATCHER set)
//
// For each variant we run a short prompt suite and gather:
//   - gate pass rate
//   - genre top1/top3 (heuristic — when we have a confusion matrix)
//   - render/analyzer failures
//   - revision locality (if revise pass run)
//   - critic issue count
//   - diversity within variant: mean pairwise n-gram overlap on compiled code
//
// Acceptance: cookbook variants must MEASURABLY improve OR PRESERVE quality
// without reducing diversity. The output is honest — variants that don't help
// are reported as such, not silently weighted.

export type CookbookMode = 'minimal' | 'enabled' | 'enabled_mutating' | 'mutated' | 'hybrid';

export interface CookbookImpactRunSummary {
  mode: CookbookMode;
  prompts_total: number;
  rendered: number;
  render_failures: number;
  analyzer_failures: number;
  gate_pass: number;
  gate_fail: number;
  /** Fraction of prompts where genre top-1 inferred matches intent. Undefined when not measured. */
  genre_top1?: number;
  /** Mean weighted score across critic outputs. */
  weighted_score_mean?: number;
  /** Mean pairwise n-gram overlap of the compiled code (proxy for diversity — lower is better). */
  diversity_mean_overlap?: number;
  /** Issue count from the critic per prompt, summed. */
  critic_issue_count: number;
}

export interface CookbookImpactReport {
  suite: string;
  seeds: number;
  modes: CookbookMode[];
  per_mode: CookbookImpactRunSummary[];
  /** Verdict pulled from the comparison. */
  verdict:
    | 'cookbook_improves_quality'
    | 'cookbook_neutral_preserves_diversity'
    | 'cookbook_neutral_diversity_drop'
    | 'cookbook_regresses_quality'
    | 'inconclusive';
  notes: string[];
  ts: string;
}

/**
 * G9C §9: blame-aware verdict subclass. The runner can take a generic
 * negative verdict and refine it to one of these based on which prompts
 * regressed and which cookbook entries were involved.
 */
export type DetailedRegressionVerdict =
  | 'cookbook_negative_regression_due_to_entry'
  | 'cookbook_negative_regression_due_to_integration'
  | 'cookbook_negative_regression_due_to_mutation'
  | 'cookbook_negative_regression_due_to_existing_genre_failure';

export interface DetailedVerdict {
  base_verdict: CookbookImpactReport['verdict'] | 'cookbook_inconclusive_insufficient_signal';
  detailed_verdict?: DetailedRegressionVerdict;
  regressions_by_genre: Record<string, number>;
  positive_cases: Array<{ genre: string; metric: string; minimal: number; enabled: number }>;
  pre_existing_failures: string[];
  unrelated_failures: string[];
  suspected_entries: string[];
  quarantined_entries: string[];
}

/**
 * Pure-data verdict computation. Given per-mode summaries, return the verdict
 * + supporting notes. The runner provides this as the canonical reasoning
 * step so it's testable independently of orchestration.
 */
export function decideVerdict(
  per_mode: CookbookImpactRunSummary[],
): { verdict: CookbookImpactReport['verdict']; notes: string[] } {
  const notes: string[] = [];
  const minimal = per_mode.find((m) => m.mode === 'minimal');
  const enabled = per_mode.find((m) => m.mode === 'enabled');
  if (!minimal || !enabled) {
    return { verdict: 'inconclusive', notes: ['need both minimal + enabled to draw a verdict'] };
  }
  const passRateA = minimal.prompts_total === 0 ? 0 : minimal.gate_pass / minimal.prompts_total;
  const passRateB = enabled.prompts_total === 0 ? 0 : enabled.gate_pass / enabled.prompts_total;
  notes.push(`gate pass rate: minimal=${passRateA.toFixed(2)} enabled=${passRateB.toFixed(2)}`);
  const passDelta = passRateB - passRateA;
  const divA = minimal.diversity_mean_overlap;
  const divB = enabled.diversity_mean_overlap;
  if (divA !== undefined && divB !== undefined) {
    notes.push(`diversity mean overlap: minimal=${divA.toFixed(3)} enabled=${divB.toFixed(3)} (lower=more diverse)`);
  }

  if (passDelta < -0.05) {
    return { verdict: 'cookbook_regresses_quality', notes };
  }
  if (divA !== undefined && divB !== undefined && divB > divA + 0.10) {
    notes.push('diversity dropped >0.10 when enabling cookbook — sign of template collapse');
    return { verdict: 'cookbook_neutral_diversity_drop', notes };
  }
  if (passDelta >= 0.05) {
    return { verdict: 'cookbook_improves_quality', notes };
  }
  return { verdict: 'cookbook_neutral_preserves_diversity', notes };
}
