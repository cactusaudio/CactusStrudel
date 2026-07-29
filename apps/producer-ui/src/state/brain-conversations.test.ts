import { describe, expect, it, vi } from 'vitest';

vi.mock('../audio-engine', () => ({
  audioEngine: {
    load: vi.fn(),
    stop: vi.fn(),
    switchRevision: vi.fn(),
    wantsPlayback: vi.fn(() => false),
  },
}));

import { AppStore } from '../store';

describe('Brain conversation selection (A1)', () => {
  it('selection round-trips through the store and survives clearing', () => {
    const store = new AppStore();
    expect(store.getSnapshot().selectedBrainJobId).toBeUndefined();
    store.selectBrainJob('brain-123');
    expect(store.getSnapshot().selectedBrainJobId).toBe('brain-123');
    store.selectBrainJob(undefined);
    expect(store.getSnapshot().selectedBrainJobId).toBeUndefined();
  });

  it('composer text persists in the store across screen lifecycles (A4)', () => {
    const store = new AppStore();
    store.setBrainComposer('half-typed question about the bass');
    expect(store.getSnapshot().brainComposer).toBe(
      'half-typed question about the bass',
    );
    store.setBrainComposer('');
    expect(store.getSnapshot().brainComposer).toBe('');
  });
});
