import { loadMidi, planTracks, trackToStrudel, drumTrackToLayers } from './midi-transcribe.js';
import { readdirSync } from 'node:fs';
const dir='/Users/bowei/CactusStrudel/refs/midi';
const files=readdirSync(dir).filter(f=>f.startsWith('canon_')&&f.endsWith('.mid'));
for(const f of files){
  let m; try{m=loadMidi(dir+'/'+f);}catch{console.log('ERR '+f);continue;}
  const bpm=Math.round(m.header.tempos[0]?.bpm??0);
  console.log(`\n#### ${f.replace('canon_','').replace('.mid','')}  ${bpm}BPM ${m.duration.toFixed(0)}s`);
  const plans=planTracks(m).filter(p=>p.role!=='skip');
  // pick a dense mid window: bars 16-20 (4 bars) for readability
  for(const p of plans.slice(0,6)){
    if(p.isDrum){
      const ls=drumTrackToLayers(m,p.idx,16,20);
      for(const {sample,pat} of ls.slice(0,3)) console.log(`  ${p.role}:${sample}  ${pat.slice(5,69)}`);
    } else {
      const s=trackToStrudel(m,p,16,20);
      if(s) console.log(`  ${p.role}[${p.lo}-${p.hi}] n=${p.noteCount}  ${s.slice(6,78)}`);
    }
  }
}
