// Strudel → MIDI export. Queries haps via @cactus/renderer's headless
// Chromium, then writes a standard MIDI file (format 0, single track).
//
// Run:  pnpm -C apps/cli -s exec tsx src/midi-export.ts <input.js> <output.mid> [cycles] [cps]
//
// Standalone research/operator helper. The v3 HTTP API does not expose MIDI.
import { queryHaps, shutdown } from '@cactus/renderer';
import { readFileSync, writeFileSync } from 'node:fs';

const JS  = process.argv[2];
const OUT = process.argv[3];
const CYC = parseFloat(process.argv[4] || '64');
const CPS = parseFloat(process.argv[5] || '0.5');
if (!JS || !OUT) { console.error('usage: midi-export.ts <input.js> <output.mid> [cycles] [cps]'); process.exit(1); }
if (!Number.isFinite(CYC) || CYC <= 0) { console.error('cycles must be a positive number'); process.exit(1); }
if (!Number.isFinite(CPS) || CPS <= 0) { console.error('cps must be a positive number'); process.exit(1); }
const code = readFileSync(JS, 'utf8');

const PPQ = 480; // ticks per quarter
const secPerQuarter = 1 / CPS / 4; // 1 cycle = 4 quarters (Strudel default)

// ---- minimal SMF writer ----------------------------------------------------
function vlq(n: number): number[] {
  // variable-length quantity (delta time)
  const bytes: number[] = [n & 0x7f];
  n >>>= 7;
  while (n > 0) { bytes.unshift(0x80 | (n & 0x7f)); n >>>= 7; }
  return bytes;
}
function u16(n: number): number[] { return [(n >> 8) & 0xff, n & 0xff]; }
function u32(n: number): number[] { return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]; }

(async () => {
  let r;
  try {
    r = await queryHaps({ code, durationCycles: CYC, cps: CPS });
  } catch (e) {
    console.error('queryHaps failed: ' + (e instanceof Error ? e.message : String(e)));
    await shutdown(); process.exit(2);
  }
  if (r.warnings.length) console.warn('warnings: ' + r.warnings.join(' | '));

  // Build (time-in-ticks, status, n, vel) note-on/off events
  type Ev = { t: number; status: number; a: number; b: number };
  const evs: Ev[] = [];
  for (const h of r.haps) {
    if (h.note == null) continue;
    const tOn  = Math.round((h.begin / secPerQuarter) * PPQ);
    const tOff = Math.max(tOn + 1, Math.round((h.end / secPerQuarter) * PPQ));
    const vel = Math.max(1, Math.min(127, h.vel ?? 96));
    const ch = Math.max(0, Math.min(15, h.ch ?? 0));
    evs.push({ t: tOn,  status: 0x90 | ch, a: h.note, b: vel });
    evs.push({ t: tOff, status: 0x80 | ch, a: h.note, b: 0 });
  }
  evs.sort((x, y) => x.t - y.t || (x.status & 0xf0) - (y.status & 0xf0));

  // Track chunk: tempo meta + events + end-of-track
  const trackBytes: number[] = [];
  // tempo (microseconds per quarter): cps → secPerQuarter * 1e6
  const usPerQuarter = Math.round(secPerQuarter * 1_000_000);
  trackBytes.push(0x00, 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);
  // events
  let last = 0;
  for (const e of evs) {
    const dt = Math.max(0, e.t - last);
    trackBytes.push(...vlq(dt), e.status, e.a, e.b);
    last = e.t;
  }
  // end of track
  trackBytes.push(0x00, 0xff, 0x2f, 0x00);

  // Header chunk + track chunk
  const file: number[] = [];
  file.push(0x4d, 0x54, 0x68, 0x64);       // MThd
  file.push(...u32(6));
  file.push(...u16(0));                    // format 0
  file.push(...u16(1));                    // ntrks
  file.push(...u16(PPQ));                  // division
  file.push(0x4d, 0x54, 0x72, 0x6b);       // MTrk
  file.push(...u32(trackBytes.length));
  file.push(...trackBytes);

  writeFileSync(OUT, Buffer.from(file));
  console.log(`midi: ${r.haps.length} notes → ${OUT} (${file.length}b, tempo ${Math.round(60_000_000/usPerQuarter)}bpm·quarter)`);
  await shutdown();
})();
