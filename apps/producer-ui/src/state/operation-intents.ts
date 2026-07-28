/** IDEM-001 client half: durable mutation intents that survive a browser
 * process restart.
 *
 * Every idempotent mutation persists its intent (key + request identity +
 * human summary) before the fetch. A definite server verdict clears it; an
 * unknown outcome (network death, 5xx, page/browser exit mid-flight) leaves
 * it stored. On the next boot, `reconcilePendingOperations` asks the server
 * for the exact prior outcome by idempotency key before the user can create
 * a duplicate durable operation.
 */

import type { OperationReadback } from '../contracts';

export interface StoredOperationIntent {
  key: string;
  kind: string;
  summary: string;
  request_identity: string;
  created_at: string;
}

const STORAGE_KEY = 'cactus-pending-operation-intents-v1';

export type IntentStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): IntentStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readAll(store: IntentStorage | undefined): StoredOperationIntent[] {
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StoredOperationIntent => (
      !!item && typeof item === 'object'
      && typeof (item as StoredOperationIntent).key === 'string'
    ));
  } catch {
    return [];
  }
}

function writeAll(
  store: IntentStorage | undefined,
  intents: StoredOperationIntent[],
): void {
  if (!store) return;
  try {
    // Bounded: an unbounded backlog would mean something is very wrong.
    store.setItem(STORAGE_KEY, JSON.stringify(intents.slice(-32)));
  } catch {
    // Persistence is best-effort; the server remains the durable truth.
  }
}

export function persistOperationIntent(
  intent: StoredOperationIntent,
  store: IntentStorage | undefined = defaultStorage(),
): void {
  const rest = readAll(store).filter((item) => item.key !== intent.key);
  writeAll(store, [...rest, intent]);
}

export function clearOperationIntent(
  key: string,
  store: IntentStorage | undefined = defaultStorage(),
): void {
  writeAll(store, readAll(store).filter((item) => item.key !== key));
}

export function pendingOperationIntents(
  store: IntentStorage | undefined = defaultStorage(),
): StoredOperationIntent[] {
  return readAll(store);
}

export interface ReconciledOperation {
  intent: StoredOperationIntent;
  readback: OperationReadback;
}

/** Resolve every stored intent against the server's operation readback.
 * Each intent is cleared once the server has answered definitively — found
 * (the operation committed; surface its outcome) or not found (it never
 * committed; safe to redo). Lookup failures keep the intent for next boot.
 */
export async function reconcilePendingOperations(
  lookup: (key: string) => Promise<OperationReadback>,
  store: IntentStorage | undefined = defaultStorage(),
): Promise<ReconciledOperation[]> {
  const results: ReconciledOperation[] = [];
  for (const intent of readAll(store)) {
    try {
      const readback = await lookup(intent.key);
      results.push({ intent, readback });
      clearOperationIntent(intent.key, store);
    } catch {
      // Server unreachable: keep the intent; a later boot reconciles it.
    }
  }
  return results;
}
