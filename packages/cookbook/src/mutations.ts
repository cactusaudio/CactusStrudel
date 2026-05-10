// G9B §4: minimal mutation operators. Each operator is a pure function
// (entry, rng) → entry-or-null. Returns null when the operator can't safely
// apply to that entry. Mutations preserve genre / role / section
// compatibility / forbidden_constraints / mini_notation parseability.

import { CookbookEntrySchema, type CookbookEntry } from './schema.js';

export type MutationOperator =
  | 'density_up'
  | 'density_down'
  | 'rest_insert'
  | 'rest_remove'
  | 'gain_up'
  | 'gain_down'
  | 'filter_open'
  | 'filter_close'
  | 'reverb_up'
  | 'reverb_down'
  | 'chord_decay_short'
  | 'chord_decay_long'
  | 'break_simplify'
  | 'break_fragment';

export interface MutationResult {
  operator: MutationOperator;
  before: CookbookEntry;
  after: CookbookEntry;
  /** Short human-readable reason / change summary. */
  delta: string;
}

// ---------- mini-notation surgery helpers ----------

/** Tokenize a flat mini-notation string into bare cells preserving operators. */
function splitCells(code: string): string[] {
  return code.split(/\s+/).filter((s) => s.length > 0);
}

/** Try to add density: turn "bd ~ ~ ~" into "bd hh ~ hh", insert hits in rest cells. */
function densifyMini(mini: string, hit: string): string | null {
  const cells = splitCells(mini);
  // Replace every other rest cell with the hit token.
  let toggled = false;
  let changed = false;
  const out = cells.map((c) => {
    if (c === '~') {
      toggled = !toggled;
      if (toggled) {
        changed = true;
        return hit;
      }
    }
    return c;
  });
  return changed ? out.join(' ') : null;
}

/** Reduce density: replace half of the hits with rests. */
function thinMini(mini: string): string | null {
  const cells = splitCells(mini);
  const hitIdx: number[] = [];
  cells.forEach((c, i) => { if (c !== '~' && /^[a-zA-Z][a-zA-Z0-9]*$/.test(c)) hitIdx.push(i); });
  if (hitIdx.length < 4) return null; // need at least 4 hits to safely thin
  // Drop every other hit.
  const out = [...cells];
  for (let i = 1; i < hitIdx.length; i += 2) {
    out[hitIdx[i]!] = '~';
  }
  return out.join(' ');
}

function insertRestEvery(mini: string, modulo: number): string | null {
  const cells = splitCells(mini);
  if (cells.length < modulo) return null;
  const out: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    out.push(cells[i]!);
    if ((i + 1) % modulo === 0 && i < cells.length - 1) out.push('~');
  }
  return out.join(' ');
}

// ---------- mix-implication operators ----------

function adjustImpl<K extends keyof CookbookEntry['mix_implications']>(
  e: CookbookEntry,
  key: K,
  delta: number,
  clamp: [number, number],
): CookbookEntry | null {
  const cur = (e.mix_implications[key] as number | undefined) ?? null;
  if (cur === null) return null;
  const next = Math.max(clamp[0], Math.min(clamp[1], cur + delta));
  if (Math.abs(next - cur) < 0.001) return null;
  return {
    ...e,
    mix_implications: { ...e.mix_implications, [key]: next },
    id: `${e.id}__mut`,
  };
}

// ---------- per-operator implementations ----------

function densityUp(e: CookbookEntry, _rng: () => number): MutationResult | null {
  if (!e.mini_notation) return null;
  // Pick a hit token from the entry's existing tokens.
  const cells = splitCells(e.mini_notation);
  const firstHit = cells.find((c) => c !== '~' && /^[a-zA-Z][a-zA-Z0-9]*$/.test(c));
  if (!firstHit) return null;
  const next = densifyMini(e.mini_notation, firstHit);
  if (!next || next === e.mini_notation) return null;
  const after: CookbookEntry = { ...e, mini_notation: next, id: `${e.id}__density_up` };
  const valid = CookbookEntrySchema.safeParse(after);
  if (!valid.success) return null;
  return { operator: 'density_up', before: e, after, delta: `density up: ${e.mini_notation} → ${next}` };
}

function densityDown(e: CookbookEntry, _rng: () => number): MutationResult | null {
  if (!e.mini_notation) return null;
  const next = thinMini(e.mini_notation);
  if (!next || next === e.mini_notation) return null;
  // G9C guard: refuse a mutation that produces an all-rest pattern. Such a
  // pattern compiles to silence and would cause the same class of failure
  // the dnb regression had — silent layer that the analyzer sees as
  // non_silent_ratio=0.
  if (isAllRest(next)) return null;
  const after: CookbookEntry = { ...e, mini_notation: next, id: `${e.id}__density_down` };
  const valid = CookbookEntrySchema.safeParse(after);
  if (!valid.success) return null;
  return { operator: 'density_down', before: e, after, delta: `density down: ${e.mini_notation} → ${next}` };
}

/**
 * Returns true iff every cell in the pattern is a rest token.
 * Used as a mutation safety guard.
 */
export function isAllRest(mini: string): boolean {
  // Strip operators + digits; what remains should be only `~` tokens or empty.
  const cells = mini.replace(/[\[\]<>{}()*\d]/g, ' ').split(/\s+/).filter((c) => c.length > 0);
  if (cells.length === 0) return true;
  return cells.every((c) => c === '~');
}

function restInsert(e: CookbookEntry, _rng: () => number): MutationResult | null {
  if (!e.mini_notation) return null;
  const next = insertRestEvery(e.mini_notation, 4);
  if (!next || next === e.mini_notation) return null;
  const after: CookbookEntry = { ...e, mini_notation: next, id: `${e.id}__rest_insert` };
  const valid = CookbookEntrySchema.safeParse(after);
  if (!valid.success) return null;
  return { operator: 'rest_insert', before: e, after, delta: `rest insert: ${e.mini_notation} → ${next}` };
}

function gainUp(e: CookbookEntry, _rng: () => number): MutationResult | null {
  const delta = 1.5;
  const after = adjustImpl(e, 'prefers_orbit_gain_db', delta, [-12, +12]);
  if (!after) return null;
  return {
    operator: 'gain_up', before: e, after,
    delta: `gain +${delta} dB`,
  };
}

function gainDown(e: CookbookEntry, _rng: () => number): MutationResult | null {
  const delta = -1.5;
  const after = adjustImpl(e, 'prefers_orbit_gain_db', delta, [-12, +12]);
  if (!after) return null;
  return {
    operator: 'gain_down', before: e, after,
    delta: `gain ${delta} dB`,
  };
}

function reverbUp(e: CookbookEntry, _rng: () => number): MutationResult | null {
  const after = adjustImpl(e, 'prefers_room_send', +0.1, [0, 1]);
  if (!after) return null;
  return { operator: 'reverb_up', before: e, after, delta: 'room_send +0.1' };
}

function reverbDown(e: CookbookEntry, _rng: () => number): MutationResult | null {
  const after = adjustImpl(e, 'prefers_room_send', -0.1, [0, 1]);
  if (!after) return null;
  return { operator: 'reverb_down', before: e, after, delta: 'room_send -0.1' };
}

const OPERATORS: Record<MutationOperator, (e: CookbookEntry, rng: () => number) => MutationResult | null> = {
  density_up: densityUp,
  density_down: densityDown,
  rest_insert: restInsert,
  rest_remove: () => null, // not yet implemented — listed for interface stability
  gain_up: gainUp,
  gain_down: gainDown,
  filter_open: () => null,
  filter_close: () => null,
  reverb_up: reverbUp,
  reverb_down: reverbDown,
  chord_decay_short: () => null,
  chord_decay_long: () => null,
  break_simplify: () => null,
  break_fragment: () => null,
};

export function listMutationOperators(): MutationOperator[] {
  return Object.keys(OPERATORS) as MutationOperator[];
}

/** Try one mutation. Returns null if the operator can't apply. */
export function applyMutation(e: CookbookEntry, op: MutationOperator, rng: () => number = Math.random): MutationResult | null {
  const fn = OPERATORS[op];
  if (!fn) return null;
  return fn(e, rng);
}

/**
 * Try a list of operators in order until one succeeds. Returns the first
 * successful mutation, or null if none apply.
 */
export function tryMutate(e: CookbookEntry, candidates: MutationOperator[], rng: () => number = Math.random): MutationResult | null {
  for (const op of candidates) {
    const r = applyMutation(e, op, rng);
    if (r) return r;
  }
  return null;
}
