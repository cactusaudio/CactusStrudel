import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import wavefilePkg from 'wavefile';
const { WaveFile } = wavefilePkg;

/**
 * Generate candidate TCP ports. Do not pre-probe/bind here: a separate
 * "find free port" probe creates a TOCTOU window before vite binds. Instead
 * bootRenderer starts vite with --strictPort and retries on startup failure.
 */
function candidatePort(start: number, attempt: number): number {
  return start + attempt * 37;
}

export interface RenderInput {
  code: string;
  durationCycles: number;
  cps?: number;
  sampleRate?: number;
  outputPath: string;
  maxPolyphony?: number;
  multiChannelOrbits?: number[];
  /** Capture the realtime cyclist scheduler (= strudel.cc PLAY) instead of
   *  the offline renderPatternAudio bounce. Renders in wall-clock time
   *  (durationCycles/cps seconds) but matches strudel.cc playback. */
  realtime?: boolean;
}

export interface RenderResult {
  wavPath: string;
  sampleRate: number;
  durationSec: number;
  channels: number;
  packageVersions: Record<string, string>;
  warnings: string[];
  renderedAt: string;
}

interface RendererPageHandle {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  serverProcess?: ChildProcess;
  baseUrl: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_PAGE_DIR = path.resolve(HERE, '..', '..', '..', 'apps', 'renderer-page');

let sharedHandle: Promise<RendererPageHandle> | null = null;
let activeRenders = 0;
/**
 * G4: when true, the user has explicitly warmed the renderer and refcount-based
 * teardown is suppressed until shutdown() is called. Lets the closed-loop /
 * audit / batch jobs amortize browser boot across many renders.
 */
let userWarmed = false;

export async function ensureRenderer(): Promise<RendererPageHandle> {
  if (!sharedHandle) {
    sharedHandle = bootRenderer();
  }
  activeRenders++;
  return sharedHandle;
}

export async function releaseRenderer(): Promise<void> {
  activeRenders--;
  if (activeRenders <= 0 && !userWarmed && sharedHandle) {
    const h = await sharedHandle;
    sharedHandle = null;
    activeRenders = 0;
    try { await h.context.close(); } catch { /* */ }
    try { await h.browser.close(); } catch { /* */ }
    if (h.serverProcess && !h.serverProcess.killed) {
      h.serverProcess.kill('SIGTERM');
    }
  } else if (activeRenders < 0) {
    activeRenders = 0;
  }
}

/**
 * G4: explicit lifecycle. `warmup()` boots the renderer and pins it open;
 * subsequent render() calls reuse the same browser/page. Call `shutdown()`
 * when done.
 */
export async function warmup(): Promise<void> {
  await ensureRenderer();
  userWarmed = true;
  // Pair the implicit ensure with an immediate release so the refcount returns
  // to baseline (warmed but no in-flight renders). The userWarmed flag prevents
  // releaseRenderer() from tearing the handle down here.
  await releaseRenderer();
}

/**
 * G4: force shutdown regardless of refcount or warm flag. Always safe; idempotent.
 */
export async function shutdown(): Promise<void> {
  userWarmed = false;
  if (sharedHandle) {
    const h = await sharedHandle;
    sharedHandle = null;
    activeRenders = 0;
    try { await h.context.close(); } catch { /* */ }
    try { await h.browser.close(); } catch { /* */ }
    if (h.serverProcess && !h.serverProcess.killed) h.serverProcess.kill('SIGTERM');
  }
}

/** Test-only helper. NOT exported from the package barrel for production use. */
export function _resetLifecycleStateForTests(): void {
  sharedHandle = null;
  activeRenders = 0;
  userWarmed = false;
}

export function _getLifecycleStateForTests(): { hasHandle: boolean; activeRenders: number; userWarmed: boolean } {
  return { hasHandle: sharedHandle !== null, activeRenders, userWarmed };
}

export function _candidatePortForTests(start: number, attempt: number): number {
  return candidatePort(start, attempt);
}

async function bootRenderer(): Promise<RendererPageHandle> {
  // Start vite dev server (cheap; no build step needed for first run).
  // Unique port per process: spread the search start by PID so concurrent
  // render subprocesses rarely scan the same range, then let vite's strictPort
  // bind attempt be the source of truth. No pre-probe, so no TOCTOU gap.
  // CACTUS_RENDER_PORT overrides (single-render debugging).
  const envPort = Number.parseInt(process.env.CACTUS_RENDER_PORT ?? '', 10);
  const startPort = Number.isFinite(envPort) && envPort > 0
    ? envPort
    : 5173 + ((process.pid % 500) * 5);

  const distExists = await fs
    .stat(path.join(RENDERER_PAGE_DIR, 'dist', 'index.html'))
    .then(() => true)
    .catch(() => false);

  let serverProcess: ChildProcess | undefined;
  let baseUrl = '';
  let lastBootError: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = candidatePort(startPort, attempt);
    baseUrl = `http://localhost:${port}`;
    const args = distExists
      ? ['exec', 'vite', 'preview', '--port', String(port), '--strictPort']
      : ['exec', 'vite', '--port', String(port), '--strictPort'];
    serverProcess = spawn('pnpm', args, {
      cwd: RENDERER_PAGE_DIR,
      stdio: 'pipe',
    });
    try {
      await waitForServer(baseUrl, 30_000, serverProcess);
      lastBootError = undefined;
      break;
    } catch (e) {
      lastBootError = e;
      if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGTERM');
      serverProcess = undefined;
      if (process.env.CACTUS_RENDER_PORT) break;
    }
  }
  if (!serverProcess || lastBootError) {
    throw new Error(`renderer vite server failed to start after port retries: ${lastBootError instanceof Error ? lastBootError.message : String(lastBootError)}`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-features=IsolateOrigins,site-per-process',
      // Realtime cyclist scheduler relies on accurate timer callbacks
      // (rAF / setInterval) to schedule audio events ahead of ctx clock.
      // Headless Chromium throttles background/invisible-tab timers (≥1s)
      // → tick callbacks jitter → realtime audio "in-between-beats / 蹭拍"
      // (Bowei 2026-05-20). Disable throttling explicitly.
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.startsWith('[cactus]') || msg.type() === 'error') {
      // Forward important page logs to Node stderr only when debugging
      if (process.env.CACTUS_RENDER_VERBOSE) console.error(`[page:${msg.type()}] ${t}`);
    }
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  try {
    await page.waitForFunction(
      () => (window as any).__cactusReady === true || (window as any).__cactusInitError,
      null,
      { timeout: 60_000 },
    );
  } catch (e) {
    const log = await page
      .evaluate(() => (window as any).__cactusBootLog as string[] | undefined)
      .catch(() => undefined);
    const err = await page
      .evaluate(() => (window as any).__cactusInitError as string | undefined)
      .catch(() => undefined);
    throw new Error(
      `renderer-page never became ready. bootLog=${JSON.stringify(log ?? null)} initError=${err ?? 'none'} (orig: ${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const initErr = await page.evaluate(() => (window as any).__cactusInitError as string | undefined);
  if (initErr) throw new Error(`renderer-page init error: ${initErr}`);

  return { browser, context, page, serverProcess, baseUrl };
}

async function waitForServer(url: string, timeoutMs: number, proc?: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc?.exitCode !== null) {
      throw new Error(`server process exited before ready at ${url} (exit ${proc?.exitCode})`);
    }
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return;
    } catch { /* not yet */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`server at ${url} did not respond within ${timeoutMs}ms`);
}

export async function render(input: RenderInput): Promise<RenderResult> {
  const handle = await ensureRenderer();
  try {
    const sampleRate = input.sampleRate ?? 48000;
    const evalInput = {
      code: input.code,
      durationCycles: input.durationCycles,
      cps: input.cps ?? 0.5,
      sampleRate,
      maxPolyphony: input.maxPolyphony ?? 128, // match strudel.cc DEFAULT_MAX_POLYPHONY (was 64 → culled voices in dense sections)
      multiChannelOrbits: input.multiChannelOrbits ?? [],
      realtime: input.realtime ?? false,
    };
    const runPageRender = async () => (await handle.page.evaluate(
      async ({ code, durationCycles, cps, sampleRate, maxPolyphony, multiChannelOrbits, realtime }) => {
        if (realtime) return await (window as any).__cactusRenderRealtime({ code, durationCycles, cps });
        return await (window as any).__cactusRender({
          code,
          durationCycles,
          cps,
          sampleRate,
          maxPolyphony,
          multiChannelOrbits,
        });
      },
      evalInput,
    )) as {
      pcmBase64: string;
      sampleRate: number;
      channels: number;
      durationSec: number;
      warnings: string[];
    };
    let result = await runPageRender();
    let pcm = base64ToFloat32(result.pcmBase64);
    if (input.realtime) {
      for (let attempt = 1; attempt <= 2 && peakAbs(pcm) < 1e-4; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        const retry = await runPageRender();
        retry.warnings = [
          ...(retry.warnings ?? []),
          `realtime near-silent retry ${attempt}/2 after peak=${peakAbs(pcm).toExponential(2)}`,
        ];
        result = retry;
        pcm = base64ToFloat32(result.pcmBase64);
      }
    }

    const versions = await handle.page.evaluate(() => (window as any).__cactusVersions);

    const wav = encodeFloat32ToWav(pcm, result.sampleRate, result.channels);
    await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
    await fs.writeFile(input.outputPath, wav);

    return {
      wavPath: input.outputPath,
      sampleRate: result.sampleRate,
      channels: result.channels,
      durationSec: result.durationSec,
      packageVersions: versions ?? {},
      warnings: result.warnings,
      renderedAt: new Date().toISOString(),
    };
  } finally {
    await releaseRenderer();
  }
}

function base64ToFloat32(b64: string): Float32Array {
  const binary = Buffer.from(b64, 'base64');
  const ab = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
  return new Float32Array(ab);
}

function peakAbs(pcm: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i] ?? 0);
    if (v > peak) peak = v;
  }
  return peak;
}

function encodeFloat32ToWav(interleaved: Float32Array, sampleRate: number, channels: number): Uint8Array {
  // Convert interleaved Float32 [-1, 1] to per-channel Float32Array[] for wavefile.
  const length = interleaved.length / channels;
  const samples: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const ch = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      ch[i] = interleaved[i * channels + c]!;
    }
    samples.push(ch);
  }
  const wav = new WaveFile();
  wav.fromScratch(channels, sampleRate, '32f', samples as unknown as number[][]);
  return wav.toBuffer();
}

export interface HapQueryInput {
  code: string;
  durationCycles: number;
  cps?: number;
}
export interface HapQueryResult {
  haps: Array<{ begin: number; end: number; note?: number; vel?: number; ch?: number; s?: string }>;
  warnings: string[];
}

/** Query the Strudel pattern's haps (for MIDI export, analysis). No audio. */
export async function queryHaps(input: HapQueryInput): Promise<HapQueryResult> {
  const handle = await ensureRenderer();
  try {
    const result = (await handle.page.evaluate(
      async ({ code, durationCycles, cps }) => {
        return await (window as any).__cactusQueryHaps({ code, durationCycles, cps });
      },
      {
        code: input.code,
        durationCycles: input.durationCycles,
        cps: input.cps ?? 0.5,
      },
    )) as HapQueryResult;
    return result;
  } finally {
    await releaseRenderer();
  }
}

/**
 * G4: batch render. Warms the renderer once, runs inputs in order against the
 * shared page (Playwright serializes per-page evaluate() anyway), and leaves
 * the renderer warm afterward. Caller controls shutdown.
 */
export async function renderMany(inputs: RenderInput[]): Promise<RenderResult[]> {
  if (inputs.length === 0) return [];
  await warmup();
  const out: RenderResult[] = [];
  for (const input of inputs) {
    out.push(await render(input));
  }
  return out;
}

export interface SampleRegistryEntry {
  name: string;
  type: 'sample' | 'synth' | 'unknown';
}

export interface SampleRegistry {
  entries: SampleRegistryEntry[];
  loaded_count: number;
  total_probed: number;
}

/**
 * G4: probe the renderer page for which sample/synth names are loaded. Used by
 * the conformance suite to assert deterministic boot state across runs.
 */
export async function getSampleRegistry(): Promise<SampleRegistry> {
  const handle = await ensureRenderer();
  try {
    const entries = (await handle.page.evaluate(() => {
      const fn = (window as unknown as { __cactusSampleRegistry?: () => SampleRegistryEntry[] }).__cactusSampleRegistry;
      return fn ? fn() : [];
    })) as SampleRegistryEntry[];
    return {
      entries,
      loaded_count: entries.filter((e) => e.type !== 'unknown').length,
      total_probed: entries.length,
    };
  } finally {
    await releaseRenderer();
  }
}

export async function renderPeak(wavPath: string): Promise<{ peakDb: number; rmsDb: number }> {
  const buf = await fs.readFile(wavPath);
  const wav = new WaveFile(buf);
  wav.toBitDepth('32f');
  const samples = wav.getSamples(true) as unknown as Float32Array;
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i] ?? 0);
    if (v > peak) peak = v;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, samples.length));
  return {
    peakDb: 20 * Math.log10(Math.max(1e-10, peak)),
    rmsDb: 20 * Math.log10(Math.max(1e-10, rms)),
  };
}
