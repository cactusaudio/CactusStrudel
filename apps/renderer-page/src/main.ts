// Renderer page entry. Loads @strudel/web and exposes window.__cactusRender.
// Real implementation lands in Phase 4 (ADR 0002).

declare global {
  interface Window {
    __cactusRender: (input: {
      code: string;
      durationCycles: number;
      sampleRate?: number;
      cps?: number;
    }) => Promise<{ pcm: Float32Array; sampleRate: number; channels: number }>;
    __cactusReady: boolean;
  }
}

window.__cactusReady = false;
window.__cactusRender = async () => {
  throw new Error('renderer-page Phase 4 stub: __cactusRender not wired yet');
};

window.__cactusReady = true;
console.log('[cactus] renderer-page boot stub active');

export {};
