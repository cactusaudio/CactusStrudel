// G8: Claude challenger activation — no fallback masquerade.

import { describe, it, expect } from 'vitest';
import {
  RulesBackend, ClaudeShadowBackend, HybridBackend,
  createBackend, loadDispatcherFromEnv,
  type ClaudeDispatcher,
  ClaudeBackendNotConfigured,
} from './producer-backend.js';

describe('G8 no-masquerade', () => {
  it('rules backend always reports backend=rules', async () => {
    const r = await new RulesBackend().produce({ brief: 'techno 130 BPM' });
    expect(r.backend).toBe('rules');
  });

  it('claude-shadow throws ClaudeBackendNotConfigured when no dispatcher', async () => {
    const b = new ClaudeShadowBackend();
    await expect(b.produce({ brief: 'techno 130 BPM' })).rejects.toThrow(/dispatcher/i);
  });

  it('hybrid without dispatcher returns backend=rules (not hybrid) when not strict', async () => {
    const r = await new HybridBackend().produce({ brief: 'techno 130 BPM' });
    expect(r.backend).toBe('rules');
    expect(r.warnings.some((w) => /no Claude dispatcher.*no masquerade/.test(w))).toBe(true);
  });

  it('hybrid with strict=true throws when no dispatcher (no silent fallback)', async () => {
    const b = new HybridBackend({ strict: true });
    await expect(b.produce({ brief: 'techno 130 BPM' })).rejects.toThrow(/strict/);
  });

  it('hybrid with dispatcher that returns 0 patches downgrades label to rules', async () => {
    const dispatcher: ClaudeDispatcher = async () => ({ patches: [] });
    const r = await new HybridBackend({ dispatcher }).produce({ brief: 'techno 130 BPM' });
    expect(r.backend).toBe('rules');
    expect(r.warnings.some((w) => /label downgraded to rules/.test(w))).toBe(true);
  });

  it('hybrid with dispatcher returning a graph (not patches) downgrades to rules', async () => {
    // First produce a baseline so we can return its graph (it'd validate).
    // The hybrid backend rejects graph-mode output; it should NOT relabel as
    // hybrid even though the dispatcher was called.
    const dispatcher: ClaudeDispatcher = async ({ baselineGraph }) => ({ graph: baselineGraph });
    const r = await new HybridBackend({ dispatcher }).produce({ brief: 'techno 130 BPM' });
    expect(r.backend).toBe('rules');
    expect(r.warnings.some((w) => /rejected Claude full-graph/.test(w))).toBe(true);
  });

  it('hybrid with dispatcher returning ≥1 valid patch keeps backend=hybrid', async () => {
    // Patch the master gain — that's a valid producer-mix-engineer write.
    const dispatcher: ClaudeDispatcher = async () => ({
      patches: [{
        patch_id: '00000000-0000-4000-8000-000000000001',
        iteration: 0,
        agent: 'producer-mix-engineer',
        intent: 'tweak master gain',
        ops: [{ op: 'replace', path: '/mix_graph/master/gain', value: 0.95 }],
      }],
    });
    const r = await new HybridBackend({ dispatcher }).produce({ brief: 'techno 130 BPM' });
    expect(r.backend).toBe('hybrid');
    expect(r.graph.mix_graph.master.gain).toBe(0.95);
  });

  it('hybrid with dispatcher returning all-invalid patches downgrades to rules', async () => {
    // Patches that violate agent boundaries — every one gets skipped.
    const dispatcher: ClaudeDispatcher = async () => ({
      patches: [{
        patch_id: '00000000-0000-4000-8000-000000000002',
        iteration: 0,
        agent: 'producer-mix-engineer',
        intent: 'rogue write',
        ops: [{ op: 'replace', path: '/song/sections/0/start_bar', value: 0 }],
      }],
    });
    const r = await new HybridBackend({ dispatcher }).produce({ brief: 'techno 130 BPM' });
    expect(r.backend).toBe('rules');
  });

  it('createBackend("hybrid") composes the same as new HybridBackend()', async () => {
    const r = await createBackend('hybrid').produce({ brief: 'techno 130 BPM' });
    expect(r.backend).toBe('rules'); // no dispatcher in opts
  });

  it('createBackend("claude-shadow") throws on produce when no dispatcher', async () => {
    const b = createBackend('claude-shadow');
    await expect(b.produce({ brief: 'techno 130 BPM' })).rejects.toThrow(ClaudeBackendNotConfigured);
  });

  it('loadDispatcherFromEnv returns undefined when env var is unset', async () => {
    const before = process.env.CACTUS_CLAUDE_DISPATCHER;
    delete process.env.CACTUS_CLAUDE_DISPATCHER;
    try {
      const d = await loadDispatcherFromEnv();
      expect(d).toBeUndefined();
    } finally {
      if (before !== undefined) process.env.CACTUS_CLAUDE_DISPATCHER = before;
    }
  });

  it('loadDispatcherFromEnv throws when env var points to a missing module (no silent failure)', async () => {
    const before = process.env.CACTUS_CLAUDE_DISPATCHER;
    process.env.CACTUS_CLAUDE_DISPATCHER = '/does/not/exist/dispatcher.mjs';
    try {
      await expect(loadDispatcherFromEnv()).rejects.toThrow(ClaudeBackendNotConfigured);
    } finally {
      if (before !== undefined) process.env.CACTUS_CLAUDE_DISPATCHER = before;
      else delete process.env.CACTUS_CLAUDE_DISPATCHER;
    }
  });
});
