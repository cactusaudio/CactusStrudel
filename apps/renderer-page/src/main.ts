// Cactus Strudel renderer page — exposes window.__cactusRender for Playwright.
//
// Approach: initialize @strudel/web in a real AudioContext so workers / samples can prebake,
// then for each render call we close the live context, swap in an OfflineAudioContext, run
// superdough() against ordered haps, and return a Float32Array PCM buffer.
//
// Logic adapted from @strudel/webaudio's renderPatternAudio (AGPL-3.0-or-later) but rewritten
// to return raw PCM instead of triggering a browser download.

import { initStrudel, evaluate, hush } from '@strudel/web';
// Option-3: ride the LIVE engine's OWN offline render (renderPatternAudio,
// always current/correct) instead of a hand-mirrored hap loop that rots
// against the moving engine. renderPatternAudio downloads a WAV; we
// hijack its Blob and decode → our existing pcmBase64 contract.
import { getSound, renderPatternAudio } from '@strudel/webaudio';

// Decode a standard WAV (engine writes PCM16 by default, sometimes
// float32) → interleaved Float32, robust chunk scan.
function wavToInterleavedFloat32(buf: ArrayBuffer): { pcm: Float32Array; channels: number; sampleRate: number } {
  const v = new DataView(buf);
  const rd4 = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (rd4(0) !== 'RIFF' || rd4(8) !== 'WAVE') throw new Error('captured blob not a WAV');
  let off = 12, fmt = 1, channels = 2, sampleRate = 48000, bits = 16, dataOff = -1, dataLen = 0;
  while (off + 8 <= v.byteLength) {
    const id = rd4(off);
    const sz = v.getUint32(off + 4, true);
    if (id === 'fmt ') {
      fmt = v.getUint16(off + 8, true);
      channels = v.getUint16(off + 10, true);
      sampleRate = v.getUint32(off + 12, true);
      bits = v.getUint16(off + 22, true);
    } else if (id === 'data') { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  if (dataOff < 0) throw new Error('WAV has no data chunk');
  let pcm: Float32Array;
  if (fmt === 3 && bits === 32) {
    const n = dataLen / 4; pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) pcm[i] = v.getFloat32(dataOff + i * 4, true);
  } else { // PCM int16
    const n = dataLen / 2; pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) pcm[i] = v.getInt16(dataOff + i * 2, true) / 32768;
  }
  return { pcm, channels, sampleRate }; // already interleaved by the engine
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
        // Replicate strudel.cc's default prebake so RICH idiomatic Strudel
        // (gm_* soundfonts, super* instruments, .bank() drum machines)
        // actually renders offline — not just the oscillator subset.
        // Each step is independent + non-fatal so partial CDN failures
        // still leave a working engine.
        const { samples } = await import('@strudel/webaudio');
        const steps: Array<[string, () => Promise<unknown>]> = [
          ['dirt', () => samples('github:tidalcycles/dirt-samples')],
          ['dough', () => samples('github:Bubobubobubobubo/dough-samples/main')],
          ['drum-machines', () => samples('github:ritchse/tidal-drum-machines')],
          ['soundfonts', async () => {
            const sf: any = await import('@strudel/soundfonts');
            const reg = sf.registerSoundfonts ?? sf.default?.registerSoundfonts;
            if (typeof reg === 'function') return reg();
            return undefined;
          }],
        ];
        await Promise.all(steps.map(async ([name, fn]) => {
          try { blog('init:load:' + name); await fn(); blog('init:ok:' + name); }
          catch (e) { blog('init:skip:' + name + ':' + (e instanceof Error ? e.message.slice(0, 60) : 'err')); }
        }));
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

  // 1. Evaluate code → pattern. New engine evaluate() returns
  //    { mode, pattern, meta }; older shapes return the Pattern itself.
  let pattern: any;
  try {
    // autoplay=false: returns the Pattern; true would try to start the
    // live scheduler headlessly, throw internally, and yield undefined.
    const ev: any = await evaluate(input.code, false);
    pattern = ev?.pattern && typeof ev.pattern.queryArc === 'function' ? ev.pattern
      : (ev && typeof ev.queryArc === 'function' ? ev : ev?.pattern ?? ev);
  } catch (e) {
    throw new Error(`evaluate failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!pattern || typeof pattern.queryArc !== 'function') {
    throw new Error('evaluate did not return a Pattern (got ' + Object.prototype.toString.call(pattern) + ')');
  }

  // 2. Run the ENGINE'S OWN renderPatternAudio (current/correct: it
  //    manages OfflineAudioContext + SuperdoughAudioController + initAudio
  //    + hap dispatch internally). It downloads a WAV blob; hijack the
  //    blob via URL.createObjectURL + neutered anchor click.
  let captured: Blob | null = null;
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const origClick = HTMLAnchorElement.prototype.click;
  (URL as any).createObjectURL = (b: Blob) => { captured = b; return 'blob:cactus-capture'; };
  (URL as any).revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {};
  try {
    await renderPatternAudio(
      pattern, cps, 0, durationCycles, sampleRate, maxPolyphony, multiChannelOrbits,
    );
  } catch (err) {
    warnings.push(`renderPatternAudio: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    HTMLAnchorElement.prototype.click = origClick;
  }
  if (!captured) throw new Error('renderPatternAudio produced no audio blob');

  // 3. Decode the engine's WAV → interleaved Float32 (our contract).
  const wavBuf = await (captured as Blob).arrayBuffer();
  const { pcm, channels, sampleRate: sr } = wavToInterleavedFloat32(wavBuf);

  return {
    pcmBase64: float32ToBase64(pcm),
    sampleRate: sr,
    channels,
    durationSec: pcm.length / channels / sr,
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
