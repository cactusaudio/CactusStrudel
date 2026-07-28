import { describe, expect, it } from 'vitest';
import type { AgentSettings, BootstrapPayload, BrainJob, ModelCatalogItem } from '../contracts';
import {
  brainJobMatchesContext,
  currentSettingsTest,
  isFreshEvent,
  isCancellableJobState,
  mergeSettingsSnapshot,
  modelDefaultEffort,
  parseCommaTags,
  resumePosition,
  agentProfileReady,
  latestDurablePreview,
  previewResultMatchesWorkspace,
  researchCohortSignature,
  sameWorkspaceContext,
  serverAgentDraftDirty,
  settingsTestState,
} from './invariants';

describe('producer UI state invariants', () => {
  it('keeps the same second while both A/B renders contain it', () => {
    expect(resumePosition(42, 120, 90)).toBe(42);
  });

  it('uses relative position when switching into a shorter render', () => {
    expect(resumePosition(96, 120, 60)).toBe(48);
  });

  it('clamps safely when source duration is unavailable', () => {
    expect(resumePosition(96, 0, 60)).toBeCloseTo(59.99);
  });

  it('accepts only the server test receipt for the exact draft fingerprint', () => {
    const settings = {
      draft_fingerprint: 'draft-a',
      test: { id: 'test-1', ok: true, fingerprint: 'draft-a', tested_at: 'now' },
    } as AgentSettings;
    expect(currentSettingsTest(settings)).toBe(true);
    expect(currentSettingsTest({ ...settings, draft_fingerprint: 'draft-b' })).toBe(false);
    expect(settingsTestState(settings)).toBe('current-pass');
    expect(settingsTestState({ ...settings, draft_fingerprint: 'draft-b' })).toBe('stale-pass');
    expect(settingsTestState({
      ...settings,
      test: { ...settings.test!, ok: false },
    })).toBe('failed');
  });

  it('accepts an async workspace result only for the exact captured context', () => {
    const captured = {
      route: 'studio' as const,
      pieceId: 'piece-a',
      aRevisionId: 'rev-a',
      bRevisionId: 'rev-b',
      selectedSide: 'a' as const,
      editorCode: 'stack(sound("bd"))',
      epoch: 7,
    };
    expect(sameWorkspaceContext(captured, captured)).toBe(true);
    expect(sameWorkspaceContext({ ...captured, pieceId: 'piece-b' }, captured)).toBe(false);
    expect(sameWorkspaceContext({ ...captured, route: 'library' }, captured)).toBe(false);
    expect(sameWorkspaceContext({ ...captured, selectedSide: 'b' }, captured)).toBe(false);
    expect(sameWorkspaceContext({ ...captured, editorCode: 'sound("hh")' }, captured)).toBe(false);
    expect(sameWorkspaceContext({ ...captured, epoch: 8 }, captured)).toBe(false);
  });

  it('accepts the preview response after only its own SSE inserted B', () => {
    const captured = {
      route: 'studio' as const,
      pieceId: 'piece-a',
      aRevisionId: 'rev-a',
      bRevisionId: undefined,
      selectedSide: 'a' as const,
      editorCode: 'stack(sound("bd"))',
      epoch: 7,
    };
    expect(previewResultMatchesWorkspace(captured, captured, 'rev-preview')).toBe(true);
    expect(previewResultMatchesWorkspace({
      ...captured,
      bRevisionId: 'rev-preview',
      epoch: 8,
    }, captured, 'rev-preview')).toBe(true);
    expect(previewResultMatchesWorkspace({
      ...captured,
      route: 'library',
      bRevisionId: 'rev-preview',
      epoch: 8,
    }, captured, 'rev-preview')).toBe(false);
    expect(previewResultMatchesWorkspace({
      ...captured,
      bRevisionId: 'another-preview',
      epoch: 8,
    }, captured, 'rev-preview')).toBe(false);
    expect(previewResultMatchesWorkspace({
      ...captured,
      bRevisionId: 'rev-preview',
      selectedSide: 'b',
      epoch: 9,
    }, captured, 'rev-preview')).toBe(false);
    expect(previewResultMatchesWorkspace({
      ...captured,
      bRevisionId: 'rev-preview',
      editorCode: 'sound("hh")',
      epoch: 9,
    }, captured, 'rev-preview')).toBe(false);
    expect(previewResultMatchesWorkspace({
      ...captured,
      bRevisionId: 'rev-preview',
      epoch: 9,
    }, captured, 'rev-preview')).toBe(false);
  });

  it('keeps route and unknown provenance fields inside the research cohort key', () => {
    const base = {
      model_id: 'model-a',
      reasoning_effort: 'medium',
      orchestration: 'standard',
      kernel_hash: 'kernel',
      validator_mode: 'deterministic',
      repair_applied: false,
    } as const;
    expect(researchCohortSignature({ ...base, route: 'route-a' }))
      .not.toBe(researchCohortSignature({ ...base, route: 'route-b' }));
    expect(researchCohortSignature({ ...base, route: undefined, orchestration: undefined, repair_applied: undefined }))
      .toContain('unknown-route / model-a / medium / unknown-orchestration / kernel / deterministic / repair-unknown');
  });

  it('selects Brain jobs only for an exact piece revision and audio identity', () => {
    const job: BrainJob = {
      id: 'brain-1',
      state: 'done',
      created_at: 'now',
      piece_id: 'piece-a',
      revision_id: 'rev-a',
      audio_sha: 'sha-a',
      score: 7.2,
      messages: [],
    };
    expect(brainJobMatchesContext(job, {
      pieceId: 'piece-a',
      revisionId: 'rev-a',
      audioSha: 'sha-a',
      score: 7.2,
    })).toBe(true);
    expect(brainJobMatchesContext(job, {
      pieceId: 'piece-a',
      revisionId: 'rev-a',
      audioSha: 'sha-b',
      score: 7.2,
    })).toBe(false);
    expect(brainJobMatchesContext(job, {
      pieceId: 'piece-a',
      revisionId: 'rev-a',
      audioSha: 'sha-a',
      score: 8.1,
    })).toBe(false);
  });

  it('applies only event sequences newer than the authoritative cursor', () => {
    expect(isFreshEvent(41, 42)).toBe(true);
    expect(isFreshEvent(42, 42)).toBe(false);
    expect(isFreshEvent(43, 42)).toBe(false);
  });

  it('never guesses effort from a non-empty advertised effort list', () => {
    const model = {
      id: 'model',
      reasoning_efforts: ['low', 'max'],
      supports_ultra: false,
      capability_source: 'live+manifest',
    } as ModelCatalogItem;
    expect(modelDefaultEffort(model)).toBeNull();
  });

  it('uses only the explicit manifest default effort', () => {
    const model = {
      id: 'model',
      reasoning_efforts: ['low', 'max'],
      default_reasoning_effort: 'max',
      supports_ultra: true,
      capability_source: 'live+manifest',
    } as ModelCatalogItem;
    expect(modelDefaultEffort(model)).toBe('max');
  });

  it('does not call an empty default draft dirty on a fresh runtime', () => {
    const profile = {
      base_url: 'http://127.0.0.1:8318/v1',
      key_present: false,
      model_id: '',
      reasoning_effort: null,
      orchestration: 'standard',
    } as const;
    expect(serverAgentDraftDirty({
      active: profile,
      draft: { ...profile },
      draft_fingerprint: 'empty',
      draft_is_active: false,
      catalog: [],
    })).toBe(false);
  });

  it('keeps a persisted candidate dirty when an active revision exists', () => {
    const profile = {
      base_url: 'http://127.0.0.1:8318/v1',
      key_present: true,
      model_id: 'claude-opus-5',
      reasoning_effort: null,
      orchestration: 'standard',
    } as const;
    expect(serverAgentDraftDirty({
      revision_id: 'settings-rev-1',
      active: profile,
      draft: { ...profile },
      draft_fingerprint: 'candidate',
      draft_is_active: false,
      catalog: [],
    })).toBe(true);
  });

  it('recovers the newest durable unpromoted preview as B', () => {
    const active = {
      id: 'rev-active',
      piece_id: 'piece-1',
      created_at: '2026-07-28T01:00:00Z',
      code: 'active',
      audio_url: '/active.mp3',
      audio_sha: 'active-sha',
      provenance: {},
      promoted: true,
    };
    const older = {
      ...active,
      id: 'rev-preview-old',
      created_at: '2026-07-28T02:00:00Z',
      code: 'old',
      audio_sha: 'old-sha',
      preview: true,
      promoted: false,
    };
    const newest = {
      ...older,
      id: 'rev-preview-new',
      created_at: '2026-07-28T03:00:00Z',
      code: 'new',
      audio_sha: 'new-sha',
    };
    expect(latestDurablePreview({
      id: 'piece-1',
      name: 'Piece',
      created_at: active.created_at,
      archived: false,
      tags: [],
      active_revision_id: active.id,
      active_revision: active,
      revisions: [active, older, newest],
    })).toMatchObject({ id: 'rev-preview-new', audio_sha: 'new-sha' });
  });

  it('does not restore a promoted preview as B', () => {
    const active = {
      id: 'rev-preview',
      piece_id: 'piece-1',
      created_at: '2026-07-28T01:00:00Z',
      code: 'active',
      audio_url: '/active.mp3',
      audio_sha: 'active-sha',
      provenance: {},
      preview: true,
      promoted: true,
    };
    expect(latestDurablePreview({
      id: 'piece-1',
      name: 'Piece',
      created_at: active.created_at,
      archived: false,
      tags: [],
      active_revision_id: active.id,
      active_revision: active,
      revisions: [active],
    })).toBeUndefined();
  });

  it('enables Brain only for a server-ready applied model', () => {
    const base = {
      base_url: 'http://127.0.0.1:8318/v1',
      key_present: true,
      model_id: 'claude-opus-5',
      reasoning_effort: null,
      orchestration: 'standard',
    } as const;
    expect(agentProfileReady({
      active: base,
      draft: base,
      draft_fingerprint: 'fp',
      catalog: [],
      status: { ready: true },
    })).toBe(true);
    expect(agentProfileReady({
      active: { ...base, model_id: '' },
      draft: base,
      draft_fingerprint: 'fp',
      catalog: [],
      status: { ready: true },
    })).toBe(false);
    expect(agentProfileReady({
      active: base,
      draft: base,
      draft_fingerprint: 'fp',
      catalog: [],
      status: { ready: false },
    })).toBe(false);
  });

  it('merges a slim generation settings event without erasing Agent or System truth', () => {
    const current = {
      agent: { active: { model_id: 'brain' }, marker: 'agent' },
      generation: { profiles: [], validator_mode: 'deterministic', default_profile_id: 'old' },
      system: { api_version: 'v2', marker: 'system' },
    } as unknown as BootstrapPayload['settings'];
    const incoming = {
      generation: { profiles: [], validator_mode: 'deterministic', default_profile_id: 'new' },
    } as unknown as Partial<BootstrapPayload['settings']>;
    const merged = mergeSettingsSnapshot(current, incoming);
    expect(merged.agent).toBe(current.agent);
    expect(merged.system).toBe(current.system);
    expect(merged.generation.default_profile_id).toBe('new');
  });

  it('shows cancellation only for mutable job states', () => {
    expect(['queued', 'running', 'cancelling'].every(isCancellableJobState)).toBe(true);
    expect(['done', 'failed', 'cancelled', 'cancelled_after_commit'].some(isCancellableJobState)).toBe(false);
  });

  it('normalizes comma tags without blanks or duplicates', () => {
    expect(parseCommaTags(' warehouse, dub, warehouse, , fragile ')).toEqual([
      'warehouse',
      'dub',
      'fragile',
    ]);
  });
});
