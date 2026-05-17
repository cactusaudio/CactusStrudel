// Gap2 (genre honesty): single source of truth for genre maturity.
//
// Before this, "which genres work" was scattered across CLAUDE.md (all 6
// listed with equal billing), activation-policy.ts (per-(genre,role)
// reasons), and prose in reports. That let the product surface imply
// "6-genre producer" when the evidence said "techno + dnb production-grade,
// the rest experimental or broken". This module is the ONE place every
// consumer (producer, CLI `genres` listing, studio-UI, docs generator)
// reads from. A tier change here is a single, reviewable, evidence-cited
// edit — not a scattered claim.
//
// Tier policy:
//   production    — renders + passes quality gates reliably across seeds;
//                   safe to present as a first-class capability.
//   experimental  — renders, but fails gates on some seeds OR adds
//                   warnings OR has unproven cookbook value. Usable, but
//                   the UI / CLI must label it experimental.
//   diagnostic    — known-broken (fails gates on every seed). Kept for
//                   regression tracking; NOT presented as a capability.
//   untested      — no smoke-real evidence captured yet.

export type GenreTier = 'production' | 'experimental' | 'diagnostic' | 'untested';

export interface GenreMaturity {
  slug: string;
  tier: GenreTier;
  /** One-line evidence statement. Must cite an audit, not an opinion. */
  evidence: string;
  /** The audit run (timestamp dir) or commit that justifies this tier. */
  evidence_source: string;
  /** Concrete next blocker to promote the genre, or null if production. */
  next_blocker: string | null;
}

/**
 * Evidence-cited maturity table. Updated only with a fresh smoke-real run
 * referenced in `evidence_source`.
 *
 * IMPORTANT — Gap1 reframing: pre-Gap1, idm appeared 0/3 and dub_techno
 * 2/3 "broken". That was a MEASUREMENT ARTIFACT, not reality: the old
 * non_silent_ratio gate hard-failed intentionally-sparse genres for being
 * sparse (hard binary threshold + render-noise flap). After Gap1 (gate is
 * noise-immune + the hard_fail tier means "renderer broke", not "music is
 * sparse"), the post-Gap1 smoke-real --seeds 3 run shows **30/30 pass,
 * 0 hard failures, all 5 core genres 3/3 both modes**. The honest tiering
 * is therefore far better than the pre-Gap1 pessimism. Fixing the truth
 * layer didn't just stabilize verdicts — it revealed that two genres
 * about to be labelled diagnostic/experimental were never broken.
 */
export const GENRE_MATURITY: Record<string, GenreMaturity> = {
  techno: {
    slug: 'techno',
    tier: 'production',
    evidence: 'post-Gap1 smoke-real --seeds 3: 3/3 gate pass both modes; cookbook reduces critic issues',
    evidence_source: 'smoke-real 2026-05-17 (audit dir 2026-05-17T01-56)',
    next_blocker: null,
  },
  dnb: {
    slug: 'dnb',
    tier: 'production',
    evidence: 'post-Gap1 smoke-real --seeds 3: 3/3 gate pass both modes; G9C silence fix holds across all seeds',
    evidence_source: 'G9C + smoke-real 2026-05-17',
    next_blocker: null,
  },
  dub_techno: {
    slug: 'dub_techno',
    tier: 'production',
    evidence: 'post-Gap1 smoke-real --seeds 3: 3/3 gate pass both modes. Pre-Gap1 "2/3 broken" was a brittle-gate artifact — dub_techno is intentionally sparse, not broken; Gap1 reclassified sparse as calibration_warning',
    evidence_source: 'Gap1 commit + smoke-real 2026-05-17',
    next_blocker: null,
  },
  idm: {
    slug: 'idm',
    tier: 'production',
    evidence: 'post-Gap1 smoke-real --seeds 3: 3/3 gate pass both modes. Pre-Gap1 "0/3 hard_fail" was the SAME brittle-gate artifact — idm asymmetric/sparse content was being silence-failed; it renders fine and passes the noise-immune gate',
    evidence_source: 'Gap1 commit + smoke-real 2026-05-17',
    next_blocker: null,
  },
  ambient: {
    slug: 'ambient',
    tier: 'production',
    evidence: 'post-Gap1 smoke-real --seeds 3: 3/3 gate pass both modes. Sparse pad content now correctly calibration_warning, not hard_fail',
    evidence_source: 'Gap1 commit + smoke-real 2026-05-17',
    next_blocker: null,
  },
  house: {
    slug: 'house',
    tier: 'untested',
    evidence: 'not included in the smoke-real brief set; no captured evidence either way',
    evidence_source: '—',
    next_blocker: 'add a house brief to smoke-real and classify with the noise-immune gate',
  },
};

export function genreMaturity(slug: string): GenreMaturity {
  return GENRE_MATURITY[slug] ?? {
    slug, tier: 'untested',
    evidence: 'not in the maturity registry',
    evidence_source: '—',
    next_blocker: `add ${slug} to GENRE_MATURITY with audit evidence`,
  };
}

/** Genres safe to present as first-class capabilities. */
export function productionGenres(): string[] {
  return Object.values(GENRE_MATURITY)
    .filter((g) => g.tier === 'production')
    .map((g) => g.slug)
    .sort();
}

export function isProductionGrade(slug: string): boolean {
  return genreMaturity(slug).tier === 'production';
}

/** Human-readable one-liner for the CLI / UI to label a genre honestly. */
export function maturityLabel(slug: string): string {
  const m = genreMaturity(slug);
  return m.tier === 'production'
    ? slug
    : `${slug} [${m.tier}]`;
}
