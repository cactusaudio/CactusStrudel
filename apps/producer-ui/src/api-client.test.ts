import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  createMutationIntent,
  MutationOutcomeUnknownError,
} from './api-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mutation intent receipts', () => {
  it('reuses one key to reconcile an unknown outcome and gives a new explicit intent a new key', async () => {
    const observed: string[] = [];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (_path: string, init?: RequestInit) => {
      observed.push(new Headers(init?.headers).get('Idempotency-Key') || '');
      call += 1;
      if (call === 1) throw new TypeError('connection ended before response');
      return new Response(JSON.stringify({
        job: {
          id: `job-${call}`,
          state: 'queued',
          created_at: 'now',
          count: 1,
          completed_count: 0,
          piece_ids: [],
        },
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const input = {
      count: 1 as const,
      prompt: 'same human intent',
      profile_id: 'composer',
    };
    const unresolved = createMutationIntent();
    await expect(api.createGenerationJob(input, unresolved))
      .rejects.toBeInstanceOf(MutationOutcomeUnknownError);
    await expect(api.createGenerationJob(input, unresolved)).resolves.toHaveProperty(
      'job.id',
      'job-2',
    );
    await expect(api.createGenerationJob(input, createMutationIntent())).resolves.toHaveProperty(
      'job.id',
      'job-3',
    );

    expect(observed[0]).toBeTruthy();
    expect(observed[1]).toBe(observed[0]);
    expect(observed[2]).not.toBe(observed[1]);
  });

  it('refuses to reuse an intent after the endpoint or canonical content changes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      job: {
        id: 'job-1',
        state: 'queued',
        created_at: 'now',
        count: 1,
        completed_count: 0,
        piece_ids: [],
      },
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const intent = createMutationIntent();
    await api.createGenerationJob({
      count: 1,
      prompt: 'intent-a',
      profile_id: 'composer',
    }, intent);
    await expect(api.createGenerationJob({
      count: 1,
      prompt: 'intent-b',
      profile_id: 'composer',
    }, intent)).rejects.toThrow('cannot be reused with changed request content');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses each supplied operation key for generation, preview, score, and Brain', async () => {
    const observed = new Map<string, string[]>();
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const keys = observed.get(path) || [];
      keys.push(new Headers(init?.headers).get('Idempotency-Key') || '');
      observed.set(path, keys);
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const operations = [
      (intent: ReturnType<typeof createMutationIntent>) => api.createGenerationJob({
        count: 1,
        prompt: 'first shot',
        profile_id: 'composer',
      }, intent),
      (intent: ReturnType<typeof createMutationIntent>) => api.createPreview('piece-1', {
        code: 'sound("bd")',
        source_revision_id: 'rev-1',
      }, intent),
      (intent: ReturnType<typeof createMutationIntent>) => api.scoreRevision('piece-1', 'rev-1', {
        audio_sha: 'sha-1',
        score: 8,
      }, intent),
      (intent: ReturnType<typeof createMutationIntent>) => api.createBrainJob({
        message: 'inspect this revision',
        piece_id: 'piece-1',
        revision_id: 'rev-1',
        audio_sha: 'sha-1',
      }, intent),
    ];

    for (const operation of operations) {
      const first = createMutationIntent();
      const second = createMutationIntent();
      await operation(first);
      await operation(second);
    }

    expect(observed.size).toBe(4);
    observed.forEach((keys) => {
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBeTruthy();
      expect(keys[1]).toBeTruthy();
      expect(keys[0]).not.toBe(keys[1]);
    });
  });

  it('keeps a concrete client error definitive rather than labelling it outcome-unknown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'conflict',
      detail: 'idempotency key belongs to different bytes',
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(api.createGenerationJob({
      count: 1,
      prompt: 'first shot',
      profile_id: 'composer',
    }, createMutationIntent())).rejects.not.toBeInstanceOf(MutationOutcomeUnknownError);
  });
});
