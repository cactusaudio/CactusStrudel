// G9 §4: typed cookbook retrieval. Caller declares what they're looking for
// (genre, role, section, energy, sound-palette tags, BPM); retrieval returns
// a ranked list of compatible entries. Diversity-aware: when called with a
// PRNG seed and a "seen" set, the same caller across calls won't return the
// same entry twice unless asked.

import type { CookbookEntry, EnergyBand, Role, SectionFunction, SoundPaletteTag } from './schema.js';

export interface RetrieveQuery {
  genre: string;
  role: Role;
  /** Section function the entry will be used in. */
  section?: SectionFunction;
  /** One or more energy bands. Entry must overlap at least one. */
  energy?: EnergyBand[];
  /** Sound-palette tags the caller wants — ranking adds 1 point per matching tag. */
  prefer_tags?: SoundPaletteTag[];
  /** Sound-palette tags that disqualify a snippet. */
  forbid_tags?: SoundPaletteTag[];
  /** BPM the entry will be played at. Filtered by entry.bpm_range. */
  bpm?: number;
  /** Layers already present in the arrangement. Used to satisfy required_layers. */
  available_layers?: Role[];
  /** Already-picked entry IDs. Retrieval avoids them when alternatives exist. */
  seen_ids?: string[];
  /**
   * If true, don't filter by validation_status — return diagnostic /
   * experimental entries too. Default false (production-only).
   */
  include_diagnostic?: boolean;
  /**
   * G9C: opt-in to retrieve `accepted_with_warning` entries. Default false
   * (warnings not surfaced in default `enabled` mode).
   */
  allow_warnings?: boolean;
}

/**
 * Validation states that disqualify an entry from default-mode retrieval.
 * `enabled` mode hides these unless the caller explicitly opts in via
 * `include_diagnostic` (for unvalidated/candidate/diagnostic/experimental)
 * or `allow_warnings` (for accepted_with_warning).
 */
const HARD_EXCLUDE: ReadonlySet<string> = new Set([
  'quarantined',
  'rejected',
]);
const DIAGNOSTIC_GATED: ReadonlySet<string> = new Set([
  'unvalidated',
  'candidate',
  'diagnostic',
  'experimental',
]);
const WARNING_GATED: ReadonlySet<string> = new Set([
  'accepted_with_warning',
]);

export interface RetrieveResult {
  entry: CookbookEntry;
  score: number;
  /** Why this score — useful for explain / debugging. */
  rationale: string[];
}

/**
 * Score every candidate against the query and return them sorted (best first).
 * Returns `[]` if nothing matches.
 *
 * Hard filters (entry excluded if violated):
 *   - genre mismatch
 *   - role mismatch
 *   - section in incompatible_sections
 *   - BPM out of range
 *   - validation_status in {diagnostic, experimental} when include_diagnostic=false
 *   - any sound_palette tag in forbid_tags
 *   - required_layers ⊄ available_layers (when available_layers is supplied)
 *
 * Score components (additive):
 *   +3 if section in compatible_sections (when section supplied)
 *   +2 if any energy_range entry overlaps query energy
 *   +1 per matching prefer_tag
 *   +1 if validation_status is feature_match or render_smoke_passed
 *   +0.5 if validation_status is validator_passed
 *   -10 if id ∈ seen_ids (penalty, not exclusion — fall back if no others)
 */
export function retrieve(entries: CookbookEntry[], q: RetrieveQuery): RetrieveResult[] {
  const seen = new Set(q.seen_ids ?? []);
  const out: RetrieveResult[] = [];
  for (const e of entries) {
    if (e.genre !== q.genre || e.role !== q.role) continue;
    if (q.section && e.incompatible_sections.includes(q.section)) continue;
    if (q.bpm !== undefined) {
      const [lo, hi] = e.bpm_range;
      if (q.bpm < lo - 5 || q.bpm > hi + 5) continue;
    }
    // G9C: hard-exclude quarantined / rejected always.
    if (HARD_EXCLUDE.has(e.validation_status)) continue;
    // diagnostic + experimental gated unless caller opts in.
    if (DIAGNOSTIC_GATED.has(e.validation_status) && !q.include_diagnostic) continue;
    // accepted_with_warning gated unless caller opts in.
    if (WARNING_GATED.has(e.validation_status) && !q.allow_warnings) continue;
    if (q.forbid_tags && q.forbid_tags.length > 0) {
      if (e.sound_palette_tags.some((t: SoundPaletteTag) => q.forbid_tags!.includes(t))) continue;
    }
    if (q.available_layers) {
      const have = new Set(q.available_layers);
      const missing = e.required_layers.filter((r: Role) => !have.has(r));
      if (missing.length > 0) continue;
    }

    let score = 0;
    const rationale: string[] = [];
    if (q.section && e.compatible_sections.includes(q.section)) {
      score += 3;
      rationale.push(`section:${q.section} compatible (+3)`);
    }
    if (q.energy && q.energy.length > 0) {
      const overlap = e.energy_range.filter((b: EnergyBand) => q.energy!.includes(b));
      if (overlap.length > 0) {
        score += 2;
        rationale.push(`energy:${overlap.join(',')} (+2)`);
      } else {
        // not a hard filter (entry might still be useful), but no bonus
      }
    }
    if (q.prefer_tags && q.prefer_tags.length > 0) {
      const matched = e.sound_palette_tags.filter((t: SoundPaletteTag) => q.prefer_tags!.includes(t));
      if (matched.length > 0) {
        score += matched.length;
        rationale.push(`tags:${matched.join(',')} (+${matched.length})`);
      }
    }
    switch (e.validation_status) {
      case 'feature_match':
      case 'render_smoke_passed':
        score += 1;
        rationale.push(`validated:${e.validation_status} (+1)`);
        break;
      case 'validator_passed':
        score += 0.5;
        rationale.push(`validated:${e.validation_status} (+0.5)`);
        break;
      default: break;
    }
    if (seen.has(e.id)) {
      score -= 10;
      rationale.push(`already-seen (-10)`);
    }
    out.push({ entry: e, score, rationale });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Convenience: pick the top entry, or undefined if nothing matches. Honors
 * seen_ids — if the top candidate has been seen, the next-best unseen wins.
 */
export function pickOne(entries: CookbookEntry[], q: RetrieveQuery): CookbookEntry | undefined {
  const ranked = retrieve(entries, q);
  if (ranked.length === 0) return undefined;
  // First non-already-seen wins; if all seen, return top anyway.
  const seen = new Set(q.seen_ids ?? []);
  const fresh = ranked.find((r: RetrieveResult) => !seen.has(r.entry.id));
  return (fresh ?? ranked[0]!).entry;
}
