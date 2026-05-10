// Cactus Strudel renderer page — exposes window.__cactusRender for Playwright.
//
// Approach: initialize @strudel/web in a real AudioContext so workers / samples can prebake,
// then for each render call we close the live context, swap in an OfflineAudioContext, run
// superdough() against ordered haps, and return a Float32Array PCM buffer.
//
// Logic adapted from @strudel/webaudio's renderPatternAudio (AGPL-3.0-or-later) but rewritten
// to return raw PCM instead of triggering a browser download.

import { initStrudel, evaluate, hush } from '@strudel/web';
import {
  getAudioContext,
  setAudioContext,
  setSuperdoughAudioController,
  initAudio,
  superdough,
  resetGlobalEffects,
  getSound,
  registerSynthSounds,
} from '@strudel/webaudio';
// hap2value lives only in @strudel/webaudio's webaudio.mjs and isn't always re-exported;
// inline the equivalent logic so we don't depend on an internal symbol.
function hap2value(hap: any): any {
  const onTrigger = hap.context?.onTrigger;
  hap.context = { ...hap.context, onTrigger: undefined };
  const v = { ...hap.value, _hap: hap, onTrigger };
  delete v._strudel;
  return v;
}

declare global {
  interface Window {
    __cactusReady: boolean;
    __cactusVersions: Record<string, string>;
    __cactusRender: (input: {
      code: string;
      durationCycles: number;
      cps?: number;
      sampleRate?: number;
      maxPolyphony?: number;
      multiChannelOrbits?: number[];
    }) => Promise<{
      pcmBase64: string;
      sampleRate: number;
      channels: number;
      durationSec: number;
      warnings: string[];
    }>;
    __cactusInitError?: string;
    __cactusSampleRegistry?: () => Array<{ name: string; type: 'sample' | 'synth' | 'unknown' }>;
    initStrudel?: typeof initStrudel;
  }
}

const VERSIONS: Record<string, string> = {
  '@strudel/web': '1.3.0',
  '@strudel/core': '1.2.6',
  '@strudel/mini': '1.2.6',
  '@strudel/webaudio': '1.3.0',
  '@strudel/transpiler': '1.2.6',
  '@strudel/tonal': '1.2.6',
};

window.__cactusReady = false;
window.__cactusVersions = VERSIONS;
(window as any).__cactusBootLog = ['boot:script-loaded'];

const blog = (msg: string) => {
  (window as any).__cactusBootLog.push(`${Date.now()}:${msg}`);
  console.log(`[cactus] ${msg}`);
};

void (async () => {
  try {
    blog('init:starting');
    const initPromise = initStrudel({
      prebake: async () => {
        // Try to load dirt-samples for sample-based patterns (bd, sd, hh, cp, etc.).
        // Network failure is non-fatal — synth-based patterns will still work.
        try {
          const { samples } = await import('@strudel/webaudio');
          if (typeof samples === 'function') {
            blog('init:samples-loading');
            await samples('github:tidalcycles/dirt-samples');
            blog('init:samples-loaded');
          }
        } catch (e) {
          blog('init:samples-skipped:' + (e instanceof Error ? e.message : 'err'));
        }
      },
    });
    blog('init:promise-created');
    await initPromise;
    blog('init:resolved');
    try { hush(); blog('init:hush-ok'); } catch (e) {
      blog('init:hush-skipped:' + (e instanceof Error ? e.message : 'err'));
    }
    // G4: probe a fixed list of well-known names for sample/synth availability.
    // The list is the conformance contract — adding to it implies a renderer
    // version bump.
    window.__cactusSampleRegistry = () => {
      const probes = [
        // dirt-samples drum bank
        'bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'crash', 'ride', 'lt', 'mt', 'ht',
        // Strudel built-in synths
        'sawtooth', 'square', 'triangle', 'sine', 'pulse',
        // sampled instruments often present in dirt-samples
        'piano', 'bass', 'pad', 'lead',
      ];
      const out: Array<{ name: string; type: 'sample' | 'synth' | 'unknown' }> = [];
      for (const n of probes) {
        try {
          const s = getSound(n);
          let type: 'sample' | 'synth' | 'unknown' = 'unknown';
          if (s) {
            const data = (s as any).data ?? s;
            if (data?.type === 'synth' || ['sawtooth','square','triangle','sine','pulse'].includes(n)) type = 'synth';
            else type = 'sample';
          }
          out.push({ name: n, type });
        } catch {
          out.push({ name: n, type: 'unknown' });
        }
      }
      return out;
    };
    window.__cactusReady = true;
    blog('init:ready');
  } catch (e) {
    window.__cactusInitError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    blog('init:failed:' + window.__cactusInitError);
    console.error('[cactus] renderer init failed', e);
  }
})();

window.__cactusRender = async (input) => {
  if (!window.__cactusReady) {
    if (window.__cactusInitError) {
      throw new Error(`renderer init never succeeded: ${window.__cactusInitError}`);
    }
    throw new Error('renderer not ready');
  }

  const cps = input.cps ?? 0.5;
  const durationCycles = Math.max(0.1, input.durationCycles);
  const sampleRate = input.sampleRate ?? 48000;
  const maxPolyphony = input.maxPolyphony ?? 64;
  const multiChannelOrbits = input.multiChannelOrbits ?? [];
  const warnings: string[] = [];

  // 1. Evaluate the user code to obtain a Strudel Pattern (autoplay=false).
  let pattern: any;
  try {
    pattern = await evaluate(input.code, false);
  } catch (e) {
    throw new Error(`evaluate failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!pattern || typeof pattern.queryArc !== 'function') {
    // evaluate returns an object; the actual pattern is on `.pattern` in some shapes.
    if (pattern && pattern.pattern && typeof pattern.pattern.queryArc === 'function') {
      pattern = pattern.pattern;
    } else {
      throw new Error('evaluate did not return a Pattern');
    }
  }

  // 2. Close live context, swap in OfflineAudioContext.
  const liveCtx = getAudioContext();
  try { await liveCtx.close(); } catch { /* may already be closed */ }
  const numFrames = Math.ceil((durationCycles / cps) * sampleRate);
  const offlineCtx = new OfflineAudioContext(2, numFrames, sampleRate);
  setAudioContext(offlineCtx as unknown as AudioContext);
  // Invalidate cached controller so getSuperdoughAudioController() lazy-recreates
  // it with the offline context. (We avoid importing SuperdoughAudioController
  // directly since it lives in superdough/superdoughoutput.mjs which isn't in
  // the public barrel.)
  setSuperdoughAudioController(null);
  await initAudio({ maxPolyphony, multiChannelOrbits });
  // Re-register synth sounds — the registrations themselves persist in the
  // module-level soundMap, but some closures cache the previous AudioContext
  // and break after the swap. Re-registering rebinds the closures to the new ctx.
  try {
    registerSynthSounds();
  } catch (err) {
    warnings.push(`registerSynthSounds re-bind warning: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Query haps in [0, durationCycles] and dispatch to superdough in onset order.
  const haps = pattern
    .queryArc(0, durationCycles, { _cps: cps })
    .sort((a: any, b: any) => a.whole.begin.valueOf() - b.whole.begin.valueOf());

  let dispatched = 0;
  for (const hap of haps) {
    if (!hap.hasOnset()) continue;
    dispatched++;
    try {
      await superdough(
        hap2value(hap),
        hap.whole.begin.valueOf() / cps,
        hap.duration / cps,
        cps,
        hap.whole?.begin.valueOf() / cps,
      );
    } catch (err) {
      warnings.push(
        `superdough error at cycle ${hap.whole.begin.valueOf()}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (dispatched === 0) {
    warnings.push(`no haps dispatched — pattern produced ${haps.length} haps but none had onset within ${durationCycles} cycles`);
  }

  // 4. Render.
  const audioBuffer = await offlineCtx.startRendering();

  // 5. Extract interleaved Float32 PCM.
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const interleaved = new Float32Array(length * channels);
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      interleaved[i * channels + c] = data[i]!;
    }
  }

  // 6. Cleanup.
  try { setAudioContext(null as unknown as AudioContext); } catch { /* */ }
  try { setSuperdoughAudioController(null as any); } catch { /* */ }
  try { resetGlobalEffects(); } catch { /* */ }

  // 7. Encode as base64 (transferable across page.evaluate).
  const pcmBase64 = float32ToBase64(interleaved);

  return {
    pcmBase64,
    sampleRate: audioBuffer.sampleRate,
    channels,
    durationSec: length / audioBuffer.sampleRate,
    warnings,
  };
};

function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + chunkSize, bytes.length))),
    );
  }
  return btoa(binary);
}
