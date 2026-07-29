import { useEffect, useState } from 'preact/hooks';
import { audioEngine } from './audio-engine';
import type {
  AgentConnectionDraft,
  BootstrapPayload,
  BrainJob,
  EventEnvelope,
  GenerationJob,
  LoadState,
  Piece,
  PieceRevision,
  RouteId,
} from './contracts';
import {
  isFreshEvent,
  latestDurablePreview,
  mergeSettingsSnapshot,
  previewResultMatchesWorkspace,
  sameWorkspaceContext,
  serverAgentDraftDirty,
  type WorkspaceContextIdentity,
} from './state/invariants';
import {
  loadEditorDrafts,
  persistEditorDrafts,
  type EditorDraftRecord,
} from './state/editor-drafts';

export interface CompareState {
  a?: PieceRevision;
  b?: PieceRevision;
  selected: 'a' | 'b';
}

export type WorkspaceIntent = WorkspaceContextIdentity;

export type AgentSettingsOperationKind = 'discover' | 'test' | 'apply' | 'discard';

export interface AgentSettingsOperationOwnership {
  kind: AgentSettingsOperationKind;
  nonce: string;
  candidateFingerprint: string;
}

export interface AppState {
  loadState: LoadState;
  loadError?: string;
  route: RouteId;
  bootstrap?: BootstrapPayload;
  selectedPieceId?: string;
  compare: CompareState;
  editorCode: string;
  editorDirty: boolean;
  workspaceEpoch: number;
  eventState: 'connected' | 'retrying' | 'offline';
  generationPrompt: string;
  generationCount: 1 | 2 | 4;
  selectedProfileId?: string;
  agentDraft?: AgentConnectionDraft;
  agentDraftDirty: boolean;
  agentSettingsOperation?: AgentSettingsOperationOwnership;
  /** A1: explicitly opened Brain thread; undefined = follow current context. */
  selectedBrainThreadId?: string;
  /** A4: composer text survives route changes. */
  brainComposer: string;
  toasts: Array<{ id: string; message: string; tone: 'ok' | 'warn' | 'error' }>;
}

type Listener = () => void;

const initial: AppState = {
  loadState: 'idle',
  route: 'studio',
  compare: { selected: 'a' },
  editorCode: '',
  editorDirty: false,
  workspaceEpoch: 0,
  eventState: 'offline',
  brainComposer: '',
  generationPrompt: '',
  generationCount: 1,
  agentDraftDirty: false,
  toasts: [],
};

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) return [next, ...items];
  const copy = [...items];
  copy[index] = next;
  return copy;
}

function hydrateBrainJob(
  job: BrainJob,
  pieces: Piece[],
  existing?: BrainJob,
): BrainJob {
  const piece = pieces.find((item) => item.id === job.piece_id);
  const revision = piece?.revisions.find((item) => item.id === job.revision_id);
  return {
    ...job,
    audio_sha: job.audio_sha || existing?.audio_sha || revision?.audio_sha,
    score: job.score !== undefined ? job.score : existing?.score,
  };
}

export class AppStore {
  private state: AppState = initial;
  private listeners = new Set<Listener>();
  private editorDrafts = loadEditorDrafts();

  getSnapshot = (): AppState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  patch(patch: Omit<Partial<AppState>, 'route'>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  setRoute(route: RouteId): boolean {
    if (this.state.route === route) return false;
    this.state = {
      ...this.state,
      route,
      workspaceEpoch: this.state.workspaceEpoch + 1,
    };
    this.emit();
    return true;
  }

  setBootstrap(bootstrap: BootstrapPayload): boolean {
    if (
      this.state.bootstrap
      && bootstrap.cursor < this.state.bootstrap.cursor
    ) {
      return false;
    }
    const previousSelectedPieceId = this.state.selectedPieceId;
    const hydratedBootstrap = {
      ...bootstrap,
      cursor: Math.max(
        bootstrap.cursor,
        this.state.bootstrap?.cursor || 0,
      ),
      brain_jobs: bootstrap.brain_jobs.map((job) => hydrateBrainJob(
        job,
        bootstrap.pieces,
        this.state.bootstrap?.brain_jobs.find((existing) => existing.id === job.id),
      )),
    };
    const preserveAgentCandidate = Boolean(
      (this.state.agentDraftDirty || this.state.agentSettingsOperation)
      && this.state.bootstrap,
    );
    const safeBootstrap = preserveAgentCandidate && this.state.bootstrap
      ? {
          ...hydratedBootstrap,
          settings: {
            ...hydratedBootstrap.settings,
            agent: {
              ...hydratedBootstrap.settings.agent,
              draft_fingerprint: this.state.bootstrap.settings.agent.draft_fingerprint,
            },
          },
        }
      : hydratedBootstrap;
    const selectedPieceId = this.state.selectedPieceId
      && safeBootstrap.pieces.some((piece) => piece.id === this.state.selectedPieceId)
      ? this.state.selectedPieceId
      : safeBootstrap.pieces.find((piece) => !piece.archived)?.id;
    const selected = safeBootstrap.pieces.find((piece) => piece.id === selectedPieceId);
    const samePiece = Boolean(selectedPieceId && selectedPieceId === this.state.selectedPieceId);
    const keepEditorDraft = samePiece && this.state.editorDirty;
    const storedDraft = selected ? this.editorDrafts.get(selected.id) : undefined;
    const activeAgent = safeBootstrap.settings.agent;
    const generationProfiles = safeBootstrap.settings.generation.profiles;
    const selectedProfileId = this.state.selectedProfileId
      && generationProfiles.some((profile) => profile.id === this.state.selectedProfileId)
      ? this.state.selectedProfileId
      : safeBootstrap.settings.generation.default_profile_id
        || generationProfiles[0]?.id;
    let compare: CompareState = { selected: 'a' };
    if (selected) {
      if (samePiece) {
        const a = selected.revisions.find((revision) => revision.id === this.state.compare.a?.id)
          || selected.active_revision;
        const existingB = selected.revisions.find((revision) => revision.id === this.state.compare.b?.id);
        const b = existingB && existingB.id !== a.id
          ? existingB
          : latestDurablePreview(selected);
        compare = {
          a,
          b: b?.id === a.id ? undefined : b,
          selected: this.state.compare.selected === 'b' && b?.id !== a.id ? 'b' : 'a',
        };
      } else {
        const draftBase = storedDraft
          ? selected.revisions.find((revision) => revision.id === storedDraft.baseRevisionId)
          : undefined;
        const a = draftBase || selected.active_revision;
        const b = latestDurablePreview(selected);
        compare = {
          a,
          b: b?.id === a.id ? undefined : b,
          selected: 'a',
        };
      }
    }
    const editorCode = keepEditorDraft
      ? this.state.editorCode
      : storedDraft
        ? storedDraft.code
        : compare.a?.code || '';
    const editorDirty = keepEditorDraft
      || Boolean(storedDraft && storedDraft.code !== compare.a?.code);
    const contextChanged = selectedPieceId !== this.state.selectedPieceId
      || compare.a?.id !== this.state.compare.a?.id
      || compare.b?.id !== this.state.compare.b?.id
      || compare.selected !== this.state.compare.selected
      || editorCode !== this.state.editorCode;
    this.state = {
      ...this.state,
      loadState: 'ready',
      loadError: undefined,
      bootstrap: safeBootstrap,
      selectedPieceId,
      editorCode,
      editorDirty,
      workspaceEpoch: this.state.workspaceEpoch + (contextChanged ? 1 : 0),
      compare,
      selectedProfileId,
      agentDraft: preserveAgentCandidate
        ? this.state.agentDraft
        : { ...activeAgent.draft },
      agentDraftDirty: preserveAgentCandidate
        ? this.state.agentDraftDirty
        : serverAgentDraftDirty(activeAgent),
    };
    this.emit();
    if (selected && !samePiece) {
      audioEngine.load(compare.a || selected.active_revision, false);
    } else if (selected && contextChanged) {
      const auditioned = compare.selected === 'b' && compare.b ? compare.b : compare.a;
      if (auditioned) {
        audioEngine.switchRevision(
          auditioned,
          audioEngine.wantsPlayback(),
        );
      }
    } else if (!selected && previousSelectedPieceId) {
      audioEngine.stop();
    }
    return true;
  }

  selectPiece(pieceId: string): void {
    const piece = this.state.bootstrap?.pieces.find((item) => item.id === pieceId);
    if (!piece) return;
    if (pieceId === this.state.selectedPieceId) return;
    this.rememberCurrentEditorDraft();
    const draft = this.editorDrafts.get(pieceId);
    const draftBase = draft
      ? piece.revisions.find((revision) => revision.id === draft.baseRevisionId)
      : undefined;
    const a = draftBase || piece.active_revision;
    const b = latestDurablePreview(piece);
    this.state = {
      ...this.state,
      selectedPieceId: pieceId,
      editorCode: draft?.code || a.code,
      editorDirty: Boolean(draft && draft.code !== a.code),
      compare: { a, b: b?.id === a.id ? undefined : b, selected: 'a' },
      workspaceEpoch: this.state.workspaceEpoch + 1,
    };
    this.emit();
    audioEngine.load(a, false);
  }

  selectRevision(
    pieceId: string,
    revision: PieceRevision,
    side: 'a' | 'b',
    autoplay = false,
  ): void {
    if (revision.piece_id !== pieceId) return;
    const switchingPiece = this.state.selectedPieceId !== pieceId;
    if (switchingPiece) this.selectPiece(pieceId);
    const piece = this.state.bootstrap?.pieces.find((item) => item.id === pieceId);
    if (!piece) return;
    const current = this.state.compare;
    if (side === 'b' && current.a?.id === revision.id) {
      this.patch({
        compare: { ...current, selected: 'a' },
        workspaceEpoch: this.state.workspaceEpoch + 1,
      });
      audioEngine.switchRevision(current.a, autoplay);
      return;
    }
    const compare: CompareState = side === 'a'
      ? {
          a: revision,
          b: current.b?.id === revision.id ? undefined : current.b,
          selected: 'a',
        }
      : {
          a: current.a || piece.active_revision,
          b: revision,
          selected: 'b',
        };
    this.state = {
      ...this.state,
      selectedPieceId: pieceId,
      compare,
      editorCode: side === 'a' && !this.state.editorDirty ? revision.code : this.state.editorCode,
      editorDirty: side === 'a'
        ? this.state.editorDirty && this.state.editorCode !== revision.code
        : this.state.editorDirty,
      workspaceEpoch: this.state.workspaceEpoch + 1,
    };
    if (side === 'a') {
      if (this.state.editorDirty) {
        this.setEditorDraft(pieceId, {
          baseRevisionId: revision.id,
          code: this.state.editorCode,
        });
      } else {
        this.deleteEditorDraft(pieceId);
      }
    }
    this.emit();
    audioEngine.switchRevision(revision, autoplay);
  }

  updateEditor(code: string): void {
    const source = this.state.compare.a || this.selectedPiece()?.active_revision;
    const dirty = code !== source?.code;
    const pieceId = this.state.selectedPieceId;
    if (pieceId) {
      if (dirty) {
        this.setEditorDraft(pieceId, {
          baseRevisionId: source?.id,
          code,
        });
      } else {
        this.deleteEditorDraft(pieceId);
      }
    }
    this.patch({
      editorCode: code,
      editorDirty: dirty,
      workspaceEpoch: this.state.workspaceEpoch + 1,
    });
  }

  auditionSide(side: 'a' | 'b', autoplay = false): void {
    const revision = side === 'a' ? this.state.compare.a : this.state.compare.b;
    if (!revision) return;
    this.patch({
      compare: { ...this.state.compare, selected: side },
      workspaceEpoch: this.state.workspaceEpoch + 1,
    });
    audioEngine.switchRevision(revision, autoplay);
  }

  captureWorkspaceIntent(): WorkspaceIntent {
    return this.currentWorkspaceContext();
  }

  applyPreviewResult(
    expected: WorkspaceIntent,
    piece: Piece,
    revision: PieceRevision,
  ): boolean {
    const durableRevision = piece.revisions.find((item) => item.id === revision.id);
    const matches = piece.id === expected.pieceId
      && durableRevision?.piece_id === expected.pieceId
      && durableRevision.audio_sha === revision.audio_sha
      && revision.source_revision_id === expected.aRevisionId
      && previewResultMatchesWorkspace(
        this.currentWorkspaceContext(),
        expected,
        revision.id,
      );
    if (!matches) {
      this.upsertPieceCache(piece);
      return false;
    }
    this.upsertPiece(piece);
    this.state = {
      ...this.state,
      compare: { ...this.state.compare, b: durableRevision, selected: 'b' },
      workspaceEpoch: this.state.workspaceEpoch + 1,
    };
    this.emit();
    audioEngine.switchRevision(durableRevision, true);
    return true;
  }

  applyPromotionResult(
    expected: WorkspaceIntent,
    piece: Piece,
    promotedRevisionId: string,
  ): boolean {
    const matches = piece.id === expected.pieceId
      && piece.active_revision.id === promotedRevisionId
      && expected.editorCode === piece.active_revision.code
      && sameWorkspaceContext(this.currentWorkspaceContext(), expected);
    if (!matches) {
      this.upsertPieceCache(piece);
      return false;
    }
    this.upsertPiece(piece);
    this.deleteEditorDraft(piece.id);
    this.state = {
      ...this.state,
      compare: { a: piece.active_revision, selected: 'a' },
      editorCode: piece.active_revision.code,
      editorDirty: false,
      workspaceEpoch: this.state.workspaceEpoch + 1,
    };
    this.emit();
    audioEngine.load(piece.active_revision, false);
    return true;
  }

  selectedPiece(): Piece | undefined {
    return this.state.bootstrap?.pieces.find((piece) => piece.id === this.state.selectedPieceId);
  }

  upsertPiece(piece: Piece): void {
    const bootstrap = this.state.bootstrap;
    if (!bootstrap) return;
    const isSelected = piece.id === this.state.selectedPieceId;
    const a = isSelected
      ? piece.revisions.find((revision) => revision.id === this.state.compare.a?.id)
        || piece.active_revision
      : undefined;
    const existingB = isSelected
      ? piece.revisions.find((revision) => revision.id === this.state.compare.b?.id)
      : undefined;
    const recoveredB = isSelected ? latestDurablePreview(piece) : undefined;
    const b = isSelected
      ? existingB?.id !== a?.id
        ? existingB || (recoveredB?.id !== a?.id ? recoveredB : undefined)
        : recoveredB?.id !== a?.id
          ? recoveredB
          : undefined
      : undefined;
    const compare = isSelected
      ? {
          a,
          b: b?.id === a?.id ? undefined : b,
          selected: this.state.compare.selected === 'b' && b?.id !== a?.id ? 'b' as const : 'a' as const,
        }
      : this.state.compare;
    const editorCode = isSelected && !this.state.editorDirty
      ? a?.code || piece.active_revision.code
      : this.state.editorCode;
    const contextChanged = isSelected && (
      compare.a?.id !== this.state.compare.a?.id
      || compare.b?.id !== this.state.compare.b?.id
      || compare.selected !== this.state.compare.selected
      || editorCode !== this.state.editorCode
    );
    this.state = {
      ...this.state,
      bootstrap: { ...bootstrap, pieces: upsertById(bootstrap.pieces, piece) },
      editorCode,
      compare,
      workspaceEpoch: this.state.workspaceEpoch + (contextChanged ? 1 : 0),
    };
    this.emit();
    if (contextChanged) {
      const auditioned = compare.selected === 'b' && compare.b ? compare.b : compare.a;
      if (auditioned) {
        audioEngine.switchRevision(
          auditioned,
          audioEngine.wantsPlayback(),
        );
      }
    }
  }

  upsertJob(job: GenerationJob): void {
    const bootstrap = this.state.bootstrap;
    if (!bootstrap) return;
    this.patch({ bootstrap: { ...bootstrap, jobs: upsertById(bootstrap.jobs, job) } });
  }

  selectBrainThread(threadId: string | undefined): void {
    this.patch({ selectedBrainThreadId: threadId });
  }

  /** Clear the board: a fresh thread id plus an empty composer. */
  startBrainThread(): string {
    const threadId = `thread-${crypto.randomUUID()}`;
    this.patch({ selectedBrainThreadId: threadId, brainComposer: '' });
    return threadId;
  }

  setBrainComposer(text: string): void {
    this.patch({ brainComposer: text });
  }

  upsertBrainJob(job: BrainJob): void {
    const bootstrap = this.state.bootstrap;
    if (!bootstrap) return;
    const existing = bootstrap.brain_jobs.find((item) => item.id === job.id);
    const hydrated = hydrateBrainJob(job, bootstrap.pieces, existing);
    this.patch({ bootstrap: { ...bootstrap, brain_jobs: upsertById(bootstrap.brain_jobs, hydrated) } });
  }

  applyEvent(event: EventEnvelope): void {
    const bootstrap = this.state.bootstrap;
    if (!bootstrap) return;
    if (!isFreshEvent(bootstrap.cursor, event.seq)) return;
    const withCursor = { ...bootstrap, cursor: Math.max(bootstrap.cursor, event.seq) };
    this.state = { ...this.state, bootstrap: withCursor };
    switch (event.type) {
      case 'job.updated':
        this.upsertJob(event.data as GenerationJob);
        return;
      case 'piece.updated':
      case 'piece.created':
        this.upsertPiece(event.data as Piece);
        return;
      case 'brain.updated':
        this.upsertBrainJob(event.data as BrainJob);
        return;
      case 'settings.updated': {
        const settings = mergeSettingsSnapshot(
          bootstrap.settings,
          event.data as Partial<BootstrapPayload['settings']>,
        );
        this.setBootstrap({
          ...bootstrap,
          settings,
          cursor: Math.max(bootstrap.cursor, event.seq),
        });
        return;
      }
      case 'bootstrap': {
        const payload = event.data as BootstrapPayload;
        this.setBootstrap({
          ...payload,
          cursor: Math.max(bootstrap.cursor, event.seq, payload.cursor || 0),
        });
        return;
      }
      case 'activity.created': {
        const activity = {
          ...(event.data as BootstrapPayload['activity'][number]),
          seq: event.seq,
        };
        this.patch({
          bootstrap: {
            ...withCursor,
            activity: [activity, ...withCursor.activity].slice(0, 400),
          },
        });
        return;
      }
    }
  }

  setAgentDraft(patch: Partial<AgentConnectionDraft>): void {
    const current = this.state.agentDraft;
    if (!current) return;
    const bootstrap = this.state.bootstrap;
    this.patch({
      agentDraft: { ...current, ...patch },
      agentDraftDirty: true,
      agentSettingsOperation: undefined,
      bootstrap: bootstrap
        ? {
            ...bootstrap,
            settings: {
              ...bootstrap.settings,
              agent: {
                ...bootstrap.settings.agent,
                // Any local edit makes a persisted test receipt stale until the
                // server returns the canonical fingerprint for a new test.
                draft_fingerprint: `local-dirty:${crypto.randomUUID()}`,
              },
            },
          }
        : bootstrap,
    });
  }

  beginAgentSettingsOperation(
    kind: AgentSettingsOperationKind,
  ): AgentSettingsOperationOwnership | undefined {
    const candidateFingerprint = this.state.bootstrap?.settings.agent.draft_fingerprint;
    if (!candidateFingerprint || this.state.agentSettingsOperation) return undefined;
    const ownership = Object.freeze({
      kind,
      nonce: crypto.randomUUID(),
      candidateFingerprint,
    });
    this.patch({ agentSettingsOperation: ownership });
    return ownership;
  }

  applyAgentSettingsReadback(
    expected: AgentSettingsOperationOwnership,
    settings: BootstrapPayload['settings']['agent'],
  ): boolean {
    const bootstrap = this.state.bootstrap;
    const current = this.state.agentSettingsOperation;
    if (
      !bootstrap
      || !current
      || current.nonce !== expected.nonce
      || current.kind !== expected.kind
      || current.candidateFingerprint !== expected.candidateFingerprint
    ) {
      return false;
    }
    this.state = {
      ...this.state,
      bootstrap: {
        ...bootstrap,
        settings: {
          ...bootstrap.settings,
          agent: settings,
        },
      },
      agentDraft: { ...settings.draft, api_key: undefined },
      agentDraftDirty: serverAgentDraftDirty(settings),
      agentSettingsOperation: undefined,
    };
    this.emit();
    return true;
  }

  finishAgentSettingsOperation(expected: AgentSettingsOperationOwnership): void {
    if (this.state.agentSettingsOperation?.nonce !== expected.nonce) return;
    this.patch({ agentSettingsOperation: undefined });
  }

  toast(message: string, tone: 'ok' | 'warn' | 'error' = 'ok'): void {
    const id = crypto.randomUUID();
    this.patch({ toasts: [...this.state.toasts, { id, message, tone }] });
    window.setTimeout(() => {
      this.patch({ toasts: this.state.toasts.filter((toast) => toast.id !== id) });
    }, 4200);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private currentWorkspaceContext(): WorkspaceIntent {
    return {
      route: this.state.route,
      pieceId: this.state.selectedPieceId,
      aRevisionId: this.state.compare.a?.id,
      bRevisionId: this.state.compare.b?.id,
      selectedSide: this.state.compare.selected,
      editorCode: this.state.editorCode,
      epoch: this.state.workspaceEpoch,
    };
  }

  private rememberCurrentEditorDraft(): void {
    const pieceId = this.state.selectedPieceId;
    if (!pieceId) return;
    if (this.state.editorDirty) {
      this.setEditorDraft(pieceId, {
        baseRevisionId: this.state.compare.a?.id,
        code: this.state.editorCode,
      });
    }
  }

  private setEditorDraft(pieceId: string, draft: EditorDraftRecord): void {
    this.editorDrafts.set(pieceId, draft);
    persistEditorDrafts(this.editorDrafts);
  }

  private deleteEditorDraft(pieceId: string): void {
    if (!this.editorDrafts.delete(pieceId)) return;
    persistEditorDrafts(this.editorDrafts);
  }

  private upsertPieceCache(piece: Piece): void {
    const bootstrap = this.state.bootstrap;
    if (!bootstrap) return;
    this.patch({
      bootstrap: {
        ...bootstrap,
        pieces: upsertById(bootstrap.pieces, piece),
      },
    });
  }
}

export const appStore = new AppStore();

export function useAppState(): AppState {
  const [state, setState] = useState(appStore.getSnapshot());
  useEffect(() => appStore.subscribe(() => setState(appStore.getSnapshot())), []);
  return state;
}
