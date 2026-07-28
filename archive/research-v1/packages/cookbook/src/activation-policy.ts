// G9C §6: per-genre / per-role activation policy. The producer no longer
// treats cookbook as globally on/off. The policy says, per (genre, role):
//
//   - whether the cookbook may serve patterns at all (`enabled`)
//   - whether mutation operators may run (`mutation_allowed`)
//   - whether accepted_with_warning entries are retrievable (`allow_warnings`)
//   - whether quarantine override is permitted (default no)
//
// Default policy is conservative: cookbook is enabled only for (genre, role)
// pairs where smoke-real has shown neutral or positive evidence. Anything
// else falls back to legacy behavior (which means
// `defaultPatternForRole` per the G9C bug-fix in build-graph).

export type ActivationLevel =
  | 'enabled_default'      // retrieval may serve this (genre, role)
  | 'enabled_with_warnings'// also retrieves accepted_with_warning entries
  | 'mutation_allowed'     // mutation operators may run
  | 'minimal_only';        // cookbook never serves; legacy default

export interface RoleActivationPolicy {
  level: ActivationLevel;
  /** Reason this policy was chosen; surfaced in trace + audit reports. */
  reason: string;
  /** Optional ceiling on how many entries may be selected per session. */
  max_picks_per_session?: number;
}

export type ActivationPolicy = {
  /**
   * Map keyed by `${genre}/${role}`. A missing key means the default policy
   * applies (which is `minimal_only` outside the explicit allow-list — safe
   * by default).
   */
  per_genre_role: Record<string, RoleActivationPolicy>;
  /** Default level applied when no key matches. */
  default_level: ActivationLevel;
  /** Default reason text when default_level applies. */
  default_reason: string;
};

/**
 * G9C default activation policy. Each entry below has empirical justification
 * derived from smoke-real / render-audit evidence captured 2026-05-10.
 *
 * Adding a new (genre, role) to enabled_default REQUIRES:
 *   1. that the cookbook has ≥ 1 accepted entry for that (genre, role)
 *   2. that smoke-real or a regression fixture demonstrates either neutral
 *      or positive impact for that (genre, role)
 *   3. a learning-ledger candidate or promotion entry justifying the move
 */
export const DEFAULT_POLICY: ActivationPolicy = {
  default_level: 'minimal_only',
  default_reason: 'no smoke-real evidence yet; producer falls back to defaultPatternForRole',
  per_genre_role: {
    // techno — smoke-real (2026-05-10) showed weak positive on full smoke
    // brief: severe_warnings 1→0, critic 4→3, nsr 0.766→0.814.
    'techno/kick': { level: 'enabled_default',
      reason: 'smoke-real 2026-05-10: weak-positive (sw 1→0)' },
    'techno/hat': { level: 'enabled_default',
      reason: 'smoke-real 2026-05-10: weak-positive companion to kick' },
    'techno/bass': { level: 'enabled_default',
      reason: 'smoke-real 2026-05-10: weak-positive companion' },
    'techno/mix_macro': { level: 'minimal_only',
      reason: 'mix_macro is config preset; not playable; needs separate integration' },

    // dub_techno — pre-existing render failure (smoke-real both modes
    // failed to produce a clean render). Cookbook is NOT to blame for the
    // failure, but we can't claim improvement without working renders.
    'dub_techno/kick': { level: 'minimal_only',
      reason: 'smoke-real 2026-05-10: both modes failed to render — diagnostic-only until pre-existing render bug repaired' },
    'dub_techno/chord_stab': { level: 'minimal_only',
      reason: 'same as dub_techno/kick' },
    'dub_techno/bass': { level: 'minimal_only', reason: 'same' },
    'dub_techno/hat': { level: 'minimal_only', reason: 'same' },

    // dnb — G9C fixed the silence regression. After fix, smoke-real shows
    // dnb identical between modes (gate pass, nsr=1.000). Cookbook is
    // safe but not yet shown to help; enable for kick/snare/bass where
    // entries exist; hat/pad fall through to defaults via the fixed
    // fallback chain.
    'dnb/kick': { level: 'enabled_default',
      reason: 'smoke-real 2026-05-10 post-G9C: neutral (gate pass identical to minimal)' },
    'dnb/clap_snare': { level: 'enabled_default',
      reason: 'smoke-real 2026-05-10 post-G9C: neutral' },
    'dnb/bass': { level: 'enabled_default',
      reason: 'smoke-real 2026-05-10 post-G9C: neutral' },

    // idm — both modes hit a pre-existing hard_fail (loop_fatigue or
    // similar) on the smoke brief. Cookbook is neither cause nor cure;
    // keep cookbook OFF for idm until idm itself passes minimal mode.
    'idm/kick': { level: 'minimal_only',
      reason: 'smoke-real 2026-05-10: both modes hit hard_fail; cookbook unrelated, do not activate' },
    'idm/perc': { level: 'minimal_only', reason: 'same' },

    // ambient — enabled mode adds severe_warnings (1→3) and critic issues
    // (1→3) without losing gate pass. Conservative: keep cookbook off
    // until we understand WHY enabled adds warnings.
    'ambient/pad_atmo': { level: 'minimal_only',
      reason: 'smoke-real 2026-05-10: enabled adds severe_warnings (1→3) without gate regression; needs investigation' },

    // house — no smoke-real evidence yet; default to minimal.
    'house/kick': { level: 'minimal_only',
      reason: 'no smoke-real evidence for house yet' },
  },
};

export function lookupActivation(
  policy: ActivationPolicy,
  genre: string,
  role: string,
): RoleActivationPolicy {
  const key = `${genre}/${role}`;
  const p = policy.per_genre_role[key];
  if (p) return p;
  return { level: policy.default_level, reason: policy.default_reason };
}

export function shouldUseCookbook(policy: ActivationPolicy, genre: string, role: string): boolean {
  const p = lookupActivation(policy, genre, role);
  return p.level === 'enabled_default'
      || p.level === 'enabled_with_warnings'
      || p.level === 'mutation_allowed';
}

export function shouldAllowWarnings(policy: ActivationPolicy, genre: string, role: string): boolean {
  const p = lookupActivation(policy, genre, role);
  return p.level === 'enabled_with_warnings' || p.level === 'mutation_allowed';
}

export function shouldAllowMutation(policy: ActivationPolicy, genre: string, role: string): boolean {
  const p = lookupActivation(policy, genre, role);
  return p.level === 'mutation_allowed';
}
