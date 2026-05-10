import { describe, it, expect } from 'vitest';
import { v4 as uuid } from 'uuid';
import {
  RulesBackend,
  ClaudeShadowBackend,
  HybridBackend,
  ClaudeBackendNotConfigured,
  createBackend,
} from './index.js';
import type { Patch, SessionGraph } from '@cactus/ir';

describe('RulesBackend', () => {
  it('produces a validator-clean graph from a techno brief', async () => {
    const r = await new RulesBackend().produce({ brief: 'peak time techno 130 BPM' });
    expect(r.backend).toBe('rules');
    expect(r.validator_issues).toBe(0);
    expect(r.graph.layers.length).toBeGreaterThan(0);
  });

  it('throws when no genre detected', async () => {
    await expect(new RulesBackend().produce({ brief: 'something nondescript' })).rejects.toThrow(/primary_genre/);
  });

  it('is deterministic with same seed', async () => {
    const a = await new RulesBackend().produce({ brief: 'dub techno 130 BPM', seed: 42 });
    const b = await new RulesBackend().produce({ brief: 'dub techno 130 BPM', seed: 42 });
    expect(a.graph.pattern_bank).toEqual(b.graph.pattern_bank);
  });
});

describe('ClaudeShadowBackend', () => {
  it('throws ClaudeBackendNotConfigured without a dispatcher', async () => {
    const backend = new ClaudeShadowBackend({});
    await expect(backend.produce({ brief: 'techno 130 BPM' })).rejects.toBeInstanceOf(ClaudeBackendNotConfigured);
  });

  it('accepts a dispatcher returning a valid full graph', async () => {
    const dispatcher = async ({ baselineGraph }: { baselineGraph: SessionGraph }) => ({ graph: baselineGraph });
    const r = await new ClaudeShadowBackend({ dispatcher }).produce({ brief: 'techno 130 BPM', seed: 1 });
    expect(r.backend).toBe('claude-shadow');
    expect(r.validator_issues).toBe(0);
  });

  it('rejects a dispatcher returning a malformed graph', async () => {
    const dispatcher = async () => ({ graph: { not: 'a graph' } });
    await expect(new ClaudeShadowBackend({ dispatcher }).produce({ brief: 'techno 130 BPM' }))
      .rejects.toThrow(/zod validation/);
  });

  it('applies dispatcher patches and skips boundary-violating ones', async () => {
    const dispatcher = async ({ baselineGraph }: { baselineGraph: SessionGraph }) => {
      const layer = baselineGraph.layers[0]!;
      const goodPatch: Patch = {
        patch_id: uuid(),
        iteration: 1,
        agent: 'producer-mix-engineer',
        intent: 'narrow kick width',
        ops: [{ op: 'replace', path: `/mix_graph/orbits/${layer.orbit}/width`, value: 0.5 }],
      };
      const violatingPatch: Patch = {
        patch_id: uuid(),
        iteration: 1,
        agent: 'producer-mix-engineer', // mix-engineer cannot write /brief
        intent: 'rewrite brief',
        ops: [{ op: 'replace', path: '/brief/text', value: 'hijacked' }],
      };
      return { patches: [goodPatch, violatingPatch] };
    };
    const r = await new ClaudeShadowBackend({ dispatcher }).produce({ brief: 'techno 130 BPM', seed: 2 });
    // Mix-graph width should be set to 0.5 on the kick orbit; brief should be unchanged.
    expect(r.graph.brief.text).toBe('techno 130 BPM');
  });
});

describe('HybridBackend', () => {
  it('falls back to rules when no dispatcher configured', async () => {
    const r = await new HybridBackend({}).produce({ brief: 'techno 130 BPM' });
    expect(r.backend).toBe('hybrid');
    expect(r.warnings.some((w) => /no Claude dispatcher/.test(w))).toBe(true);
    expect(r.validator_issues).toBe(0);
  });

  it('rejects full-graph replacement (patch-only mode)', async () => {
    const dispatcher = async ({ baselineGraph }: { baselineGraph: SessionGraph }) => ({ graph: baselineGraph });
    const r = await new HybridBackend({ dispatcher }).produce({ brief: 'techno 130 BPM' });
    expect(r.warnings.some((w) => /rejected Claude full-graph/.test(w))).toBe(true);
  });

  it('applies dispatcher patches over the rules baseline', async () => {
    const dispatcher = async ({ baselineGraph }: { baselineGraph: SessionGraph }) => {
      const layer = baselineGraph.layers[0]!;
      const p: Patch = {
        patch_id: uuid(),
        iteration: 1,
        agent: 'producer-mix-engineer',
        intent: 'tweak gain',
        ops: [{ op: 'replace', path: `/mix_graph/orbits/${layer.orbit}/gain`, value: 0.42 }],
      };
      return { patches: [p] };
    };
    const r = await new HybridBackend({ dispatcher }).produce({ brief: 'techno 130 BPM', seed: 3 });
    const layer = r.graph.layers[0]!;
    expect(r.graph.mix_graph.orbits[String(layer.orbit)]!.gain).toBe(0.42);
  });
});

describe('createBackend factory', () => {
  it('builds rules / claude-shadow / hybrid', () => {
    expect(createBackend('rules').name).toBe('rules');
    expect(createBackend('claude-shadow').name).toBe('claude-shadow');
    expect(createBackend('hybrid').name).toBe('hybrid');
  });
});
