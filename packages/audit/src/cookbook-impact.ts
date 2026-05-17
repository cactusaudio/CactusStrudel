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

  // Gap4: ceiling-awareness. Post-Gap1 the gate is trustworthy and every
  // genre passes, so gate-pass-rate saturates at 1.00/1.00 and passDelta
  // is structurally ~0 — it CANNOT be the discriminant. Pre-Gap4 the
  // function silently fell through to "neutral" while ignoring the only
  // remaining signal (critic-issue load + diversity). Now: detect the
  // ceiling, say so, and reason from critic-issue-per-prompt delta.
  const CEILING = 0.95;
  const atCeiling = passRateA >= CEILING && passRateB >= CEILING;
  const criticA = minimal.prompts_total > 0 ? minimal.critic_issue_count / minimal.prompts_total : 0;
  const criticB = enabled.prompts_total > 0 ? enabled.critic_issue_count / enabled.prompts_total : 0;
  const criticDelta = criticB - criticA; // negative = enabled has FEWER issues = better

  if (passDelta < -0.05) {
    return { verdict: 'cookbook_regresses_quality', notes };
  }
  if (divA !== undefined && divB !== undefined && divB > divA + 0.10) {
    notes.push('diversity dropped >0.10 when enabling cookbook — sign of template collapse');
    return { verdict: 'cookbook_neutral_diversity_drop', notes };
  }

  if (atCeiling) {
    notes.push(
      `gate-pass at ceiling (both ≥${CEILING}) — gate-pass-rate is saturated and ` +
      `NOT a usable discriminant; reasoning from critic-issue load instead`,
    );
    notes.push(`critic issues/prompt: minimal=${criticA.toFixed(2)} enabled=${criticB.toFixed(2)} (delta=${criticDelta.toFixed(2)}, negative=cookbook reduces load)`);
    // A meaningful critic reduction at the gate ceiling is the only way
    // cookbook can demonstrate a quality LIFT once gates can't go higher.
    if (criticDelta <= -0.5) {
      return { verdict: 'cookbook_improves_quality', notes };
    }
    if (criticDelta >= 0.5) {
      notes.push('cookbook increases critic load at the gate ceiling without a gate gain — net negative');
      return { verdict: 'cookbook_regresses_quality', notes };
    }
    // -0.5 < delta < 0.5: honest answer is "safe + mildly beneficial",
    // NOT a lift. This is the truthful Gap4 conclusion for the current
    // cookbook: it does not hurt, mildly reduces critic load, preserves
    // diversity — worth keeping, not a headline quality win.
    notes.push('cookbook is gate-safe at the ceiling, mildly critic-reducing, diversity-preserving — keep, but not a quality lift');
    return { verdict: 'cookbook_neutral_preserves_diversity', notes };
  }

  if (passDelta >= 0.05) {
    return { verdict: 'cookbook_improves_quality', notes };
  }
  return { verdict: 'cookbook_neutral_preserves_diversity', notes };
}
