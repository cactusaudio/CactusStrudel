export interface EditorDraftRecord {
  baseRevisionId?: string;
  code: string;
}

const STORAGE_KEY = 'cactusstrudel.v3.editor-drafts';

function availableSessionStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function loadEditorDrafts(
  storage: Pick<Storage, 'getItem'> | undefined = availableSessionStorage(),
): Map<string, EditorDraftRecord> {
  if (!storage) return new Map();
  try {
    const payload = JSON.parse(storage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>;
    const drafts = new Map<string, EditorDraftRecord>();
    Object.entries(payload).forEach(([pieceId, value]) => {
      if (!pieceId || !value || typeof value !== 'object') return;
      const candidate = value as { baseRevisionId?: unknown; code?: unknown };
      if (typeof candidate.code !== 'string') return;
      drafts.set(pieceId, {
        code: candidate.code,
        baseRevisionId: typeof candidate.baseRevisionId === 'string'
          ? candidate.baseRevisionId
          : undefined,
      });
    });
    return drafts;
  } catch {
    return new Map();
  }
}

export function persistEditorDrafts(
  drafts: ReadonlyMap<string, EditorDraftRecord>,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = availableSessionStorage(),
): void {
  if (!storage) return;
  try {
    if (drafts.size === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(drafts)));
  } catch {
    // Draft persistence is a recovery aid; storage failure must not block editing.
  }
}
