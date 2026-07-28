import { describe, expect, it } from 'vitest';
import type { OperationReadback } from '../contracts';
import {
  clearOperationIntent,
  pendingOperationIntents,
  persistOperationIntent,
  reconcilePendingOperations,
  type IntentStorage,
  type StoredOperationIntent,
} from './operation-intents';

function memoryStorage(): IntentStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function intent(key: string): StoredOperationIntent {
  return {
    key,
    kind: 'generation',
    summary: `op ${key}`,
    request_identity: `POST\n/api/v2/generation-jobs\n{"key":"${key}"}`,
    created_at: '2026-07-28T00:00:00Z',
  };
}

describe('operation intents (IDEM-001 client half)', () => {
  it('persists, dedupes by key, and clears intents', () => {
    const store = memoryStorage();
    persistOperationIntent(intent('k1'), store);
    persistOperationIntent(intent('k2'), store);
    persistOperationIntent({ ...intent('k1'), summary: 'updated' }, store);
    const pending = pendingOperationIntents(store);
    expect(pending.map((item) => item.key)).toEqual(['k2', 'k1']);
    expect(pending.find((item) => item.key === 'k1')?.summary).toBe('updated');
    clearOperationIntent('k1', store);
    expect(pendingOperationIntents(store).map((item) => item.key)).toEqual(['k2']);
  });

  it('clears intents the server answers definitively, keeps unreachable ones', async () => {
    const store = memoryStorage();
    persistOperationIntent(intent('committed'), store);
    persistOperationIntent(intent('never-committed'), store);
    persistOperationIntent(intent('unreachable'), store);

    const resolved = await reconcilePendingOperations(async (key): Promise<OperationReadback> => {
      if (key === 'unreachable') throw new Error('server down');
      return {
        found: key === 'committed',
        kind: key === 'committed' ? 'generation' : null,
        operation: key === 'committed' ? { id: 'gen_x' } : null,
      };
    }, store);

    expect(resolved).toHaveLength(2);
    expect(resolved.find((r) => r.intent.key === 'committed')?.readback.found).toBe(true);
    expect(resolved.find((r) => r.intent.key === 'never-committed')?.readback.found).toBe(false);
    // The unreachable intent survives for the next boot.
    expect(pendingOperationIntents(store).map((item) => item.key)).toEqual(['unreachable']);
  });

  it('survives corrupted storage without throwing', () => {
    const store = memoryStorage();
    store.setItem('cactus-pending-operation-intents-v1', '{not json');
    expect(pendingOperationIntents(store)).toEqual([]);
    persistOperationIntent(intent('fresh'), store);
    expect(pendingOperationIntents(store)).toHaveLength(1);
  });
});
