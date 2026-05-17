// #72 proof: one keygen .xm → faithful transcription → our renderer →
// feature-distance vs the libopenmpt acoustic oracle. Tier-A
// (rhythm/structure) must track; Tier-B (timbre/centroid) is expected
// to diverge by design (oscillators vs samples).

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { render, shutdown } from '@cactus/renderer';
import { analyzeWav } from '@cactus/analyzer';
import { parseXM, channelStats, xmNoteToStrudel } from './keygen-transcribe.js';

const XM = '/Users/bowei/CactusStrudel/refs/keygen/proof.xm';
const ORACLE = '/Users/bowei/CactusStrudel/refs/keygen/proof.xm.wav';

const m = parseXM(readFileSync(XM));
console.log(`module="${m.name}" ch=${m.numChannels} pat=${m.numPatterns} ord=${m.order.length} speed=${m.speed} bpm=${m.bpm}`);
// Ground-truth checksum vs openmpt123 --info.
const expect = { ch: 4, pat: 4, ord: 6, speed: 11, bpm: 143 };
const ok = m.numChannels === expect.ch && m.numPatterns === expect.pat && m.order.length === expect.ord && m.speed === expect.speed && m.bpm === expect.bpm;
console.log(`parser checksum vs openmpt123 --info: ${ok ? 'PASS' : 'FAIL ' + JSON.stringify(expect)}`);

for (let c = 0; c < m.numChannels; c++) {
  const s = channelStats(m, c);
  console.log(`  ch${c}: notes=${s.notes} density=${s.density.toFixed(2)} meanNote=${s.meanNote.toFixed(1)} range=[${s.lo}-${s.hi}]`);
}

// Faithful whole-song transcription: every ordered pattern's rows, in
// order, as one token grid per channel (1 cycle = whole song so each
// token = one XM row exactly). Oracle duration is the timing truth.
const oracleDurSec = (() => {
  const out = execSync(`openmpt123 --info ${JSON.stringify(XM)} 2>&1`).toString();
  const mm = out.match(/Duration\.+:\s*(\d+):(\d+(?:\.\d+)?)/);
  return mm ? parseInt(mm[1]!, 10) * 60 + parseFloat(mm[2]!) : 50.759;
})();

const channelTokens: string[][] = Array.from({ length: m.numChannels }, () => []);
for (const pi of m.order) {
  const pat = m.patterns[pi];
  if (!pat) continue;
  for (const row of pat) {
    for (let c = 0; c < m.numChannels; c++) {
      const cell = row[c];
      const nm = cell ? xmNoteToStrudel(cell.note) : '';
      channelTokens[c]!.push(nm || '~');
    }
  }
}
const totalRows = channelTokens[0]!.length;
const cps = 1 / oracleDurSec;
const layers = channelTokens
  .map((toks, c) => ({ c, toks }))
  .filter(({ toks }) => toks.some((t) => t !== '~'))
  .map(({ toks }) => `note("${toks.join(' ')}").s("sawtooth")`);
const code = `setcps(${cps.toFixed(6)})\nstack(\n  ${layers.join(',\n  ')}\n)`;
console.log(`transcribed ${layers.length}/${m.numChannels} non-empty channels, ${totalRows} rows, cps=${cps.toFixed(5)} (songDur=${oracleDurSec}s)`);

const outWav = '/tmp/keygen_proof_ours.wav';
const r = await render({ code, durationCycles: 1, outputPath: outWav });
await shutdown();
if (r.warnings.length) console.log('render warnings:', r.warnings.slice(0, 3));

const [ours, ref] = await Promise.all([analyzeWav(outWav), analyzeWav(ORACLE)]);
const od = (f: any) => (f.rhythmic.onset_density.low + f.rhythmic.onset_density.mid + f.rhythmic.onset_density.high);
console.log('\n=== Tier-A (rhythm/structure — MUST track) ===');
console.log(`onset_density Σ : ours=${od(ours).toFixed(2)}  oracle=${od(ref).toFixed(2)}`);
console.log(`bpm            : ours=${ours.rhythmic.bpm.toFixed(1)}  oracle=${ref.rhythmic.bpm.toFixed(1)}  (module nominal ${m.bpm})`);
console.log(`grid_regularity: ours=${ours.rhythmic.grid_regularity.toFixed(3)}  oracle=${ref.rhythmic.grid_regularity.toFixed(3)}`);
console.log(`syncopation    : ours=${ours.rhythmic.syncopation_proxy.toFixed(3)}  oracle=${ref.rhythmic.syncopation_proxy.toFixed(3)}`);
console.log('=== Tier-B (timbre — expected to diverge: osc vs samples) ===');
console.log(`centroid Hz    : ours=${ours.spectral.centroid.toFixed(0)}  oracle=${ref.spectral.centroid.toFixed(0)}`);
const lufs = (f: any) => (f.loudness?.lufs_integrated ?? NaN).toFixed(1);
console.log(`LUFS           : ours=${lufs(ours)}  oracle=${lufs(ref)}`);
