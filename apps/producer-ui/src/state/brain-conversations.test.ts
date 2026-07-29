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

describe('Brain threads (A1: multi-session)', () => {
  it('selection round-trips and clears back to context-following', () => {
    const store = new AppStore();
    expect(store.getSnapshot().selectedBrainThreadId).toBeUndefined();
    store.selectBrainThread('thread-123');
    expect(store.getSnapshot().selectedBrainThreadId).toBe('thread-123');
    store.selectBrainThread(undefined);
    expect(store.getSnapshot().selectedBrainThreadId).toBeUndefined();
  });

  it('starting a thread clears the board and returns a fresh id', () => {
    const store = new AppStore();
    store.setBrainComposer('half-typed question');
    const first = store.startBrainThread();
    expect(first).toMatch(/^thread-/);
    expect(store.getSnapshot().selectedBrainThreadId).toBe(first);
    // Clearing the board means the composer is empty, not carried over.
    expect(store.getSnapshot().brainComposer).toBe('');
    const second = store.startBrainThread();
    expect(second).not.toBe(first);
  });

  it('composer text persists across screen lifecycles (A4)', () => {
    const store = new AppStore();
    store.setBrainComposer('bass question');
    expect(store.getSnapshot().brainComposer).toBe('bass question');
  });
});
