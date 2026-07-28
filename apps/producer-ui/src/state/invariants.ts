import type {
  AgentSettings,
  BrainJob,
  BootstrapPayload,
  ModelCatalogItem,
  Piece,
  PieceRevision,
  Provenance,
  ReasoningEffort,
  RouteId,
} from '../contracts';

export interface WorkspaceContextIdentity {
  route: RouteId;
  pieceId?: string;
  aRevisionId?: string;
  bRevisionId?: string;
  selectedSide: 'a' | 'b';
  editorCode: string;
  epoch: number;
}

export function resumePosition(
  fromTime: number,
  fromDuration: number,
  targetDuration: number,
): number {
  const safeTime = Number.isFinite(fromTime) ? Math.max(0, fromTime) : 0;
  if (!Number.isFinite(targetDuration) || targetDuration <= 0) return safeTime;
  if (safeTime < targetDuration) return safeTime;
  if (Number.isFinite(fromDuration) && fromDuration > 0) {
    const ratio = Math.min(1, safeTime / fromDuration);
    return Math.max(0, Math.min(targetDuration - 0.01, targetDuration * ratio));
  }
  return Math.max(0, targetDuration - 0.01);
}

export function currentSettingsTest(settings: AgentSettings): boolean {
  return Boolean(
    settings.test?.ok
    && settings.test.fingerprint
    && settings.test.fingerprint === settings.draft_fingerprint,
  );
}

export function settingsTestState(
  settings: AgentSettings,
): 'none' | 'current-pass' | 'stale-pass' | 'failed' {
  if (!settings.test) return 'none';
  if (!settings.test.ok) return 'failed';
  return currentSettingsTest(settings) ? 'current-pass' : 'stale-pass';
}

export function sameWorkspaceContext(
  current: WorkspaceContextIdentity,
  expected: WorkspaceContextIdentity,
): boolean {
  return current.route === expected.route
    && current.pieceId === expected.pieceId
    && current.aRevisionId === expected.aRevisionId
    && current.bRevisionId === expected.bRevisionId
    && current.selectedSide === expected.selectedSide
    && current.editorCode === expected.editorCode
    && current.epoch === expected.epoch;
}

/**
 * Accepts either the untouched captured workspace or the one exact state
 * transition caused by this preview's own SSE publication arriving before the
 * focused HTTP response. Any route, selection, edit, or unrelated B change
 * still rejects auto-selection/autoplay.
 */
export function previewResultMatchesWorkspace(
  current: WorkspaceContextIdentity,
  expected: WorkspaceContextIdentity,
  resultRevisionId: string,
): boolean {
  if (sameWorkspaceContext(current, expected)) return true;
  return current.route === expected.route
    && current.pieceId === expected.pieceId
    && current.aRevisionId === expected.aRevisionId
    && current.bRevisionId === resultRevisionId
    && expected.bRevisionId !== resultRevisionId
    && current.selectedSide === expected.selectedSide
    && current.editorCode === expected.editorCode
    && current.epoch === expected.epoch + 1;
}

export function researchCohortSignature(provenance: Provenance): string {
  const effort = provenance.reasoning_effort
    || (provenance.legacy || provenance.model_id === 'legacy_unknown' ? 'unknown' : 'default');
  const repair = provenance.repair_applied === true
    ? 'repair'
    : provenance.repair_applied === false
      ? 'first-shot'
      : 'repair-unknown';
  return [
    provenance.route || 'unknown-route',
    provenance.model_id || 'legacy_unknown',
    effort,
    provenance.orchestration || 'unknown-orchestration',
    provenance.kernel_hash || 'unknown-kernel',
    provenance.validator_mode || 'unknown-validator',
    repair,
  ].join(' / ');
}

export function brainJobMatchesContext(
  job: BrainJob,
  context: {
    pieceId?: string;
    revisionId?: string;
    audioSha?: string;
    score?: number | null;
  },
): boolean {
  return job.piece_id === context.pieceId
    && job.revision_id === context.revisionId
    && job.audio_sha === context.audioSha
    && (job.score ?? null) === (context.score ?? null);
}

export function isFreshEvent(currentCursor: number, incomingSeq: number): boolean {
  return Number.isFinite(incomingSeq) && incomingSeq > currentCursor;
}

export function modelDefaultEffort(model?: ModelCatalogItem): ReasoningEffort | null {
  return model?.default_reasoning_effort ?? null;
}

export function serverAgentDraftDirty(settings: AgentSettings): boolean {
  if (settings.draft_is_active !== false) return false;
  if (settings.revision_id) return true;
  const active = settings.active;
  const draft = settings.draft;
  return active.base_url !== draft.base_url
    || active.key_present !== draft.key_present
    || active.model_id !== draft.model_id
    || active.reasoning_effort !== draft.reasoning_effort
    || active.orchestration !== draft.orchestration;
}

export function latestDurablePreview(piece: Piece): PieceRevision | undefined {
  return piece.revisions
    .filter((revision) =>
      revision.preview
      && !revision.promoted
      && revision.id !== piece.active_revision_id,
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

export function agentProfileReady(settings?: AgentSettings): boolean {
  return Boolean(settings?.status?.ready && settings.active.model_id);
}

export function mergeSettingsSnapshot(
  current: BootstrapPayload['settings'],
  incoming: Partial<BootstrapPayload['settings']>,
): BootstrapPayload['settings'] {
  return {
    agent: incoming.agent ?? current.agent,
    generation: incoming.generation ?? current.generation,
    system: incoming.system ?? current.system,
  };
}

export function isCancellableJobState(state: string): boolean {
  return state === 'queued' || state === 'running' || state === 'cancelling';
}

export function parseCommaTags(value: string): string[] {
  return Array.from(new Set(
    value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  ));
}
