import { describe, expect, it } from 'vitest';
import { BootstrapCoordinator } from './bootstrap-coordinator';

interface TestSnapshot {
  cursor: number;
  value: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('bootstrap coordinator', () => {
  it('discards a delayed bootstrap that arrives after a newer SSE state', async () => {
    let current: TestSnapshot | undefined = {
      cursor: 10,
      value: 'before-sse',
    };
    let applyCount = 0;
    const pending = deferred<TestSnapshot>();
    const coordinator = new BootstrapCoordinator<TestSnapshot>({
      fetchSnapshot: () => pending.promise,
      getCurrent: () => current,
      apply: (snapshot) => {
        applyCount += 1;
        current = snapshot;
      },
    });

    const refresh = coordinator.refresh();
    current = { cursor: 11, value: 'from-sse' };
    pending.resolve({ cursor: 10, value: 'stale-background' });

    await expect(refresh).resolves.toMatchObject({
      applied: false,
      reason: 'older-cursor',
      snapshot: { cursor: 11, value: 'from-sse' },
    });
    expect(applyCount).toBe(0);
    expect(current).toEqual({ cursor: 11, value: 'from-sse' });
  });

  it('does not let an older equal-cursor refresh overwrite a mutation readback', async () => {
    let current: TestSnapshot | undefined = {
      cursor: 20,
      value: 'before-settings-mutation',
    };
    const requests: Array<ReturnType<typeof deferred<TestSnapshot>>> = [];
    const coordinator = new BootstrapCoordinator<TestSnapshot>({
      fetchSnapshot: () => {
        const request = deferred<TestSnapshot>();
        requests.push(request);
        return request.promise;
      },
      getCurrent: () => current,
      apply: (snapshot) => {
        current = snapshot;
      },
    });

    const background = coordinator.refresh();
    const settingsReadback = coordinator.refresh();
    requests[1]!.resolve({ cursor: 20, value: 'settings-readback' });
    await expect(settingsReadback).resolves.toMatchObject({ applied: true });

    requests[0]!.resolve({ cursor: 20, value: 'stale-background' });
    await expect(background).resolves.toMatchObject({
      applied: false,
      reason: 'older-request',
      snapshot: { cursor: 20, value: 'settings-readback' },
    });
    expect(current).toEqual({ cursor: 20, value: 'settings-readback' });
  });

  it('protects an equal-cursor focused endpoint readback from pending bootstrap', async () => {
    let current: TestSnapshot | undefined = {
      cursor: 30,
      value: 'before-agent-readback',
    };
    const pending = deferred<TestSnapshot>();
    const coordinator = new BootstrapCoordinator<TestSnapshot>({
      fetchSnapshot: () => pending.promise,
      getCurrent: () => current,
      apply: (snapshot) => {
        current = snapshot;
      },
    });

    const background = coordinator.refresh();
    coordinator.markExternalApply();
    current = { cursor: 30, value: 'focused-agent-readback' };
    pending.resolve({ cursor: 30, value: 'stale-background' });

    await expect(background).resolves.toMatchObject({
      applied: false,
      reason: 'older-request',
      snapshot: { cursor: 30, value: 'focused-agent-readback' },
    });
    expect(current).toEqual({ cursor: 30, value: 'focused-agent-readback' });
  });
});
