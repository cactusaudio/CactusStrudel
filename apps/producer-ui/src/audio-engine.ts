import type { PieceRevision, TransportState } from './contracts';
import { resumePosition } from './state/invariants';

export interface AudioSnapshot {
  state: TransportState;
  revision?: PieceRevision;
  currentTime: number;
  duration: number;
  volume: number;
  desiredPlaying: boolean;
  error?: string;
}

type Listener = () => void;

export class AudioEngine {
  private listeners = new Set<Listener>();
  private pendingSeek?: number;
  private desiredPlaying = false;
  private ignoreNextPauseEvent = false;
  private snapshot: AudioSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 0.82,
    desiredPlaying: false,
  };

  constructor(private readonly audio: HTMLAudioElement = new Audio()) {
    this.audio.preload = 'metadata';
    this.audio.volume = this.snapshot.volume;
    this.audio.addEventListener('loadstart', () => this.patch({ state: 'loading', error: undefined }));
    this.audio.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek !== undefined) {
        const limit = Number.isFinite(this.audio.duration) ? Math.max(0, this.audio.duration - 0.01) : this.pendingSeek;
        this.audio.currentTime = Math.max(0, Math.min(this.pendingSeek, limit));
        this.pendingSeek = undefined;
      }
      this.patch({
        state: this.audio.paused ? 'paused' : 'playing',
        currentTime: this.audio.currentTime,
        duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      });
      if (this.desiredPlaying && this.audio.paused) void this.play();
    });
    this.audio.addEventListener('timeupdate', () => {
      this.patch({
        currentTime: this.audio.currentTime,
        duration: Number.isFinite(this.audio.duration) ? this.audio.duration : this.snapshot.duration,
      });
    });
    this.audio.addEventListener('play', () => {
      this.ignoreNextPauseEvent = false;
      this.patch({ state: 'playing', error: undefined });
    });
    this.audio.addEventListener('pause', () => {
      if (this.ignoreNextPauseEvent) {
        this.ignoreNextPauseEvent = false;
        return;
      }
      this.desiredPlaying = false;
      if (this.snapshot.state !== 'idle' && this.snapshot.state !== 'error') {
        this.patch({ state: 'paused', desiredPlaying: false });
      } else {
        this.patch({ desiredPlaying: false });
      }
    });
    this.audio.addEventListener('ended', () => {
      this.desiredPlaying = false;
      this.patch({ state: 'paused', currentTime: 0, desiredPlaying: false });
    });
    this.audio.addEventListener('error', () => {
      this.desiredPlaying = false;
      this.patch({
        state: 'error',
        error: 'Audio could not be loaded.',
        desiredPlaying: false,
      });
    });
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AudioSnapshot => this.snapshot;

  wantsPlayback = (): boolean => this.desiredPlaying;

  load(revision: PieceRevision, autoplay = false): void {
    this.loadAt(revision, autoplay, 0);
  }

  switchRevision(revision: PieceRevision, autoplay = false): void {
    const targetTime = resumePosition(
      this.snapshot.currentTime,
      this.snapshot.duration,
      revision.duration_seconds || 0,
    );
    this.loadAt(revision, autoplay, Math.max(0, targetTime));
  }

  private loadAt(revision: PieceRevision, autoplay: boolean, seekTo: number): void {
    const same = this.snapshot.revision?.id === revision.id
      && this.snapshot.revision?.audio_sha === revision.audio_sha;
    if (!same) {
      this.desiredPlaying = autoplay;
      if (!this.audio.paused) this.ignoreNextPauseEvent = true;
      this.audio.pause();
      this.pendingSeek = seekTo;
      this.audio.src = revision.audio_url;
      this.snapshot = {
        ...this.snapshot,
        state: 'loading',
        revision,
        currentTime: seekTo,
        duration: revision.duration_seconds || 0,
        desiredPlaying: autoplay,
        error: undefined,
      };
      this.emit();
      this.audio.load();
    }
    if (autoplay) void this.play();
  }

  async play(): Promise<void> {
    this.desiredPlaying = true;
    this.patch({ desiredPlaying: true });
    try {
      await this.audio.play();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      this.desiredPlaying = false;
      this.patch({
        state: 'error',
        error: error instanceof Error ? error.message : 'Playback was blocked.',
        desiredPlaying: false,
      });
    }
  }

  pause(): void {
    this.desiredPlaying = false;
    this.patch({ desiredPlaying: false });
    this.audio.pause();
  }

  toggle(): void {
    if (this.desiredPlaying) this.pause();
    else void this.play();
  }

  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const target = Math.max(
      0,
      Math.min(seconds, this.snapshot.duration || seconds),
    );
    if (this.snapshot.state === 'loading') {
      this.pendingSeek = target;
      this.patch({ currentTime: target });
      return;
    }
    this.audio.currentTime = target;
    this.patch({ currentTime: this.audio.currentTime });
  }

  setVolume(value: number): void {
    const volume = Math.max(0, Math.min(1, value));
    this.audio.volume = volume;
    this.patch({ volume });
  }

  stop(): void {
    this.desiredPlaying = false;
    this.audio.pause();
    this.pendingSeek = undefined;
    this.audio.removeAttribute('src');
    this.audio.load();
    this.snapshot = {
      state: 'idle',
      currentTime: 0,
      duration: 0,
      volume: this.snapshot.volume,
      desiredPlaying: false,
    };
    this.emit();
  }

  private patch(patch: Partial<AudioSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export const audioEngine = new AudioEngine();
