import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PieceRevision } from './contracts';

type EventHandler = () => void;

class FakeAudio {
  preload = '';
  volume = 1;
  paused = true;
  currentTime = 0;
  duration = 120;
  src = '';
  playCalls = 0;
  private readonly listeners = new Map<string, Set<EventHandler>>();

  addEventListener(type: string, handler: EventHandler): void {
    const handlers = this.listeners.get(type) || new Set<EventHandler>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  emit(type: string): void {
    this.listeners.get(type)?.forEach((handler) => handler());
  }

  async play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    this.emit('play');
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.emit('pause');
  }

  load(): void {
    this.emit('loadstart');
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  externalPause(): void {
    this.paused = true;
    this.emit('pause');
  }
}

function revision(id: string, duration = 120): PieceRevision {
  return {
    id,
    piece_id: 'piece-1',
    created_at: 'now',
    code: `sound("${id}")`,
    audio_url: `/audio/${id}.wav`,
    audio_sha: `sha-${id}`,
    duration_seconds: duration,
    provenance: {},
  };
}

let AudioEngine: (typeof import('./audio-engine'))['AudioEngine'];

beforeAll(async () => {
  vi.stubGlobal('Audio', FakeAudio);
  ({ AudioEngine } = await import('./audio-engine'));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('audio engine playback intent', () => {
  it('preserves playback intent across its own source-switch pause', async () => {
    const audio = new FakeAudio();
    const engine = new AudioEngine(audio as unknown as HTMLAudioElement);
    engine.load(revision('a'), true);
    await Promise.resolve();

    engine.switchRevision(revision('b'), true);
    await Promise.resolve();

    expect(engine.getSnapshot().revision?.id).toBe('b');
    expect(engine.wantsPlayback()).toBe(true);
    expect(engine.getSnapshot().desiredPlaying).toBe(true);
    expect(audio.playCalls).toBe(2);
  });

  it('clears playback intent on an external pause so one toggle resumes', async () => {
    const audio = new FakeAudio();
    const engine = new AudioEngine(audio as unknown as HTMLAudioElement);
    engine.load(revision('a'), true);
    await Promise.resolve();

    audio.externalPause();
    expect(engine.wantsPlayback()).toBe(false);
    expect(engine.getSnapshot()).toMatchObject({
      state: 'paused',
      desiredPlaying: false,
    });

    engine.toggle();
    await Promise.resolve();
    expect(engine.wantsPlayback()).toBe(true);
    expect(audio.playCalls).toBe(2);
  });

  it('applies a seek requested while metadata is loading', () => {
    const audio = new FakeAudio();
    const engine = new AudioEngine(audio as unknown as HTMLAudioElement);
    engine.load(revision('a'), false);

    engine.seek(42);
    expect(engine.getSnapshot().currentTime).toBe(42);
    audio.emit('loadedmetadata');

    expect(audio.currentTime).toBe(42);
    expect(engine.getSnapshot().currentTime).toBe(42);
  });
});
