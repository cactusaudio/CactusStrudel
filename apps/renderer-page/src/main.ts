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
import { getSound, renderPatternAudio, getAudioContext } from '@strudel/webaudio';

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
    __cactusRenderRealtime: (input: {
      code: string;
      durationCycles: number;
      cps?: number;
    }) => Promise<{
      pcmBase64: string;
      sampleRate: number;
      channels: number;
      durationSec: number;
      warnings: string[];
    }>;
    __cactusQueryHaps: (input: {
      code: string;
      durationCycles: number;
      cps?: number;
    }) => Promise<{
      haps: Array<{ begin: number; end: number; note?: number; vel?: number; ch?: number; s?: string }>;
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
        // Keep this aligned with the local Strudel monorepo's
        // packages/repl/prebake.mjs, then add CDN mirrors used by strudel.cc.
        // The dough-samples Dirt-Samples pack is required for core aliases
        // such as bd/sd/hh to render above silence in offline bounces.
        const wa: any = await import('@strudel/webaudio');
        const samples = wa.samples;
        const cdn = 'https://strudel.b-cdn.net';
        const ds = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';
        const ts = 'https://raw.githubusercontent.com/todepond/samples/main';
        const tc = 'https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main';
        const steps: Array<[string, () => Promise<unknown>]> = [
          ['synth', async () => wa.registerSynthSounds?.()],
          ['zzfx', async () => wa.registerZZFXSounds?.()],
          ['soundfonts', () => import('@strudel/soundfonts').then((m: any) => (m.registerSoundfonts ?? m.default?.registerSoundfonts)?.())],
          ['dough-drum-machines', () => samples(`${ds}/tidal-drum-machines.json`)],
          ['dough-dirt-samples', () => samples(`${ds}/Dirt-Samples.json`)],
          ['dough-mridangam', () => samples(`${ds}/mridangam.json`)],
          ['official-uzu-drumkit', () => samples(`${tc}/strudel.json`)],
          ['drum-machine-aliases', async () => wa.aliasBank?.(`${ts}/tidal-drum-machines-alias.json`)],
          ['piano', () => samples(`${cdn}/piano.json`, `${cdn}/piano/`, { prebake: true })],
          ['vcsl', () => samples(`${cdn}/vcsl.json`, `${cdn}/VCSL/`, { prebake: true })],
          ['drum-machines', () => samples(`${cdn}/tidal-drum-machines.json`, `${cdn}/tidal-drum-machines/machines/`, { prebake: true, tag: 'drum-machines' })],
          ['uzu-drumkit', () => samples(`${cdn}/uzu-drumkit.json`, `${cdn}/uzu-drumkit/`, { prebake: true, tag: 'drum-machines' })],
          ['uzu-wavetables', () => samples(`${cdn}/uzu-wavetables.json`, `${cdn}/uzu-wavetables/`, { prebake: true })],
          ['mridangam', () => samples(`${cdn}/mridangam.json`, `${cdn}/mrid/`, { prebake: true, tag: 'drum-machines' })],
          ['dirt', () => samples(`${cdn}/EmuSP12.json`, `${cdn}/EmuSP12/`, { prebake: true })],
        ];
        await Promise.all(steps.map(async ([name, fn]) => {
          try { blog('init:load:' + name); await fn(); blog('init:ok:' + name); }
          catch (e) { blog('init:skip:' + name + ':' + (e instanceof Error ? e.message.slice(0, 60) : 'err')); }
        }));
        // Core drum aliases must never depend on a remote sample file being
        // decodable. Some upstream packs register `bd` to a bad/404 asset in
        // headless Chromium; alias the kick to Strudel's built-in synthesized
        // bass drum after all sample maps have loaded so `s("bd*4")` is stable.
        try { wa.soundAlias?.('sbd', 'bd'); wa.soundAlias?.('sbd', 'kick'); blog('init:ok:core-drum-fallbacks'); }
        catch (e) { blog('init:skip:core-drum-fallbacks:' + (e instanceof Error ? e.message.slice(0, 60) : 'err')); }
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
  // Match strudel.cc's superdough DEFAULT_MAX_POLYPHONY (128). At 64 the
  // offline render FIFO-culls voices in dense sections (5-note held pad +
  // fast arp×jux + bass + hh*8 + melody + reverb tails > 64), producing a
  // broken/unbalanced mix that strudel.cc (128) renders cleanly. This was
  // THE renderer-vs-strudel.cc divergence (Bowei 2026-05-19).
  const maxPolyphony = input.maxPolyphony ?? 128;
  const multiChannelOrbits = input.multiChannelOrbits ?? [];
  const warnings: string[] = [];

  // 1. Evaluate code → pattern. New engine evaluate() returns
  //    { mode, pattern, meta }; older shapes return the Pattern itself.
  let pattern: any;
  // repl.evaluate swallows eval errors (logs them, returns undefined).
  // Capture the engine's logged error so callers (producer-brain
  // self-heal) get the REAL cause, e.g. ".stutter is not a function".
  const evalErrs: string[] = [];
  const oErr = console.error, oWarn = console.warn;
  console.error = (...a: any[]) => { evalErrs.push(a.map(String).join(' ').slice(0, 220)); };
  console.warn = (...a: any[]) => { evalErrs.push(a.map(String).join(' ').slice(0, 220)); };
  try {
    // autoplay=false: returns the Pattern; true would try to start the
    // live scheduler headlessly, throw internally, and yield undefined.
    const ev: any = await evaluate(input.code, false);
    pattern = ev?.pattern && typeof ev.pattern.queryArc === 'function' ? ev.pattern
      : (ev && typeof ev.queryArc === 'function' ? ev : ev?.pattern ?? ev);
  } catch (e) {
    console.error = oErr; console.warn = oWarn;
    throw new Error(`evaluate failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    console.error = oErr; console.warn = oWarn;
  }
  if (!pattern || typeof pattern.queryArc !== 'function') {
    const real = evalErrs.filter((s) => /not a function|is not defined|error|unexpected|cannot/i.test(s)).slice(-2).join(' | ');
    throw new Error('evaluate did not return a Pattern' + (real ? ` — engine: ${real}` : ` (got ${Object.prototype.toString.call(pattern)})`));
  }

  // 1b. Warm sample/soundfont caches in the LIVE context. gm_* soundfonts and
  //     drum samples can fetch+decode lazily on first note. An OfflineAudioContext
  //     render can finish before that async work resolves, so those notes become
  //     silent or near-silent. Pre-resolve every non-synth sound the pattern
  //     actually plays by invoking the engine's registered handler once in the
  //     live AudioContext and awaiting it. Far-future time + never connected is
  //     inaudible; only the fetch/decode side effect matters.
  try {
    const wa: any = await import('@strudel/webaudio');
    const liveCtx = wa.getAudioContext?.();
    const far = (liveCtx?.currentTime ?? 0) + 1e6;
    const haps = (pattern.queryArc(0, Math.min(durationCycles, 64)) as any[])
      .filter((h) => (h.hasOnset ? h.hasOnset() : true));
    const seen = new Set<string>();
    let warmedSoundCount = 0;
    for (const h of haps) {
      const v = h.value || {};
      const sName = v.s ?? v.sound;
      if (!sName) continue;
      let snd: any;
      try { snd = getSound(sName); } catch { continue; }
      const data = snd?.data ?? {};
      const isBuiltInSynth = ['sawtooth', 'square', 'triangle', 'sine', 'pulse'].includes(String(sName));
      if (!snd || isBuiltInSynth || data.type === 'synth') continue;
      const key = `${sName}:::${v.note ?? v.freq ?? v.n ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const trig = snd.onTrigger ?? snd;
        const r: any = await trig(far, { ...v, duration: 0.01 }, () => {});
        try { r?.stop?.(0); } catch {}
        try { (r?.node ?? r)?.disconnect?.(); } catch {}
        warmedSoundCount++;
      } catch (e) {
        warnings.push(`sf-warm ${key}: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
      }
    }
    (window as any).__cactusLastWarmCount = warmedSoundCount;
  } catch (e) {
    warnings.push(`soundfont warm skipped: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`);
  }

  // 2. Run the ENGINE'S OWN renderPatternAudio (current/correct: it
  //    manages OfflineAudioContext + SuperdoughAudioController + initAudio
  //    + hap dispatch internally). It downloads a WAV blob; hijack the
  //    blob via URL.createObjectURL + neutered anchor click.
  const renderOfflineBlob = async (): Promise<Blob> => {
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
    return captured;
  };

  // 3. Decode the engine's WAV → interleaved Float32 (our contract). Sample
  //    packs can finish fetch/decode just after the first offline bounce, so a
  //    drum-only pattern may occasionally come back as a valid but silent WAV.
  //    Keep the conformance threshold strict and retry only near-silent bounces.
  let decoded: { pcm: Float32Array; channels: number; sampleRate: number } | null = null;
  const nearSilentPeak = 1e-4;
  for (let attempt = 0; attempt < 4; attempt++) {
    const captured = await renderOfflineBlob();
    const wavBuf = await captured.arrayBuffer();
    decoded = wavToInterleavedFloat32(wavBuf);
    const peak = peakAbs(decoded.pcm);
    if (peak >= nearSilentPeak || attempt === 3) {
      if (attempt > 0) warnings.push(`offline render retry ${attempt + 1}/4 peak=${peak.toExponential(2)}`);
      break;
    }
    warnings.push(`offline render near-silent peak=${peak.toExponential(2)} warm=${(window as any).__cactusLastWarmCount ?? 0}; retry ${attempt + 2}/4`);
    await new Promise((res) => setTimeout(res, 400 + attempt * 400));
  }
  if (!decoded) throw new Error('offline render decode failed');
  const { pcm, channels, sampleRate: sr } = decoded;

  return {
    pcmBase64: float32ToBase64(pcm),
    sampleRate: sr,
    channels,
    durationSec: pcm.length / channels / sr,
    warnings,
  };
};

function peakAbs(pcm: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i] ?? 0);
    if (v > peak) peak = v;
  }
  return peak;
}

// REALTIME capture path. The offline renderPatternAudio bounce diverges
// from strudel.cc's actual PLAYBACK (realtime cyclist scheduler): dense
// sections sum differently and drum transients get buried offline
// (Bowei 2026-05-19, A/B'd vs strudel.cc). strudel.cc PLAY = evaluate(
// code,true) → repl.scheduler → superdough into the realtime
// AudioContext. We mirror exactly that and tap the master via a
// ScriptProcessor inserted by hijacking connect()→ctx.destination.
window.__cactusRenderRealtime = async (input) => {
  if (!window.__cactusReady) {
    if (window.__cactusInitError) throw new Error(`renderer init never succeeded: ${window.__cactusInitError}`);
    throw new Error('renderer not ready');
  }
  const cps = input.cps ?? 0.5;
  const durationCycles = Math.max(0.1, input.durationCycles);
  const warnings: string[] = [];
  const ctx: AudioContext = getAudioContext();
  try { await ctx.resume(); } catch { /* */ }
  // Headless has no first mousedown → the engine's initAudioOnFirstClick
  // listener (registered by initStrudel at boot) never fires → audioCtx
  // never gets the AudioWorklet modules → worklet sounds (supersaw etc.)
  // fail to construct. Engine-intended path: trigger that listener via
  // a synthetic mousedown, then await the engine's own audioReady (which
  // initAudioOnFirstClick returns). This uses the engine's own init —
  // less invasive than calling initAudio directly (which awaits
  // initKabelsalat → dynamic-imports @kabelsalat/web → that hangs and
  // takes worklet-loading with it).
  try {
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  } catch { /* */ }
  {
    let initAudioOnFirstClick: any;
    try { ({ initAudioOnFirstClick } = (await import('@strudel/webaudio')) as any); } catch { /* */ }
    if (typeof initAudioOnFirstClick === 'function') {
      try {
        await Promise.race([
          initAudioOnFirstClick({ maxPolyphony: 128 }),
          new Promise((res) => setTimeout(res, 12000)),
        ]);
      } catch (e) {
        warnings.push('rt-aoc: ' + (e instanceof Error ? e.message.slice(0, 80) : 'err'));
      }
    }
    // Diagnostic into warnings so we can see what state things are in
    // even if eval succeeds with silently-missing worklets.
    warnings.push(`rt-init: state=${ctx.state}`);
  }
  const sr = ctx.sampleRate;
  const dest = ctx.destination;

  // Capture node: a ScriptProcessor that records whatever the engine
  // sends to ctx.destination. ScriptProcessorNode (deprecated, main-
  // thread) drops buffers under audio-graph load → intermittent glitches
  // once drums/worklets enter (Bowei 2026-05-20). Use an AudioWorkletNode
  // recorder that runs in the audio thread → reliable.
  const chunksL: Float32Array[] = [];
  const chunksR: Float32Array[] = [];
  let capturing = false;
  let cap: any = null;
const CAPTURE_WORKLET = `
class CactusCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufL = new Float32Array(4096); this.bufR = new Float32Array(4096); this.pos = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.cmd === 'flush') {
        this.flush(true);
      }
    };
  }
  flush(final = false) {
    if (this.pos > 0) {
      const L = this.bufL.slice(0, this.pos); const R = this.bufR.slice(0, this.pos);
      this.port.postMessage({ L, R }, [L.buffer, R.buffer]);
      this.pos = 0;
    }
    if (final) this.port.postMessage({ flush: true });
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;
    const l = input[0]; const r = input.length > 1 && input[1] && input[1].length === l.length ? input[1] : l;
    const n = l.length;
    if (this.pos + n > this.bufL.length) {
      this.flush(false);
    }
    this.bufL.set(l, this.pos); this.bufR.set(r, this.pos); this.pos += n;
    return true;
  }
}
registerProcessor('cactus-capture', CactusCapture);
`;
  try {
    const dataUrl = 'data:application/javascript;base64,' + btoa(CAPTURE_WORKLET);
    await ctx.audioWorklet.addModule(dataUrl);
    cap = new AudioWorkletNode(ctx, 'cactus-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    let flushAck: (() => void) | null = null;
    cap.port.onmessage = (e: MessageEvent) => {
      if (e.data?.flush) {
        flushAck?.();
        flushAck = null;
        return;
      }
      if (!capturing) return;
      chunksL.push(e.data.L);
      chunksR.push(e.data.R);
    };
    cap.__flush = () => new Promise<void>((resolve) => {
      flushAck = resolve;
      cap.port.postMessage({ cmd: 'flush' });
      setTimeout(() => { flushAck?.(); flushAck = null; }, 500);
    });
  } catch (e) {
    // Fallback: ScriptProcessor (worse, glitchy under load — only if worklet add fails)
    warnings.push('cap-worklet-fallback: ' + (e instanceof Error ? e.message.slice(0, 80) : 'err'));
    cap = ctx.createScriptProcessor(16384, 2, 2);
    cap.onaudioprocess = (ev: AudioProcessingEvent) => {
      if (!capturing) return;
      chunksL.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
      chunksR.push(new Float32Array(ev.inputBuffer.getChannelData(1)));
    };
  }
  (cap as any).__cap = true;
  const sink = ctx.createGain();
  (sink as any).__cap = true;
  sink.gain.value = 0;
  cap.connect(sink);
  sink.connect(dest);

  // Hijack connect(): mirror anything wired to ctx.destination into cap.
  const origConnect = AudioNode.prototype.connect as any;
  (AudioNode.prototype as any).connect = function (target: any, ...rest: any[]) {
    const r = origConnect.call(this, target, ...rest);
    if (target === dest && !(this as any).__cap) {
      try { origConnect.call(this, cap); } catch { /* */ }
    }
    return r;
  };

  try {
    // SOUNDFONT PRE-WARM for realtime (Bowei 2026-05-21 "刚开始只有bass"):
    // gm_* soundfonts network-fetch lazily on first note (felixroos
    // webaudiofont). In realtime, the first ~seconds of pad/flute can be
    // SILENT while loading → user hears only the synth bass at start.
    // Pre-warm: dry-evaluate to get the pattern, query haps, invoke the
    // engine's soundfont handler for each (font,pitch) in the live ctx
    // (caches buffer ahead of playback). Same mechanism as offline step
    // "1b" but applied to the realtime path.
    try {
      const dryEv: any = await evaluate(input.code, false);
      const dryPat: any = dryEv?.pattern && typeof dryEv.pattern.queryArc === 'function' ? dryEv.pattern
        : (dryEv && typeof dryEv.queryArc === 'function' ? dryEv : dryEv?.pattern ?? dryEv);
      if (dryPat && typeof dryPat.queryArc === 'function') {
        const haps = (dryPat.queryArc(0, Math.min(durationCycles, 32)) as any[])
          .filter((h) => (h.hasOnset ? h.hasOnset() : true));
        const seen = new Set<string>();
        const far = ctx.currentTime + 1e6;
        for (const h of haps) {
          const v = h.value || {};
          const sName = v.s ?? v.sound;
          if (!sName) continue;
          let snd: any;
          try { snd = getSound(sName); } catch { continue; }
          const data = snd?.data ?? {};
          if (!snd || data.type !== 'soundfont') continue;
          const key = `${sName}:::${v.note ?? v.freq ?? v.n ?? ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            const trig = snd.onTrigger ?? snd;
            const rr: any = await trig(far, { ...v, duration: 0.01 }, () => { /* */ });
            try { rr?.stop?.(0); } catch { /* */ }
            try { (rr?.node ?? rr)?.disconnect?.(); } catch { /* */ }
          } catch (e) {
            warnings.push(`rt-sf-warm ${key}: ${e instanceof Error ? e.message.slice(0, 60) : 'err'}`);
          }
        }
      }
    } catch (e) {
      warnings.push('rt-sf-warm-dry: ' + (e instanceof Error ? e.message.slice(0, 80) : 'err'));
    }
    try { hush(); } catch { /* */ }
    const evalErrs: string[] = [];
    const oErr = console.error, oWarn = console.warn;
    console.error = (...a: any[]) => { evalErrs.push(a.map(String).join(' ').slice(0, 220)); };
    console.warn = (...a: any[]) => { evalErrs.push(a.map(String).join(' ').slice(0, 220)); };
    try {
      // PHASE FIX (Bowei 2026-05-20 "错位"): open capture BEFORE the
      // scheduler starts so the captured audio's t=0 is anchored to ctx
      // clock when scheduler.start() runs. Any leadSec delay between
      // scheduler-start and capture-start shifts the whole capture's
      // grid by that amount (~400ms ≈ 0.7 beat at cps 0.44) → entire
      // groove sounds offset. Leading silence in the mp3 is fine; phase
      // alignment to pattern downbeat is what matters.
      capturing = true;
      await evaluate(input.code, true); // realtime: drives repl.scheduler (= strudel.cc PLAY)
    } finally { console.error = oErr; console.warn = oWarn; }
    const realErr = evalErrs.filter((s) => /not a function|is not defined|error|unexpected|cannot|parse/i.test(s)).slice(-2).join(' | ');
    if (realErr) warnings.push(`eval: ${realErr}`);

    const playSec = durationCycles / cps;
    const tailSec = 1.2;                       // let reverb/release ring out
    await new Promise((res) => setTimeout(res, (playSec + tailSec) * 1000));
    try { await cap.__flush?.(); } catch { /* best-effort final partial buffer flush */ }
    capturing = false;
  } finally {
    try { hush(); } catch { /* */ }
    (AudioNode.prototype as any).connect = origConnect;
    try { cap.disconnect(); } catch { /* */ }
    try { sink.disconnect(); } catch { /* */ }
    cap.onaudioprocess = null;
  }

  const total = chunksL.reduce((n, c) => n + c.length, 0);
  if (total === 0) throw new Error('realtime capture produced no audio' + (warnings.length ? ` (${warnings.join('; ')})` : ''));
  const pcm = new Float32Array(total * 2);
  let o = 0;
  for (let i = 0; i < chunksL.length; i++) {
    const l = chunksL[i]!;
    const rr = chunksR[i]!;
    for (let j = 0; j < l.length; j++) { pcm[o++] = l[j] ?? 0; pcm[o++] = rr[j] ?? 0; }
  }
  return { pcmBase64: float32ToBase64(pcm), sampleRate: sr, channels: 2, durationSec: total / sr, warnings };
};

// QUERY HAPS — evaluate code → queryArc → return note events for MIDI export.
// No audio rendering; pure pattern query. Resolves note strings/freqs to MIDI.
window.__cactusQueryHaps = async (input) => {
  if (!window.__cactusReady) throw new Error('renderer not ready');
  const cps = input.cps ?? 0.5;
  const dur = Math.max(0.1, input.durationCycles);
  const warnings: string[] = [];
  const ev: any = await evaluate(input.code, false);
  const pattern: any = ev?.pattern && typeof ev.pattern.queryArc === 'function' ? ev.pattern
    : (ev && typeof ev.queryArc === 'function' ? ev : ev?.pattern ?? ev);
  if (!pattern || typeof pattern.queryArc !== 'function') {
    throw new Error('evaluate did not return a Pattern (got ' + Object.prototype.toString.call(pattern) + ')');
  }
  let core: any;
  try { core = await import('@strudel/core'); } catch (e) { warnings.push('no @strudel/core: ' + (e instanceof Error ? e.message : '')); }
  const noteToMidi = core?.noteToMidi;
  const freqToMidi = core?.freqToMidi;
  const noteOf = (v: any): number | undefined => {
    if (v == null) return undefined;
    const n = v.note;
    if (typeof n === 'number') return n;
    if (typeof n === 'string' && noteToMidi) try { return noteToMidi(n); } catch { /* */ }
    if (typeof v.freq === 'number' && freqToMidi) try { return freqToMidi(v.freq); } catch { /* */ }
    return undefined;
  };
  const sampleToDrumMidi = (s: string | undefined): number | undefined => {
    if (!s) return undefined;
    const name = s.split(':')[0]!.toLowerCase();
    if (['bd', 'kick', 'sbd'].includes(name)) return 36;
    if (['sd', 'snare'].includes(name)) return 38;
    if (['cp', 'clap'].includes(name)) return 39;
    if (['hh', 'ch'].includes(name)) return 42;
    if (['oh'].includes(name)) return 46;
    if (['rim'].includes(name)) return 37;
    if (['perc'].includes(name)) return 75;
    if (['cr', 'crash'].includes(name)) return 49;
    if (['rd', 'ride'].includes(name)) return 51;
    if (['lt'].includes(name)) return 45;
    if (['mt'].includes(name)) return 47;
    if (['ht'].includes(name)) return 50;
    return undefined;
  };
  const haps = (pattern.queryArc(0, dur) as any[])
    .filter((h) => (h.hasOnset ? h.hasOnset() : true))
    .map((h, idx) => {
      const v = h.value || {};
      const sample = typeof v.s === 'string' ? v.s : undefined;
      const sampleNote = sampleToDrumMidi(sample);
      const note = noteOf(v) ?? sampleNote;
      const beginCyc = Number(h.whole?.begin ?? h.part?.begin ?? 0);
      const endCyc   = Number(h.whole?.end   ?? h.part?.end   ?? beginCyc);
      // seconds = cycles / cps
      const begin = beginCyc / cps;
      const end   = endCyc   / cps;
      const gain  = typeof v.gain === 'number' ? v.gain : 0.8;
      const vel   = Math.max(1, Math.min(127, Math.round(gain * 100)));
      return {
        begin, end,
        note: note != null && isFinite(note as number) ? Math.max(0, Math.min(127, Math.round(note as number))) : undefined,
        vel,
        ch: typeof v.ch === 'number' ? Math.max(0, Math.min(15, Math.round(v.ch))) : (sampleNote !== undefined ? 9 : 0),
        s: sample,
      };
    })
    .filter((h) => h.note != null);
  return { haps, warnings };
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
