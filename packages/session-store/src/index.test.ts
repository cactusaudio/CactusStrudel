import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSessionGraph } from '@cactus/ir';
import { SessionStore } from './index.js';

describe('SessionStore', () => {
  it('creates, appends, lists, and loads validated iterations', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cactus-session-store-'));
    const store = new SessionStore({ rootDir });
    const graph = createSessionGraph({ brief: { text: 'store smoke', bpm: 124 } });

    await store.createSession(graph);
    expect(await store.listIterations(graph.session_id)).toEqual([0]);

    const nextGraph = structuredClone(graph);
    nextGraph.iteration_log.push({
      iteration_n: 0,
      timestamp: new Date().toISOString(),
      kind: 'sketch',
      agent: 'test',
      patches: [],
    });
    await expect(store.appendIteration(nextGraph)).resolves.toBe(1);
    expect(await store.listIterations(graph.session_id)).toEqual([0, 1]);

    const loaded = await store.loadIteration(graph.session_id, 1);
    expect(loaded.session_id).toBe(graph.session_id);
    expect(loaded.brief.bpm).toBe(124);
  });

  it('rejects persisted graphs with unknown top-level fields', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cactus-session-store-strict-'));
    const store = new SessionStore({ rootDir });
    const graph = createSessionGraph({ brief: { text: 'strict load' } });
    await store.createSession(graph);

    const iter0 = path.join(rootDir, graph.session_id, 'iter_0000.json');
    const corrupted = { ...graph, uncompiled_shadow_field: true };
    await fs.writeFile(iter0, JSON.stringify(corrupted, null, 2));

    await expect(store.loadIteration(graph.session_id, 0)).rejects.toThrow(/unrecognized key/i);
  });

  it('chooses the next iteration from disk so stale callers cannot overwrite files', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cactus-session-store-next-'));
    const store = new SessionStore({ rootDir });
    const graph = createSessionGraph({ brief: { text: 'no overwrite' } });
    await store.createSession(graph);

    const sessionDir = path.join(rootDir, graph.session_id);
    await fs.writeFile(path.join(sessionDir, 'iter_0001.json'), JSON.stringify(graph, null, 2));

    const staleGraph = structuredClone(graph);
    staleGraph.iteration_log = [];
    await expect(store.appendIteration(staleGraph)).resolves.toBe(2);
    expect(await store.listIterations(graph.session_id)).toEqual([0, 1, 2]);
  });

  it('does not leave iteration writes in a partially named final file', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cactus-session-store-atomic-'));
    const store = new SessionStore({ rootDir });
    const graph = createSessionGraph({ brief: { text: 'atomic write' } });

    await store.createSession(graph);
    const sessionDir = path.join(rootDir, graph.session_id);
    const files = await fs.readdir(sessionDir);

    expect(files).toEqual(['iter_0000.json']);
    await expect(store.loadIteration(graph.session_id, 0)).resolves.toMatchObject({
      session_id: graph.session_id,
    });
  });

  it('loads old supported graphs through the migration entrypoint', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cactus-session-store-migrate-'));
    const store = new SessionStore({ rootDir });
    const graph = createSessionGraph({ brief: { text: 'migrate load' } });
    await store.createSession(graph);

    const iter0 = path.join(rootDir, graph.session_id, 'iter_0000.json');
    await fs.writeFile(iter0, JSON.stringify({ ...graph, schema_version: '1.0.0' }, null, 2));

    const loaded = await store.loadIteration(graph.session_id, 0);
    expect(loaded.schema_version).toBe('1.1.0');
    expect(loaded.session_id).toBe(graph.session_id);
  });
});
