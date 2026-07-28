import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/bootstrap.json';
import type {
  AgentSettings,
  BootstrapPayload,
  Piece,
  PieceRevision,
} from '../contracts';

vi.mock('../audio-engine', () => ({
  audioEngine: {
    load: vi.fn(),
    stop: vi.fn(),
    switchRevision: vi.fn(),
    wantsPlayback: vi.fn(() => false),
  },
}));

import { AppStore } from '../store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function bootstrap(): BootstrapPayload {
  return structuredClone(fixture) as unknown as BootstrapPayload;
}

function previewFor(piece: Piece, id: string): PieceRevision {
  return {
    ...piece.active_revision,
    id,
    created_at: '2026-07-28T18:00:00Z',
    source_revision_id: piece.active_revision.id,
    audio_sha: `${id}-audio-sha`,
    preview: true,
    promoted: false,
  };
}

describe('store-owned async operation identity', () => {
  it('rejects a deferred preview after Studio → Library → Studio', async () => {
    const store = new AppStore();
    store.setBootstrap(bootstrap());
    const piece = store.selectedPiece()!;
    const expected = store.captureWorkspaceIntent();
    const preview = previewFor(piece, 'rev-late-preview');
    const durablePiece = {
      ...piece,
      revisions: [...piece.revisions, preview],
    };
    const request = deferred<{ piece: Piece; revision: PieceRevision }>();
    const completion = request.promise.then((result) => (
      store.applyPreviewResult(expected, result.piece, result.revision)
    ));

    const initialEpoch = store.getSnapshot().workspaceEpoch;
    expect(store.setRoute('library')).toBe(true);
    expect(store.setRoute('studio')).toBe(true);
    expect(store.getSnapshot().workspaceEpoch).toBe(initialEpoch + 2);

    request.resolve({ piece: durablePiece, revision: preview });
    expect(await completion).toBe(false);
    expect(store.getSnapshot().route).toBe('studio');
    expect(store.getSnapshot().compare.selected).toBe('a');
    expect(store.getSnapshot().compare.b?.id).not.toBe(preview.id);
  });

  it('rejects a deferred promotion after Studio → Library → Studio', async () => {
    const store = new AppStore();
    store.setBootstrap(bootstrap());
    const piece = store.selectedPiece()!;
    const preview = previewFor(piece, 'rev-late-promotion');
    store.selectRevision(piece.id, preview, 'b');
    const expected = store.captureWorkspaceIntent();
    const promoted = { ...preview, promoted: true };
    const durablePiece: Piece = {
      ...piece,
      active_revision_id: promoted.id,
      active_revision: promoted,
      revisions: [...piece.revisions, promoted],
    };
    const request = deferred<{ piece: Piece; revisionId: string }>();
    const completion = request.promise.then((result) => (
      store.applyPromotionResult(expected, result.piece, result.revisionId)
    ));

    const originalA = store.getSnapshot().compare.a;
    const originalEditor = store.getSnapshot().editorCode;
    store.setRoute('library');
    store.setRoute('studio');

    request.resolve({ piece: durablePiece, revisionId: promoted.id });
    expect(await completion).toBe(false);
    expect(store.getSnapshot().compare.a?.id).toBe(originalA?.id);
    expect(store.getSnapshot().editorCode).toBe(originalEditor);
    expect(store.getSnapshot().editorDirty).toBe(false);
  });

  it('preserves a remounted newer Agent draft when an older readback resolves', async () => {
    const store = new AppStore();
    store.setBootstrap(bootstrap());
    store.setAgentDraft({ model_id: 'gpt-5.6-sol' });
    const ownership = store.beginAgentSettingsOperation('test')!;
    const submittedDraft = { ...store.getSnapshot().agentDraft! };
    const request = deferred<AgentSettings>();
    const completion = request.promise.then((document) => (
      store.applyAgentSettingsReadback(ownership, document)
    ));

    // The original screen can unmount here. A remounted screen edits the
    // store-owned candidate while the first Test readback is still in flight.
    store.setAgentDraft({ model_id: 'gemini-pro-agent' });
    const newerFingerprint = store.getSnapshot().bootstrap!.settings.agent.draft_fingerprint;
    expect(store.getSnapshot().agentSettingsOperation).toBeUndefined();

    request.resolve({
      ...store.getSnapshot().bootstrap!.settings.agent,
      draft: submittedDraft,
      draft_fingerprint: 'server-readback-for-old-draft',
      test: {
        id: 'test-old',
        ok: true,
        tested_at: '2026-07-28T18:01:00Z',
        fingerprint: 'server-readback-for-old-draft',
      },
    });

    expect(await completion).toBe(false);
    expect(store.getSnapshot().agentDraft?.model_id).toBe('gemini-pro-agent');
    expect(store.getSnapshot().agentDraftDirty).toBe(true);
    expect(store.getSnapshot().bootstrap!.settings.agent.draft_fingerprint)
      .toBe(newerFingerprint);

    store.finishAgentSettingsOperation(ownership);
    expect(store.beginAgentSettingsOperation('discover')).toBeDefined();
  });
});
