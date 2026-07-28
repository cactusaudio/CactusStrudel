// Revision locality scoring. Measures how surgical a revision was: did it touch
// only the requested paths, or did it drift into unrelated subgraphs?
// Drives the `revision_drift` failure taxonomy bucket.

import { parsePointer } from '@cactus/ir';
import type { SessionGraph } from '@cactus/ir';

export interface LocalityInput {
  /** Graph state before the revision pass. */
  before: SessionGraph;
  /** Graph state after the revision pass. */
  after: SessionGraph;
  /** Paths the user (or planner) asked the revision to address. */
  requested_paths: string[];
  /** Brief constraints that must remain unchanged regardless of the revision. */
  invariants?: Array<{ path: string; description: string }>;
  /**
   * Paths (or path prefixes) considered housekeeping — excluded from the
   * locality calculation entirely. Use for things the revise loop bumps
   * unconditionally (e.g. `/preference_graph` weight + decision log writes).
   * Default: empty (no exclusions).
   */
  ignored_path_prefixes?: string[];
}

export interface LocalityResult {
  changed_paths: string[];
  requested_paths: string[];
  unrelated_change_ratio: number;
  target_changed_count: number;
  unrelated_changed_count: number;
  invariant_violations: Array<{ path: string; description: string; before: unknown; after: unknown }>;
  drift_severity: number; // 0..1
}

/**
 * Score how local a revision was.
 * Returns:
 * - changed_paths: list of all leaf paths whose values changed
 * - unrelated_change_ratio: fraction of changed paths NOT in (or under) requested_paths
 * - invariant_violations: paths the planner promised would not change but did
 * - drift_severity: 0 if perfectly local, 1 if every change is unrelated AND invariants broken
 */
export function scoreRevisionLocality(input: LocalityInput): LocalityResult {
  const allChanged = diffPaths(input.before, input.after);
  const ignored = input.ignored_path_prefixes ?? [];
  const changed = ignored.length === 0
    ? allChanged
    : allChanged.filter((p) => !ignored.some((pre) => p === pre || p.startsWith(pre + '/')));
  // A change is "related" if its path equals or descends from any requested path,
  // OR if the requested path equals or descends from it (parent edits cover children).
  const requested = input.requested_paths;
  const related = changed.filter((c) => requested.some((r) => isRelatedPath(c, r)));
  const unrelated = changed.filter((c) => !requested.some((r) => isRelatedPath(c, r)));

  const invariant_violations: LocalityResult['invariant_violations'] = [];
  for (const inv of input.invariants ?? []) {
    const a = getAtPath(input.before, inv.path);
    const b = getAtPath(input.after, inv.path);
    if (!deepEqual(a, b)) {
      invariant_violations.push({ path: inv.path, description: inv.description, before: a, after: b });
    }
  }

  const ratio = changed.length === 0 ? 0 : unrelated.length / changed.length;
  // Drift severity: weight unrelated ratio + invariant violations.
  const violationFactor = invariant_violations.length === 0 ? 0 : Math.min(1, invariant_violations.length / 3);
  const drift = Math.min(1, ratio * 0.7 + violationFactor * 0.3);

  return {
    changed_paths: changed,
    requested_paths: requested,
    unrelated_change_ratio: ratio,
    target_changed_count: related.length,
    unrelated_changed_count: unrelated.length,
    invariant_violations,
    drift_severity: drift,
  };
}

function isRelatedPath(changed: string, requested: string): boolean {
  if (changed === requested) return true;
  if (changed.startsWith(requested + '/')) return true; // changed is descendant of requested
  if (requested.startsWith(changed + '/')) return true; // requested is descendant of changed
  return false;
}

function diffPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (deepEqual(before, after)) return [];
  if (typeof before !== 'object' || before === null ||
      typeof after !== 'object' || after === null) {
    return [prefix || '/'];
  }
  if (Array.isArray(before) !== Array.isArray(after)) return [prefix || '/'];
  const out: string[] = [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i++) {
      const childPrefix = `${prefix}/${i}`;
      out.push(...diffPaths(before[i], after[i], childPrefix));
    }
    return out;
  }
  const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
  for (const k of keys) {
    const childPrefix = `${prefix}/${escapePointerToken(k)}`;
    out.push(...diffPaths(
      (before as Record<string, unknown>)[k],
      (after as Record<string, unknown>)[k],
      childPrefix,
    ));
  }
  return out;
}

function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function getAtPath(obj: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return obj;
  const tokens = parsePointer(pointer);
  let cur: unknown = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(t)];
    else if (typeof cur === 'object') cur = (cur as Record<string, unknown>)[t];
    else return undefined;
  }
  return cur;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}
