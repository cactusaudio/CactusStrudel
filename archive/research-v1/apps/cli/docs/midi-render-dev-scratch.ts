import { loadMidi, songStrudel } from './midi-transcribe.js';
import { render, shutdown } from '@cactus/renderer';
// Historical local-only MIDI render scratchpad. Kept outside src/ so it is not
// compiled or treated as a supported CLI entrypoint.
const jobs: [string,string][] = [
  ['canon_kraftwerk_the_robots', '01_kraftwerk_the_robots'],
  ['canon_eurythmics_sweet_dreams', '02_eurythmics_sweet_dreams'],
  ['canon_a_ha_take_on_me', '03_aha_take_on_me'],
];
for (const [src,outName] of jobs) {
  try {
    const m = loadMidi(`/Users/bowei/CactusStrudel/refs/midi/${src}.mid`);
    const { code, durSec } = songStrudel(m);
    const out = `/Users/bowei/Downloads/midi_${outName}.wav`;
    const r = await render({ code, durationCycles: 1, cps: 1/durSec, outputPath: out });
    console.log(`${outName}: durSec~${durSec.toFixed(0)} warn=${r.warnings.length}`);
  } catch(e){ console.log(`${outName}: ERR ${(e as Error)?.message?.slice(0,80)}`); }
}
await shutdown();
