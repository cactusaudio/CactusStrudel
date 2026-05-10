import { describe, it, expect } from 'vitest';
import { createSessionGraph } from '@cactus/ir';
import { scoreRevisionLocality } from './index.js';

describe('scoreRevisionLocality', () => {
  it('reports zero drift when only requested paths changed', () => {
    const before = createSessionGraph({ brief: { text: 'techno 130 BPM' } });
    const after = structuredClone(before);
    after.mix_graph.master.gain = 0.85;
    const r = scoreRevisionLocality({
      before,
      after,
      requested_paths: ['/mix_graph/master/gain'],
    });
    expect(r.unrelated_changed_count).toBe(0);
    expect(r.unrelated_change_ratio).toBe(0);
    expect(r.drift_severity).toBe(0);
  });

  it('flags drift when unrelated paths changed', () => {
    const before = createSessionGraph({ brief: { text: 'techno 130 BPM' } });
    const after = structuredClone(before);
    after.mix_graph.master.gain = 0.85;
    after.brief.bpm = 200;
    after.song.total_bars = 99;
    const r = scoreRevisionLocality({
      before,
      after,
      requested_paths: ['/mix_graph/master/gain'],
    });
    expect(r.unrelated_changed_count).toBeGreaterThan(0);
    expect(r.drift_severity).toBeGreaterThan(0);
  });

  it('detects invariant violation when a forbidden path changed', () => {
    const before = createSessionGraph({ brief: { text: 'techno 130 BPM, 132 bpm' } });
    const after = structuredClone(before);
    after.brief.bpm = 200;
    const r = scoreRevisionLocality({
      before,
      after,
      requested_paths: ['/mix_graph/master/gain'],
      invariants: [{ path: '/brief/bpm', description: 'user explicitly set BPM' }],
    });
    expect(r.invariant_violations.length).toBe(1);
    expect(r.invariant_violations[0]!.path).toBe('/brief/bpm');
    expect(r.drift_severity).toBeGreaterThan(0);
  });

  it('treats descendant changes as related to requested parent', () => {
    const before = createSessionGraph({ brief: { text: 'techno 130 BPM' } });
    const after = structuredClone(before);
    after.mix_graph.master.gain = 0.7;
    after.mix_graph.master.lufs_target = -8;
    const r = scoreRevisionLocality({
      before,
      after,
      requested_paths: ['/mix_graph/master'],
    });
    expect(r.unrelated_change_ratio).toBe(0);
  });

  it('zero changes → zero drift, zero ratio', () => {
    const before = createSessionGraph({ brief: { text: 'techno 130 BPM' } });
    const after = structuredClone(before);
    const r = scoreRevisionLocality({ before, after, requested_paths: [] });
    expect(r.changed_paths.length).toBe(0);
    expect(r.unrelated_change_ratio).toBe(0);
    expect(r.drift_severity).toBe(0);
  });
});
