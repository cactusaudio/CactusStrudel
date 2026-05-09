import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { WaveFile } from 'wavefile';

export interface RenderInput {
  code: string;
  durationCycles: number;
  cps?: number;
  sampleRate?: number;
  outputPath: string;
  maxPolyphony?: number;
  multiChannelOrbits?: number[];
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

export async function ensureRenderer(): Promise<RendererPageHandle> {
  if (!sharedHandle) {
    sharedHandle = bootRenderer();
  }
  activeRenders++;
  return sharedHandle;
}

export async function releaseRenderer(): Promise<void> {
  activeRenders--;
  if (activeRenders <= 0 && sharedHandle) {
    const h = await sharedHandle;
    sharedHandle = null;
    activeRenders = 0;
    try { await h.context.close(); } catch { /* */ }
    try { await h.browser.close(); } catch { /* */ }
    if (h.serverProcess && !h.serverProcess.killed) {
      h.serverProcess.kill('SIGTERM');
    }
  }
}

async function bootRenderer(): Promise<RendererPageHandle> {
  // Start vite dev server (cheap; no build step needed for first run).
  const port = 5173;
  const baseUrl = `http://localhost:${port}`;

  const distExists = await fs
    .stat(path.join(RENDERER_PAGE_DIR, 'dist', 'index.html'))
    .then(() => true)
    .catch(() => false);

  let serverProcess: ChildProcess | undefined;
  if (distExists) {
    serverProcess = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(port), '--strictPort'], {
      cwd: RENDERER_PAGE_DIR,
      stdio: 'pipe',
    });
  } else {
    serverProcess = spawn('pnpm', ['exec', 'vite', '--port', String(port), '--strictPort'], {
      cwd: RENDERER_PAGE_DIR,
      stdio: 'pipe',
    });
  }

  await waitForServer(baseUrl, 30_000);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-features=IsolateOrigins,site-per-process',
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

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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
    const result = (await handle.page.evaluate(
      async ({ code, durationCycles, cps, sampleRate, maxPolyphony, multiChannelOrbits }) => {
        return await (window as any).__cactusRender({
          code,
          durationCycles,
          cps,
          sampleRate,
          maxPolyphony,
          multiChannelOrbits,
        });
      },
      {
        code: input.code,
        durationCycles: input.durationCycles,
        cps: input.cps ?? 0.5,
        sampleRate,
        maxPolyphony: input.maxPolyphony ?? 64,
        multiChannelOrbits: input.multiChannelOrbits ?? [],
      },
    )) as {
      pcmBase64: string;
      sampleRate: number;
      channels: number;
      durationSec: number;
      warnings: string[];
    };

    const versions = await handle.page.evaluate(() => (window as any).__cactusVersions);

    const pcm = base64ToFloat32(result.pcmBase64);
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
