// Genre-aware arrangement coverage constraints. Each section function specifies
// which roles MUST be active and which roles are forbidden from being silent
// (for genres that should never have a fully empty intro, etc.).
//
// Applied post-build to repair the deterministic baseline's tendency to leave
// intros sparse-kick-only, which violated non_silent_ratio in Phase 14 smoke.

import type { Role, SectionFunction } from '@cactus/ir';

export interface SectionCoverage {
  /** Roles that MUST be active in any section with this function (if a layer of that role exists). */
  mandatory: Role[];
  /** Roles that SHOULD also be active when present, beyond the mandatory set. */
  recommended: Role[];
  /** Roles explicitly disallowed from this section function (use sparingly — usually for breakdown). */
  forbidden: Role[];
}

export interface GenreCoverageConstraints {
  /** Per-section-function coverage. */
  per_function: Partial<Record<SectionFunction, SectionCoverage>>;
  /** Default applied when section function has no explicit entry. */
  default: SectionCoverage;
  /** Brief constraints that override coverage (e.g. brief.constraints.no_kick = true). */
  honors_constraints: string[];
}

const TECHNO: GenreCoverageConstraints = {
  per_function: {
    intro:    { mandatory: ['kick'], recommended: ['hat', 'sub'],          forbidden: [] },
    build:    { mandatory: ['kick', 'hat'], recommended: ['bass'],          forbidden: [] },
    main:     { mandatory: ['kick', 'hat', 'bass'], recommended: ['chord'], forbidden: [] },
    drop:     { mandatory: ['kick', 'hat', 'bass'], recommended: ['chord'], forbidden: [] },
    breakdown:{ mandatory: ['hat'],            recommended: ['chord', 'pad'], forbidden: ['kick'] },
    outro:    { mandatory: ['kick'],           recommended: ['hat'],          forbidden: [] },
    transition:{mandatory: ['hat'],            recommended: ['chord'],         forbidden: [] },
  },
  default:   { mandatory: ['kick'], recommended: ['hat'], forbidden: [] },
  honors_constraints: ['no_kick', 'no_four_on_floor'],
};

const DUB_TECHNO: GenreCoverageConstraints = {
  per_function: {
    intro:    { mandatory: ['kick'], recommended: ['hat', 'chord', 'noise'], forbidden: [] },
    build:    { mandatory: ['kick', 'hat'], recommended: ['bass', 'chord'],   forbidden: [] },
    main:     { mandatory: ['kick', 'bass', 'chord'], recommended: ['hat'],   forbidden: [] },
    drop:     { mandatory: ['kick', 'bass', 'chord'], recommended: ['hat', 'noise'], forbidden: [] },
    breakdown:{ mandatory: ['chord'], recommended: ['hat', 'noise'],          forbidden: ['kick'] },
    outro:    { mandatory: ['chord'], recommended: ['noise'],                 forbidden: [] },
  },
  default:   { mandatory: ['kick', 'chord'], recommended: ['hat'], forbidden: [] },
  honors_constraints: ['no_kick'],
};

const DNB: GenreCoverageConstraints = {
  per_function: {
    intro:    { mandatory: ['hat'], recommended: ['kick', 'snare', 'fx'],     forbidden: [] },
    build:    { mandatory: ['kick', 'hat'], recommended: ['snare', 'bass'],    forbidden: [] },
    main:     { mandatory: ['kick', 'snare', 'bass'], recommended: ['hat', 'pad'], forbidden: [] },
    drop:     { mandatory: ['kick', 'snare', 'bass'], recommended: ['hat', 'pad'], forbidden: [] },
    breakdown:{ mandatory: ['pad'], recommended: ['fx', 'hat'],                forbidden: ['kick', 'snare'] },
    outro:    { mandatory: ['hat'], recommended: ['pad'],                      forbidden: [] },
  },
  default:   { mandatory: ['kick', 'snare', 'bass'], recommended: ['hat'], forbidden: [] },
  honors_constraints: ['no_kick'],
};

const IDM: GenreCoverageConstraints = {
  // IDM tolerates asymmetric activation. Coverage requires SOME percussive
  // signal in non-breakdown sections, but doesn't force kick presence.
  per_function: {
    intro:    { mandatory: [], recommended: ['kick', 'percussion', 'lead'],   forbidden: [] },
    main:     { mandatory: ['percussion'], recommended: ['kick', 'lead', 'bass'], forbidden: [] },
    drop:     { mandatory: ['kick', 'percussion'], recommended: ['bass', 'lead'], forbidden: [] },
    bridge:   { mandatory: ['percussion'], recommended: ['lead'],              forbidden: [] },
    outro:    { mandatory: [], recommended: ['percussion', 'lead'],            forbidden: [] },
  },
  default:   { mandatory: ['percussion'], recommended: ['kick', 'lead'], forbidden: [] },
  honors_constraints: ['no_kick', 'no_four_on_floor'],
};

const AMBIENT: GenreCoverageConstraints = {
  // Ambient is exempt from onset-heavy gates. Coverage demands at least one
  // pad/drone is always playing — true silence is the failure.
  per_function: {
    intro:    { mandatory: ['pad'], recommended: ['fx'], forbidden: ['kick', 'snare', 'hat'] },
    main:     { mandatory: ['pad'], recommended: ['fx'], forbidden: ['kick', 'snare', 'hat'] },
    drop:     { mandatory: ['pad'], recommended: ['fx'], forbidden: ['kick'] },
    outro:    { mandatory: ['pad'], recommended: [],     forbidden: ['kick', 'snare', 'hat'] },
  },
  default:   { mandatory: ['pad'], recommended: [], forbidden: [] },
  honors_constraints: ['no_kick', 'no_rhythmic_grid'],
};

const HOUSE: GenreCoverageConstraints = {
  per_function: {
    intro:    { mandatory: ['kick'], recommended: ['hat'], forbidden: [] },
    build:    { mandatory: ['kick', 'hat'], recommended: ['bass'], forbidden: [] },
    main:     { mandatory: ['kick', 'hat', 'bass'], recommended: ['chord'], forbidden: [] },
    drop:     { mandatory: ['kick', 'hat', 'bass'], recommended: ['chord'], forbidden: [] },
    breakdown:{ mandatory: ['chord'], recommended: ['hat'], forbidden: ['kick'] },
    outro:    { mandatory: ['kick'], recommended: ['hat'], forbidden: [] },
  },
  default:   { mandatory: ['kick'], recommended: ['hat'], forbidden: [] },
  honors_constraints: ['no_kick'],
};

const REGISTRY: Record<string, GenreCoverageConstraints> = {
  techno: TECHNO,
  dub_techno: DUB_TECHNO,
  dnb: DNB,
  idm: IDM,
  ambient: AMBIENT,
  house: HOUSE,
};

export function getCoverageConstraints(slug: string): GenreCoverageConstraints {
  return REGISTRY[slug] ?? TECHNO;
}
