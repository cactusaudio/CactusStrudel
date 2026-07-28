import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import wavefilePkg from 'wavefile';
import { checkBuildReceipt, verifyServedBuild } from '../../../scripts/build-receipt.mjs';
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
  const handlePromise = sharedHandle;
  activeRenders++;
  try {
    return await handlePromise;
  } catch (error) {
    activeRenders = Math.max(0, activeRenders - 1);
    if (sharedHandle === handlePromise) sharedHandle = null;
    throw error;
  }
}

export async function releaseRenderer(): Promise<void> {
  activeRenders--;
  if (activeRenders <= 0 && !userWarmed && sharedHandle) {
    const handlePromise = sharedHandle;
    sharedHandle = null;
    activeRenders = 0;
    let h: RendererPageHandle;
    try {
      h = await handlePromise;
    } catch {
      return;
    }
    try { await h.context.close(); } catch { /* */ }
    try { await h.browser.close(); } catch { /* */ }
    if (h.serverProcess) {
      try { await stopChildProcess(h.serverProcess); } catch { /* best effort */ }
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
    const handlePromise = sharedHandle;
    sharedHandle = null;
    activeRenders = 0;
    let h: RendererPageHandle;
    try {
      h = await handlePromise;
    } catch {
      return;
    }
    try { await h.context.close(); } catch { /* */ }
    try { await h.browser.close(); } catch { /* */ }
    if (h.serverProcess) {
      try { await stopChildProcess(h.serverProcess); } catch { /* best effort */ }
    }
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

export interface RendererServerStartOptions {
  startPort: number;
  fixedPort: boolean;
  repoRoot: string;
  rendererPageDir: string;
  maxAttempts?: number;
  checkBuild?: typeof checkBuildReceipt;
  verifyServed?: typeof verifyServedBuild;
  spawnServer?: (mode: 'preview' | 'source', port: number) => ChildProcess;
  waitUntilReady?: (url: string, timeoutMs: number, process?: ChildProcess) => Promise<void>;
  warn?: (message: string) => void;
}

export interface RendererServerStartResult {
  serverProcess: ChildProcess;
  baseUrl: string;
  mode: 'preview' | 'source';
  port: number;
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (childHasExited(child)) return true;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    timer = setTimeout(() => finish(childHasExited(child)), timeoutMs);
    child.once('exit', onExit);
    if (childHasExited(child)) finish(true);
  });
}

async function stopChildProcess(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (childHasExited(child)) return;
  const termExit = waitForChildExit(child, timeoutMs);
  if (!child.killed) child.kill('SIGTERM');
  if (await termExit) return;

  const killExit = waitForChildExit(child, timeoutMs);
  child.kill('SIGKILL');
  if (!await killExit) {
    throw new Error(`renderer vite child ${child.pid ?? 'unknown'} did not exit after SIGTERM/SIGKILL`);
  }
}

async function startRendererPageServer(options: RendererServerStartOptions): Promise<RendererServerStartResult> {
  const checkBuild = options.checkBuild ?? checkBuildReceipt;
  const verifyServed = options.verifyServed ?? verifyServedBuild;
  const waitUntilReady = options.waitUntilReady ?? waitForServer;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const spawnServer = options.spawnServer ?? ((mode: 'preview' | 'source', port: number) => {
    const args = mode === 'preview'
      ? ['exec', 'vite', 'preview', '--port', String(port), '--strictPort']
      : ['exec', 'vite', '--port', String(port), '--strictPort'];
    return spawn('pnpm', args, {
      cwd: options.rendererPageDir,
      stdio: 'pipe',
    });
  });

  const pageBuild = await checkBuild('renderer-page', options.repoRoot);
  let mode: 'preview' | 'source' = pageBuild.valid ? 'preview' : 'source';
  if (mode === 'source') {
    warn(
      `[renderer] ignoring apps/renderer-page/dist: ${pageBuild.reasons.join('; ') || 'receipt invalid'}; using current source`,
    );
  }

  const maxAttempts = options.maxAttempts ?? 8;
  let attempt = 0;
  let retryPort: number | null = null;
  let lastBootError: unknown;
  while (attempt < maxAttempts) {
    const port: number = retryPort ?? candidatePort(options.startPort, attempt);
    retryPort = null;
    const baseUrl = `http://localhost:${port}`;
    const serverProcess = spawnServer(mode, port);
    try {
      await waitUntilReady(baseUrl, 30_000, serverProcess);
      if (mode === 'preview') {
        const served = await verifyServed('renderer-page', baseUrl, options.repoRoot, 5_000);
        if (!served.valid) {
          warn(
            `[renderer] preview bytes do not match its receipt: ${served.reasons.join('; ')}; falling back to current source`,
          );
          // Never reuse the preview's port until the preview child has emitted
          // exit. `killed` only means a signal was sent; it is not termination.
          await stopChildProcess(serverProcess);
          mode = 'source';
          retryPort = port;
          continue;
        }
      }
      return { serverProcess, baseUrl, mode, port };
    } catch (error) {
      lastBootError = error;
      try {
        await stopChildProcess(serverProcess);
      } catch (stopError) {
        lastBootError = new AggregateError(
          [error, stopError],
          'renderer vite server failed and its child could not be stopped',
        );
      }
      if (options.fixedPort) break;
      attempt += 1;
    }
  }
  throw new Error(
    `renderer vite server failed to start after port retries: ${lastBootError instanceof Error ? lastBootError.message : String(lastBootError)}`,
  );
}

/** Test-only seam for receipt/fallback process-order regressions. */
export async function _startRendererPageServerForTests(
  options: RendererServerStartOptions,
): Promise<RendererServerStartResult> {
  return await startRendererPageServer(options);
}

async function bootRenderer(): Promise<RendererPageHandle> {
  // Start Vite without a pre-probe. --strictPort binding is the source of truth.
  // CACTUS_RENDER_PORT is a fixed debug port; otherwise spread concurrent
  // subprocesses across deterministic candidates.
  const envPort = Number.parseInt(process.env.CACTUS_RENDER_PORT ?? '', 10);
  const fixedPort = Number.isFinite(envPort) && envPort > 0;
  const startPort = fixedPort
    ? envPort
    : 5173 + ((process.pid % 500) * 5);
  const repoRoot = path.resolve(RENDERER_PAGE_DIR, '..', '..');
  const server = await startRendererPageServer({
    startPort,
    fixedPort,
    repoRoot,
    rendererPageDir: RENDERER_PAGE_DIR,
  });
  const { serverProcess, baseUrl } = server;

  const browserArgs = [
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
  ];
  let browser: Browser;
  try {
    // The Mac already has a maintained Chrome installation. Prefer it so a
    // Playwright package update cannot strand production on a missing,
    // version-pinned browser cache. CI and machines without Chrome retain the
    // normal bundled-Chromium fallback.
    const configuredPath = process.env.CACTUS_RENDER_BROWSER_PATH?.trim();
    browser = await chromium.launch({
      headless: true,
      args: browserArgs,
      ...(configuredPath
        ? { executablePath: configuredPath }
        : { channel: 'chrome' as const }),
    });
  } catch (chromeError) {
    try {
      browser = await chromium.launch({ headless: true, args: browserArgs });
    } catch (bundledError) {
      try { await stopChildProcess(serverProcess); } catch { /* best effort */ }
      throw new Error(
        `renderer browser failed to launch with installed Chrome (${chromeError instanceof Error ? chromeError.message : String(chromeError)}) and bundled Chromium (${bundledError instanceof Error ? bundledError.message : String(bundledError)})`,
      );
    }
  }
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', (msg) => {
      const t = msg.text();
      if (t.startsWith('[cactus]') || msg.type() === 'error') {
        // Forward important page logs to Node stderr only when debugging
        if (process.env.CACTUS_RENDER_VERBOSE) console.error(`[page:${msg.type()}] ${t}`);
      }
    });
    page.on('response', (response) => {
      if (process.env.CACTUS_RENDER_VERBOSE && response.status() >= 400) {
        console.error(`[page:http] ${response.status()} ${response.url()}`);
      }
    });
    page.on('requestfailed', (request) => {
      if (process.env.CACTUS_RENDER_VERBOSE) {
        console.error(
          `[page:requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`,
        );
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
  } catch (error) {
    try { await context?.close(); } catch { /* */ }
    try { await browser.close(); } catch { /* */ }
    try { await stopChildProcess(serverProcess); } catch { /* best effort */ }
    throw error;
  }
}

async function waitForServer(url: string, timeoutMs: number, proc?: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc && childHasExited(proc)) {
      throw new Error(
        `server process exited before ready at ${url} (exit ${proc.exitCode ?? 'signal'}${proc.signalCode ? ` ${proc.signalCode}` : ''})`,
      );
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
      if (peakAbs(pcm) < 1e-4) {
        throw new Error(
          `realtime render stayed near-silent after retries (peak=${peakAbs(pcm).toExponential(2)}; ${(result.warnings ?? []).join('; ')})`,
        );
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
