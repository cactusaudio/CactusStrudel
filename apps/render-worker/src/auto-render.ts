// Realtime-render a Strudel .js file via the production realtime renderer.
// Timing is extracted statically from the JavaScript AST; dynamic or ambiguous
// timing fails explicitly rather than silently capturing the wrong duration.
// Post-processing is peak-normalization only, preserving the composition's
// timeline and dynamics.
// Output: <input>.mp3 next to the source. This worker is the only production
// bridge from v3 jobs into the renderer/analyzer workspace packages.
//
// Run: pnpm -C apps/render-worker -s exec tsx src/auto-render.ts <path.js>
// Used by the v3 durable generation/preview jobs after deterministic validation.
import { render, shutdown } from '@cactus/renderer';
import { analyzeWav } from '@cactus/analyzer';
import { extractRenderTiming } from '@cactus/strudel-validator';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const SRC_RAW = process.argv[2] ?? process.env.SRC;
if (!SRC_RAW) { console.error('[auto-render] usage: auto-render.ts <path.js>'); process.exit(1); }
const SRC: string = SRC_RAW!;
const code = readFileSync(SRC, 'utf8');

// Generation batches can render concurrently, so every process owns distinct
// capture and analysis files in the platform temp directory.
const tempStem = `cactus-render-${process.pid}-${basename(SRC)
  .replace(/\.js$/, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '_')}`;
const CAPTURE_WAV = join(tmpdir(), `${tempStem}-capture.wav`);
const FINAL_MP3_WAV = join(tmpdir(), `${tempStem}-final-mp3.wav`);
const TEMP_FILES = [CAPTURE_WAV, FINAL_MP3_WAV] as const;

async function main(): Promise<void> {
  try {
    const configuredDefaultCycles = process.env.CACTUS_RENDER_DEFAULT_CYCLES;
    const timing = extractRenderTiming(code, {
      defaultCycles: configuredDefaultCycles === undefined
        ? 48
        : Number(configuredDefaultCycles),
    });
    const { cps, durationCycles } = timing;
    console.log(
      `[auto-render] cps=${cps.toFixed(4)} (${timing.tempoSource}) `
      + `dur=${durationCycles}cyc (${timing.durationSource}) `
      + `~${(durationCycles / cps).toFixed(0)}s realtime…`,
    );

    const rendered = await render({
      code,
      durationCycles,
      cps,
      outputPath: CAPTURE_WAV,
      realtime: true,
    });

    // Output mp3 to producer-brain/audio/ (sibling to pieces/), not in-place.
    const out = SRC
      .replace('/producer-brain/pieces/', '/producer-brain/audio/')
      .replace(/\.js$/, '.mp3');
    mkdirSync(dirname(out), { recursive: true });

    // Normalize peak only. Never remove leading silence: an opening rest is
    // authored musical timing and must survive into the immutable audio bytes.
    const mx = maxVolumeDb(CAPTURE_WAV);
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-y',
      '-i', CAPTURE_WAV,
      '-af', `volume=${(-1 - mx).toFixed(3)}dB`,
      '-c:a', 'libmp3lame',
      '-b:a', '256k',
      out,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });

    // Feature evidence must describe the delivered, normalized MP3 rather than
    // the pre-encode capture. Decode that exact MP3 into a temporary WAV because
    // the analyzer intentionally accepts a narrow WAV input contract.
    const featuresOut = SRC
      .replace('/producer-brain/pieces/', '/producer-brain/features/')
      .replace(/\.js$/, '.features.json');
    let featuresWritten = false;
    try {
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-y',
        '-i', out,
        '-map', '0:a:0',
        '-c:a', 'pcm_f32le',
        FINAL_MP3_WAV,
      ], { stdio: ['ignore', 'ignore', 'ignore'] });
      const features = await analyzeWav(FINAL_MP3_WAV);
      mkdirSync(dirname(featuresOut), { recursive: true });
      writeFileSync(featuresOut, JSON.stringify(features, null, 2));
      featuresWritten = true;
    } catch (error) {
      console.warn(
        `[auto-render] feature analysis unavailable: ${
          error instanceof Error ? error.message.slice(0, 240) : String(error)
        }`,
      );
    }

    const vol = volumeSummary(out);
    const sha = createHash('sha256').update(readFileSync(out)).digest('hex').slice(0, 16);
    const dur = Number.parseFloat(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out],
        { encoding: 'utf8' },
      ).trim(),
    );
    if (!Number.isFinite(dur) || dur <= 0) {
      throw new Error(`ffprobe returned invalid duration for ${out}`);
    }
    const wkErr = rendered.warnings.some((warning: string) => /AudioWorklet/i.test(warning));
    console.log(`[auto-render] warn=${rendered.warnings.length}${wkErr ? ' (AudioWorkletError!)' : ''} → ${out}`);
    console.log(`[auto-render] dur=${dur.toFixed(1)}s ${vol} sha=${sha}`);
    console.log(`[auto-render] features=${featuresWritten ? featuresOut : 'unavailable'}`);
  } catch (error) {
    console.error(
      `[auto-render] FAIL: ${
        error instanceof Error ? error.message.slice(0, 1000) : String(error)
      }`,
    );
    process.exitCode = 1;
  } finally {
    for (const path of TEMP_FILES) {
      try { unlinkSync(path); } catch { /* best-effort cleanup */ }
    }
    try { await shutdown(); } catch { /* boot failure already owns its diagnostics */ }
  }
}

await main();

function ffmpegVolumedetect(path: string): string {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], {
    encoding: 'utf8',
  });
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
}

function maxVolumeDb(path: string): number {
  const text = ffmpegVolumedetect(path);
  const m = text.match(/max_volume:\s*([-0-9.]+)\s*dB/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function volumeSummary(path: string): string {
  const text = ffmpegVolumedetect(path);
  return [...text.matchAll(/(?:mean|max)_volume:\s*[-0-9.]+\s*dB/g)].map((m) => m[0]).join(' ');
}
