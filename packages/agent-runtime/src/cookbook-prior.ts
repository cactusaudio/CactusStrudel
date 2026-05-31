// G9B §1: cookbook prior adapter. Wraps the v2 retrieval API and emits a
// trace event per pick so the producer can write
// sessions/<id>/cookbook-trace.json. Honors CACTUS_COOKBOOK_MODE:
//
//   minimal           — return undefined; caller should use the legacy path
//   enabled           — retrieve via v2 typed schema; no mutation
//   enabled_mutating  — retrieve + apply a safe mutation operator
//
// Mode is a process-env read because the audit runs subprocesses that must
// be A/B switchable without code changes.

import {
  loadCookbookEntries, retrieve, pickOne,
  shouldUseCookbook, shouldAllowMutation, shouldAllowWarnings,
  lookupActivation, DEFAULT_POLICY,
  type CookbookEntry, type Role as CookbookRole, type SectionFunction,
  type SoundPaletteTag, type EnergyBand,
  type ActivationPolicy, type RoleActivationPolicy,
} from '@cactus/cookbook';
import type { Role as IrRole } from '@cactus/ir';

export type CookbookMode = 'minimal' | 'enabled' | 'enabled_mutating';

export function getCookbookMode(): CookbookMode {
  const v = process.env.CACTUS_COOKBOOK_MODE;
  if (v === 'enabled') return 'enabled';
  if (v === 'enabled_mutating') return 'enabled_mutating';
  return 'minimal';
}

export interface CookbookTracePick {
  layer_id: string;
  layer_role: IrRole;
  section_id: string;
  section_function: string;
  cookbook_role: CookbookRole | null;
  query: {
    genre: string;
    role: CookbookRole;
    section: SectionFunction;
    energy: EnergyBand[];
    bpm: number;
    prefer_tags: SoundPaletteTag[];
    forbid_tags: SoundPaletteTag[];
    seen_ids: string[];
  };
  candidates_total: number;
  candidates_top_ids: string[];
  selected_id: string | null;
  selection_reason: string | null;
  mutation_applied: { operator: string; before: string; after: string } | null;
  fallback_reason?: string;
  /**
   * G9C blame attribution. When the producer assigns a pattern to a graph
   * path, this records which path got which pre/post values, so the audit
   * can correlate a hard failure back to a single cookbook entry.
   */
  blame?: {
    /** JSON Pointer of the path the pick wrote to (e.g. /pattern_bank/patterns/<layer>/<section>). */
    graph_path: string;
    /** Pattern token before this pick (legacy fallback) — null if no prior. */
    pre_value: string | null;
    /** Pattern token after this pick. */
    post_value: string;
    /** Compiled-code span (orbit number) the pick contributed to, when known. */
    contributes_to_orbit: number | null;
    /** Whether this pick is suspected of contributing to a hard failure. */
    suspected_in_hard_failure: boolean;
  };
}

export interface CookbookTrace {
  mode: CookbookMode;
  genre: string;
  bpm: number;
  picks: CookbookTracePick[];
  /** When mode=minimal we emit a single sentinel so the audit can confirm A/B. */
  baseline_only?: boolean;
}

/**
 * IR Role -> cookbook role mapping. Several IR roles share a cookbook role
 * (e.g. clap+snare both map to clap_snare; pad+chord both map to pad_atmo
 * for the ambient genre). Returns null for roles the cookbook doesn't yet
 * model (e.g. fx, riser, impact, lead, vocal, foley).
 */
export function mapIrRoleToCookbookRole(role: IrRole): CookbookRole | null {
  switch (role) {
    case 'kick': return 'kick';
    case 'hat': return 'hat';
    case 'snare':
    case 'clap':
    case 'rim': return 'clap_snare';
    case 'cymbal':
    case 'percussion': return 'perc';
    case 'bass':
    case 'sub': return 'bass';
    case 'chord': return 'chord_stab';
    case 'pad': return 'pad_atmo';
    case 'lead':
    case 'arp':
    case 'pluck': return 'lead_hook';
    case 'fx':
    case 'noise':
    case 'foley': return 'fx';
    case 'riser':
    case 'impact': return 'transition';
    default: return null;
  }
}

/** Coarse energy band from a 0..1 numeric energy value. */
export function energyToBand(energy: number): EnergyBand {
  if (energy < 0.35) return 'low';
  if (energy < 0.6) return 'mid';
  if (energy < 0.8) return 'high';
  return 'peak';
}

/** Map IR section function to cookbook section function (1:1 today). */
export function ifSection(fn: string): SectionFunction {
  // The IR enum is a strict superset of the cookbook enum.
  return fn as SectionFunction;
}

/**
 * Eval-only activation override (Bowei-approved 2026-05-17 via
 * CACTUS_KEYGEN_EVAL). Returns an augmented COPY of `policy` where
 * every (genre,role) holding ≥1 external_reference_transcription (keygen) entry
 * is forced to `enabled_default`, so the keygen ear-test render
 * actually exercises the corpus. DEFAULT_POLICY is NOT mutated. This
 * is provisional evidence-GATHERING (Bowei's ear is the verifier),
 * NOT a promotion — legitimate promotion goes through the §5 oracle
 * loop + a documented DEFAULT_POLICY entry. No-op unless the env flag
 * is set (zero impact on normal/production runs).
 */
export function applyKeygenEvalOverride(
  policy: ActivationPolicy,
  entries: CookbookEntry[],
): ActivationPolicy {
  const per: Record<string, RoleActivationPolicy> = { ...policy.per_genre_role };
  for (const e of entries) {
    if (e.source_type !== 'external_reference_transcription') continue;
    per[`${e.genre}/${e.role}`] = {
      level: 'enabled_default',
      reason: 'KEYGEN-EVAL PROVISIONAL (CACTUS_KEYGEN_EVAL) — unpromoted, NOT DEFAULT_POLICY; pending §5 oracle + Bowei ear verdict',
    };
  }
  return { ...policy, per_genre_role: per };
}

let cachedEntries: CookbookEntry[] | null = null;

export async function loadCookbookOnce(): Promise<CookbookEntry[]> {
  if (cachedEntries) return cachedEntries;
  const r = await loadCookbookEntries();
  cachedEntries = r.entries;
  return cachedEntries;
}

/** Reset the cache — for tests + audit subprocesses that switch modes mid-run. */
export function _resetCookbookCacheForTests(): void {
  cachedEntries = null;
}

export interface SelectPriorInput {
  genre: string;
  layer: { id: string; role: IrRole };
  section: { id: string; function: string; energy: number };
  bpm: number;
  /** Already-selected entry IDs (avoid re-picking the same one). */
  seen_ids?: string[];
  /** Optional caller-supplied tag preferences (from production-vocab matches). */
  prefer_tags?: SoundPaletteTag[];
  forbid_tags?: SoundPaletteTag[];
  /**
   * G9C: activation policy. When omitted, DEFAULT_POLICY is used. The
   * trace records `policy_decision` so audits can see why a (genre, role)
   * was or wasn't activated.
   */
  policy?: ActivationPolicy;
}

export interface SelectPriorResult {
  entry: CookbookEntry | null;
  trace: CookbookTracePick;
}

/**
 * Run a typed retrieval and produce a trace event. Returns
 * `entry: null` when the cookbook has nothing for this query (caller
 * falls back to the legacy / default path).
 */
export async function selectPrior(input: SelectPriorInput): Promise<SelectPriorResult> {
  const cookbookRole = mapIrRoleToCookbookRole(input.layer.role);
  const section = ifSection(input.section.function);
  const energy = [energyToBand(input.section.energy)];
  const baseTrace: CookbookTracePick = {
    layer_id: input.layer.id,
    layer_role: input.layer.role,
    section_id: input.section.id,
    section_function: input.section.function,
    cookbook_role: cookbookRole,
    query: {
      genre: input.genre,
      role: cookbookRole ?? ('kick' as CookbookRole), // placeholder — selected_id stays null
      section,
      energy,
      bpm: input.bpm,
      prefer_tags: input.prefer_tags ?? [],
      forbid_tags: input.forbid_tags ?? [],
      seen_ids: input.seen_ids ?? [],
    },
    candidates_total: 0,
    candidates_top_ids: [],
    selected_id: null,
    selection_reason: null,
    mutation_applied: null,
  };

  if (!cookbookRole) {
    return { entry: null, trace: { ...baseTrace, fallback_reason: 'role-not-modeled' } };
  }

  // G9C: activation policy gate — even if the cookbook has entries for this
  // (genre, role), the policy may say "not yet evidence-safe" and we fall
  // back to default behavior. Trace records the reason.
  let policy = input.policy ?? DEFAULT_POLICY;
  if (process.env.CACTUS_KEYGEN_EVAL) {
    policy = applyKeygenEvalOverride(policy, await loadCookbookOnce());
  }
  const lookup = lookupActivation(policy, input.genre, cookbookRole);
  if (!shouldUseCookbook(policy, input.genre, cookbookRole)) {
    return {
      entry: null,
      trace: {
        ...baseTrace,
        fallback_reason: `policy-disabled: ${lookup.reason}`,
      },
    };
  }
  const allowWarnings = shouldAllowWarnings(policy, input.genre, cookbookRole);

  const entries = await loadCookbookOnce();
  const ranked = retrieve(entries, {
    genre: input.genre,
    role: cookbookRole,
    section,
    energy,
    bpm: input.bpm,
    ...(input.prefer_tags ? { prefer_tags: input.prefer_tags } : {}),
    ...(input.forbid_tags ? { forbid_tags: input.forbid_tags } : {}),
    ...(input.seen_ids ? { seen_ids: input.seen_ids } : {}),
    ...(allowWarnings ? { allow_warnings: true } : {}),
  });

  if (ranked.length === 0) {
    return {
      entry: null,
      trace: { ...baseTrace, fallback_reason: 'no-cookbook-match' },
    };
  }

  const picked = pickOne(entries, {
    genre: input.genre, role: cookbookRole, section, energy, bpm: input.bpm,
    ...(input.prefer_tags ? { prefer_tags: input.prefer_tags } : {}),
    ...(input.forbid_tags ? { forbid_tags: input.forbid_tags } : {}),
    ...(input.seen_ids ? { seen_ids: input.seen_ids } : {}),
    ...(allowWarnings ? { allow_warnings: true } : {}),
  });

  if (!picked) {
    return { entry: null, trace: { ...baseTrace, fallback_reason: 'pickOne-empty' } };
  }

  const top = ranked[0]!;
  return {
    entry: picked,
    trace: {
      ...baseTrace,
      candidates_total: ranked.length,
      candidates_top_ids: ranked.slice(0, 5).map((r) => r.entry.id),
      selected_id: picked.id,
      selection_reason: top.entry.id === picked.id
        ? top.rationale.join('; ')
        : `picked (not top — top was already seen): ${top.rationale.join('; ')}`,
    },
  };
}
