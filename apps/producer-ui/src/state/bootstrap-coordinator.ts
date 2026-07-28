export interface CursorSnapshot {
  cursor: number;
}

export type BootstrapRefreshResult<T extends CursorSnapshot> = {
  snapshot: T;
  applied: boolean;
  reason?: 'older-cursor' | 'older-request';
};

interface BootstrapCoordinatorOptions<T extends CursorSnapshot> {
  fetchSnapshot: (signal?: AbortSignal) => Promise<T>;
  getCurrent: () => T | undefined;
  apply: (snapshot: T) => void;
}

/**
 * Serializes snapshot authority without serializing network requests.
 *
 * Cursor order always wins. When two responses carry the same cursor, request
 * order breaks the tie so an older background request cannot overwrite a newer
 * mutation readback.
 */
export class BootstrapCoordinator<T extends CursorSnapshot> {
  private nextRequestId = 0;
  private lastAppliedRequestId = 0;

  constructor(private readonly options: BootstrapCoordinatorOptions<T>) {}

  /**
   * Marks a focused endpoint readback as newer than every bootstrap already
   * in flight. A later snapshot with a higher durable cursor still wins.
   */
  markExternalApply(): void {
    this.lastAppliedRequestId = ++this.nextRequestId;
  }

  async refresh(signal?: AbortSignal): Promise<BootstrapRefreshResult<T>> {
    const requestId = ++this.nextRequestId;
    const incoming = await this.options.fetchSnapshot(signal);
    const current = this.options.getCurrent();

    if (current && incoming.cursor < current.cursor) {
      return {
        snapshot: current,
        applied: false,
        reason: 'older-cursor',
      };
    }
    if (
      current
      && incoming.cursor === current.cursor
      && requestId < this.lastAppliedRequestId
    ) {
      return {
        snapshot: current,
        applied: false,
        reason: 'older-request',
      };
    }

    this.options.apply(incoming);
    this.lastAppliedRequestId = Math.max(this.lastAppliedRequestId, requestId);
    return {
      snapshot: this.options.getCurrent() || incoming,
      applied: true,
    };
  }
}
