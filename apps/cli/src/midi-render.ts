import { loadMidi, songStrudel } from './midi-transcribe.js';
import { render, shutdown } from '@cactus/renderer';
import { writeFileSync } from 'node:fs';
const m = loadMidi('/Users/bowei/CactusStrudel/refs/midi/daftpunk_da_funk.mid');
const { code, durSec } = songStrudel(m);
writeFileSync('/tmp/dafunk.strudel.js', code);
const out = '/Users/bowei/Downloads/midi_daftpunk_dafunk.wav';
// renderer window = durationCycles / cps (in-code setcps does NOT size it).
// songStrudel maps 1 cycle = whole song → cps = 1/durSec, 1 cycle.
const r = await render({ code, durationCycles: 1, cps: 1 / durSec, outputPath: out });
await shutdown();
console.log('warnings:', JSON.stringify(r.warnings.slice(0,4)), 'reportedDurSec:', r.durationSec?.toFixed?.(1));
