// G9 §4 + §5 bridge: turn an aggregated production-vocab match into a
// cookbook RetrieveQuery. The producer / planner calls matchProductionVocab
// + aggregateMatches first, then this to lift those tags into a query.
//
// The vocab tags use the same vocabulary as the cookbook's
// SoundPaletteTagEnum, so the bridge is mostly a filter + cast.

import type { Role, SectionFunction, SoundPaletteTag } from './schema.js';
import type { RetrieveQuery } from './retrieval.js';
import { SoundPaletteTagEnum } from './schema.js';

/**
 * Filter free-form tags down to ones the cookbook actually understands.
 * Caller-supplied tags that don't match the closed enum are silently
 * dropped — the production-vocab map should keep its values inside the
 * enum, but this is a defensive layer.
 */
function filterTags(tags: string[]): SoundPaletteTag[] {
  const valid = new Set(SoundPaletteTagEnum.options as readonly string[]);
  return tags.filter((t): t is SoundPaletteTag => valid.has(t));
}

export interface VocabAggregateLike {
  prefer_tags: string[];
  forbid_tags: string[];
}

/**
 * Combine an aggregated vocab match into a RetrieveQuery.
 * Caller supplies genre/role/section/etc — vocab supplies prefer/forbid tags.
 */
export function buildQueryFromVocab(args: {
  genre: string;
  role: Role;
  section?: SectionFunction;
  bpm?: number;
  vocab?: VocabAggregateLike;
  /** Caller-extra prefer tags merged in. */
  extra_prefer_tags?: SoundPaletteTag[];
  seen_ids?: string[];
  available_layers?: Role[];
}): RetrieveQuery {
  const prefer = new Set<SoundPaletteTag>([
    ...(args.vocab ? filterTags(args.vocab.prefer_tags) : []),
    ...(args.extra_prefer_tags ?? []),
  ]);
  const forbid = new Set<SoundPaletteTag>(args.vocab ? filterTags(args.vocab.forbid_tags) : []);
  const out: RetrieveQuery = {
    genre: args.genre,
    role: args.role,
    ...(args.section ? { section: args.section } : {}),
    ...(args.bpm !== undefined ? { bpm: args.bpm } : {}),
    prefer_tags: Array.from(prefer),
    forbid_tags: Array.from(forbid),
    ...(args.seen_ids ? { seen_ids: args.seen_ids } : {}),
    ...(args.available_layers ? { available_layers: args.available_layers } : {}),
  };
  return out;
}
