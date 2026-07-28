// Realtime-render a Strudel .js file via the (now-faithful) realtime
// renderer. Parses setcpm + arrange() automatically. Pure peak-normalize
// only (no master/sidechain — composition's own dynamics preserved).
// Output: <input>.mp3 next to the source. Lives in apps/cli/src/ so
// @cactus/renderer resolves via workspace symlink + native ESM (the
// scripts/ createRequire approach broke on packages/renderer's ESM
// wavefile import).
//
// Run:  pnpm -C apps/cli -s exec tsx src/auto-render.ts <path.js>
// Used by ~/CactusStrudel/gf as the second stage of the end-to-end loop.
import { render, shutdown } from '@cactus/renderer';
import { analyzeWav } from '@cactus/analyzer';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';

const SRC_RAW = process.argv[2] ?? process.env.SRC;
if (!SRC_RAW) { console.error('[auto-render] usage: auto-render.ts <path.js>'); process.exit(1); }
const SRC: string = SRC_RAW!;
const code = readFileSync(SRC, 'utf8');

// Unique temp WAV per invocation. The old hardcoded /tmp/auto.wav collided
// when multiple renders ran concurrently (the brain fires up to 3 async
// generations at once → 3 renders sharing one wav → corrupt/empty file →
// exit 1). Key it on pid + source basename so concurrent renders never race.
const TMP_WAV = `/tmp/cactus-render-${process.pid}-${basename(SRC).replace(/\.js$/, '')}.wav`;

// setcpm(X/Y) or setcpm(X) → cps. Never eval LLM-authored code here.
let cps = 0.5;
const cpsMatch = code.match(/setcps\(([^)]+)\)/);
const cpmMatch = code.match(/setcpm\(([^)]+)\)/);
if (cpsMatch) {
  cps = parseNumericExpression(cpsMatch[1]!, cps);
} else if (cpmMatch) {
  cps = parseNumericExpression(cpmMatch[1]!, cps * 60) / 60;
}

// arrange() total cycles — balanced-paren scan (regex non-greedy breaks
// on nested ')' from .mask("..."), .arp("..."), etc.).
const defaultCycles = Number.parseInt(process.env.CACTUS_RENDER_DEFAULT_CYCLES ?? '48', 10);
let durationCycles = Number.isFinite(defaultCycles) && defaultCycles > 0 ? defaultCycles : 48;
const idx = code.indexOf('arrange(');
if (idx >= 0) {
  let depth = 0, start = -1, end = -1;
  for (let i = idx + 'arrange('.length - 1; i < code.length; i++) {
    const c = code[i];
    if (c === '(') { if (depth === 0) start = i + 1; depth++; }
    else if (c === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (start > 0 && end > start) {
    const nums = [...code.slice(start, end).matchAll(/\[\s*(\d+)\s*,/g)].map((x) => parseInt(x[1]!));
    if (nums.length) durationCycles = nums.reduce((a, b) => a + b, 0);
  }
}

console.log(`[auto-render] cps=${cps.toFixed(4)} dur=${durationCycles}cyc ~${(durationCycles / cps).toFixed(0)}s realtime…`);

(async () => {
  let r: Awaited<ReturnType<typeof render>>;
  try {
    r = await render({ code, durationCycles, cps, outputPath: TMP_WAV, realtime: true });
  } catch (e) {
    console.log('[auto-render] RENDER FAIL: ' + (e instanceof Error ? e.message.slice(0, 200) : String(e)));
    await shutdown();
    process.exit(1);
  }
  const mx = maxVolumeDb(TMP_WAV);
  const features = await analyzeWav(TMP_WAV);
  const FEATURES_OUT = SRC.replace('/producer-brain/pieces/', '/producer-brain/features/').replace(/\.js$/, '.features.json');
  mkdirSync(dirname(FEATURES_OUT), { recursive: true });
  writeFileSync(FEATURES_OUT, JSON.stringify(features, null, 2));
  // Output mp3 to producer-brain/audio/ (sibling to pieces/), not in-place.
  const OUT = SRC.replace('/producer-brain/pieces/', '/producer-brain/audio/').replace(/\.js$/, '.mp3');
  mkdirSync(dirname(OUT), { recursive: true });
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-y',
    '-i', TMP_WAV,
    '-af', `silenceremove=start_periods=1:start_duration=0.05:start_threshold=-40dB,volume=${(-1 - mx).toFixed(3)}dB`,
    '-c:a', 'libmp3lame',
    '-b:a', '256k',
    OUT,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  const vol = volumeSummary(OUT);
  const sha = createHash('sha256').update(readFileSync(OUT)).digest('hex').slice(0, 16);
  let dur = 0;
  try {
    dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT], { encoding: 'utf8' }).trim());
  } catch (e) {
    console.error(`[auto-render] POSTPROCESS FAIL: ffprobe could not read ${OUT}: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
    try { unlinkSync(TMP_WAV); } catch { /* best-effort cleanup */ }
    await shutdown();
    process.exit(1);
  }
  const wkErr = r.warnings.some((w: string) => /AudioWorklet/i.test(w));
  console.log(`[auto-render] warn=${r.warnings.length}${wkErr ? ' (AudioWorkletError!)' : ''} → ${OUT}`);
  console.log(`[auto-render] dur=${dur.toFixed(1)}s ${vol} sha=${sha}`);
  console.log(`[auto-render] features=${FEATURES_OUT}`);
  try { unlinkSync(TMP_WAV); } catch { /* best-effort cleanup */ }
  await shutdown();
})();

function parseNumericExpression(raw: string, fallback: number): number {
  const expr = raw.trim();
  const number = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
  const single = new RegExp(`^${number}$`);
  const ratio = new RegExp(`^(${number})\\s*\\/\\s*(${number})$`);
  if (single.test(expr)) {
    const n = Number(expr);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
  const m = expr.match(ratio);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const n = a / b;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
  return fallback;
}

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
