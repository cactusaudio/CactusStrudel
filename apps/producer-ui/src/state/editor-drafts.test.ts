import { describe, expect, it } from 'vitest';
import { loadEditorDrafts, persistEditorDrafts } from './editor-drafts';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe('editor draft recovery', () => {
  it('round-trips per-piece code and its A revision through session storage', () => {
    const storage = memoryStorage();
    persistEditorDrafts(new Map([
      ['piece-a', { baseRevisionId: 'rev-a', code: '// LOCAL_DRAFT_PROBE' }],
      ['piece-b', { code: 'sound("bd")' }],
    ]), storage);

    expect(Object.fromEntries(loadEditorDrafts(storage))).toEqual({
      'piece-a': { baseRevisionId: 'rev-a', code: '// LOCAL_DRAFT_PROBE' },
      'piece-b': { baseRevisionId: undefined, code: 'sound("bd")' },
    });
  });

  it('fails closed on malformed persisted values', () => {
    const storage = memoryStorage();
    storage.setItem('cactusstrudel.v3.editor-drafts', '{not-json');
    expect(loadEditorDrafts(storage).size).toBe(0);
  });
});
