import type {
  AgentConnectionDraft,
  AgentSettings,
  BootstrapPayload,
  BrainJob,
  BrainJobInput,
  EventEnvelope,
  GenerationJob,
  GenerationJobInput,
  ModelCatalogItem,
  Piece,
  PieceRevision,
  PreviewInput,
  ScoreInput,
} from './contracts';

type ApiBody = Record<string, unknown> | undefined;

export interface MutationIntent {
  readonly idempotencyKey: string;
}

export function createMutationIntent(): MutationIntent {
  return Object.freeze({ idempotencyKey: `producer-ui-${crypto.randomUUID()}` });
}

export class ApiError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init: RequestInit & { json?: ApiBody } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const response = await fetch(path, { ...init, headers, body });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string; detail?: string };
    throw new ApiError(payload.error || `Request failed (${response.status})`, response.status, payload.detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export class MutationOutcomeUnknownError extends Error {
  readonly intent: MutationIntent;

  constructor(intent: MutationIntent, cause: unknown) {
    super(
      'The server may have committed this operation before its response was received. '
      + 'Reconcile the unchanged operation with the same idempotency key.',
      { cause },
    );
    this.name = 'MutationOutcomeUnknownError';
    this.intent = intent;
  }
}

const intentRequests = new WeakMap<MutationIntent, string>();

function canonicalMutationValue(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalMutationValue(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => (
    `${JSON.stringify(key)}:${canonicalMutationValue(item)}`
  )).join(',')}}`;
}

function bindIntentToRequest(
  intent: MutationIntent,
  path: string,
  init: RequestInit & { json?: ApiBody },
): void {
  const requestIdentity = [
    String(init.method || 'POST').toUpperCase(),
    path,
    canonicalMutationValue(init.json),
  ].join('\n');
  const existing = intentRequests.get(intent);
  if (existing !== undefined && existing !== requestIdentity) {
    throw new Error('An idempotency intent cannot be reused with changed request content.');
  }
  intentRequests.set(intent, requestIdentity);
}

function outcomeIsUnknown(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 408 || error.status >= 500;
}

async function idempotentMutationRequest<T>(
  path: string,
  init: RequestInit & { json?: ApiBody },
  intent: MutationIntent,
): Promise<T> {
  bindIntentToRequest(intent, path, init);
  try {
    return await request<T>(path, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        'Idempotency-Key': intent.idempotencyKey,
      },
    });
  } catch (error) {
    if (outcomeIsUnknown(error)) {
      throw new MutationOutcomeUnknownError(intent, error);
    }
    throw error;
  }
}

async function mutationRequest<T>(
  path: string,
  init: RequestInit & { json?: ApiBody },
): Promise<T> {
  const intent = createMutationIntent();
  return request<T>(path, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      'Idempotency-Key': intent.idempotencyKey,
    },
  });
}

export const api = {
  bootstrap(signal?: AbortSignal): Promise<BootstrapPayload> {
    return request('/api/v2/bootstrap', { signal });
  },

  createGenerationJob(
    input: GenerationJobInput,
    intent: MutationIntent,
  ): Promise<{ job: GenerationJob }> {
    return idempotentMutationRequest('/api/v2/generation-jobs', {
      method: 'POST',
      json: { count: input.count, prompt: input.prompt, profile_id: input.profile_id },
    }, intent);
  },

  cancelJob(id: string): Promise<{ job: GenerationJob }> {
    return mutationRequest(`/api/v2/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  listPieces(includeArchived = false): Promise<{ pieces: Piece[] }> {
    return request(`/api/v2/pieces?archived=${includeArchived ? 'all' : 'active'}`);
  },

  getPiece(id: string): Promise<{ piece: Piece }> {
    return request(`/api/v2/pieces/${encodeURIComponent(id)}`);
  },

  patchPiece(id: string, patch: { archived?: boolean; name?: string; tags?: string[] }): Promise<{ piece: Piece }> {
    return mutationRequest(`/api/v2/pieces/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch });
  },

  createPreview(
    pieceId: string,
    input: PreviewInput,
    intent: MutationIntent,
  ): Promise<{ revision: PieceRevision; piece: Piece }> {
    return idempotentMutationRequest(`/api/v2/pieces/${encodeURIComponent(pieceId)}/previews`, {
      method: 'POST',
      json: { ...input },
    }, intent);
  },

  promoteRevision(pieceId: string, revisionId: string): Promise<{ piece: Piece; receipt?: unknown }> {
    return mutationRequest(`/api/v2/pieces/${encodeURIComponent(pieceId)}/revisions`, {
      method: 'POST',
      json: { revision_id: revisionId, action: 'promote' },
    });
  },

  scoreRevision(
    pieceId: string,
    revisionId: string,
    input: ScoreInput,
    intent: MutationIntent,
  ): Promise<{ piece: Piece }> {
    return idempotentMutationRequest(
      `/api/v2/pieces/${encodeURIComponent(pieceId)}/revisions/${encodeURIComponent(revisionId)}/score`,
      { method: 'PUT', json: { ...input } },
      intent,
    );
  },

  createBrainJob(
    input: BrainJobInput,
    intent: MutationIntent,
  ): Promise<{ job: BrainJob }> {
    return idempotentMutationRequest('/api/v2/brain/jobs', {
      method: 'POST',
      json: { ...input },
    }, intent);
  },

  getBrainJob(id: string): Promise<{ job: BrainJob }> {
    return request(`/api/v2/brain/jobs/${encodeURIComponent(id)}`);
  },

  cancelBrainJob(id: string): Promise<{ job: BrainJob }> {
    return mutationRequest(`/api/v2/brain/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  getAgentSettings(): Promise<AgentSettings> {
    return request('/api/v2/settings/agent');
  },

  discoverModels(draft: AgentConnectionDraft): Promise<{ catalog: ModelCatalogItem[]; fingerprint: string }> {
    return mutationRequest('/api/v2/settings/agent/catalog', {
      method: 'POST',
      json: {
        base_url: draft.base_url,
        api_key: draft.api_key,
        credential_ref: draft.credential_ref,
      },
    });
  },

  testAgent(draft: AgentConnectionDraft): Promise<AgentSettings> {
    return mutationRequest('/api/v2/settings/agent/test', { method: 'POST', json: { ...draft } });
  },

  applyAgent(draft: AgentConnectionDraft, testId: string): Promise<AgentSettings> {
    return mutationRequest('/api/v2/settings/agent/apply', {
      method: 'PUT',
      json: { draft, test_id: testId },
    });
  },

  resetAgentDraft(): Promise<AgentSettings> {
    return mutationRequest('/api/v2/settings/agent/reset', {
      method: 'POST',
      json: {},
    });
  },

  setGenerationDefault(profileId: string): Promise<unknown> {
    return mutationRequest('/api/v2/settings/generation/default', {
      method: 'PUT',
      json: { profile_id: profileId },
    });
  },

  syncGenerationProfiles(testId: string): Promise<unknown> {
    return mutationRequest('/api/v2/settings/generation/sync', {
      method: 'POST',
      json: { test_id: testId },
    });
  },
};

export function connectEvents(
  after: number,
  onEvent: (event: EventEnvelope) => void,
  onState: (state: 'connected' | 'retrying') => void,
): () => void {
  let stopped = false;
  let source: EventSource | undefined;
  let retryTimer: number | undefined;
  let cursor = after;

  const open = () => {
    if (stopped) return;
    source = new EventSource(`/api/v2/events?after=${cursor}`);
    source.onopen = () => onState('connected');
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as EventEnvelope;
        cursor = Math.max(cursor, event.seq || 0);
        onEvent(event);
      } catch {
        // A malformed event must not poison the durable bootstrap state.
      }
    };
    source.onerror = () => {
      onState('retrying');
      source?.close();
      retryTimer = window.setTimeout(open, 1400);
    };
  };
  open();
  return () => {
    stopped = true;
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    source?.close();
  };
}
