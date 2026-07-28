// Web MIDI acquire + objective quality-gate (Bowei: "全网免费抓取+清洗,
// 免费midi品质极差"). Scope = canonical SEQUENCED electronic (Strudel's
// wheelhouse). bitmidi search is fuzzy/noisy → name-match verify, then
// an objective gate rejects the junk free-MIDI is full of. Survivors
// get transcribed for me to READ as a musician (stage 2, separate).
//
// Provenance: refs/midi/ gitignored, local research/structural
// exemplar only, not redistributed; copyrighted compositions.

import midiPkg from '@tonejs/midi';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
const { Midi } = midiPkg;

const REFS = '/Users/bowei/CactusStrudel/refs/midi';
mkdirSync(REFS, { recursive: true });

// Canonical, recognizable, pattern/sequence-driven. {artist title tokens}
const TARGETS: { key: string; must: string[] }[] = [
  { key: 'kraftwerk the robots', must: ['kraftwerk', 'robot'] },
  { key: 'kraftwerk trans europe express', must: ['kraftwerk', 'europe'] },
  { key: 'kraftwerk the model', must: ['kraftwerk', 'model'] },
  { key: 'kraftwerk computer love', must: ['kraftwerk', 'computer'] },
  { key: 'new order blue monday', must: ['order', 'monday'] },
  { key: 'donna summer i feel love', must: ['summer', 'feel'] },
  { key: 'giorgio moroder', must: ['moroder'] },
  { key: 'jean michel jarre oxygene', must: ['jarre', 'oxygene'] },
  { key: 'daft punk around the world', must: ['daft', 'around'] },
  { key: 'daft punk one more time', must: ['daft', 'one more'] },
  { key: 'daft punk harder better faster', must: ['daft', 'harder'] },
  { key: 'daft punk robot rock', must: ['daft', 'robot'] },
  { key: 'air sexy boy', must: ['air', 'sexy boy'] },
  { key: 'air la femme dargent', must: ['air', 'femme'] },
  { key: 'justice dance', must: ['justice', 'dance'] },
  { key: 'gary numan cars', must: ['numan', 'cars'] },
  { key: 'eurythmics sweet dreams', must: ['eurythmics', 'sweet dream'] },
  { key: 'depeche mode enjoy the silence', must: ['enjoy', 'silence'] },
  { key: 'depeche mode personal jesus', must: ['personal', 'jesus'] },
  { key: 'soft cell tainted love', must: ['tainted', 'love'] },
  { key: 'pet shop boys west end girls', must: ['west end', 'girl'] },
  { key: 'vangelis blade runner', must: ['blade runner'] },
  { key: 'jan hammer crockett', must: ['hammer'] },
  { key: 'a ha take on me', must: ['take on me'] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');

async function search(q: string): Promise<{ name: string; url: string }[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://bitmidi.com/api/midi/search?q=${encodeURIComponent(q)}`, {
        signal: AbortSignal.timeout(12000),
      });
      const d: any = await r.json();
      return (d?.result?.results ?? []).map((x: any) => ({ name: x.name, url: x.downloadUrl }));
    } catch {
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
  }
  return [];
}

interface Gate { ok: boolean; reason: string; dur: number; tracks: number; notes: number; }

function objectiveGate(buf: Buffer): Gate {
  let m: InstanceType<typeof Midi>;
  try { m = new Midi(buf); } catch (e) { return { ok: false, reason: `unparseable: ${String((e as Error)?.message ?? e).slice(0, 40)}`, dur: 0, tracks: 0, notes: 0 }; }
  const dur = m.duration;
  const roleful = m.tracks.filter((t) => {
    const n = t.notes;
    if (n.length < 8) return false;
    const uniq = new Set(n.map((x) => x.midi)).size;
    return uniq >= 2 || t.channel === 9; // drums may be 1-pitch but rhythmic
  });
  const totalNotes = m.tracks.reduce((a, t) => a + t.notes.length, 0);
  const bpm = m.header.tempos[0]?.bpm ?? 0;
  let reason = 'ok';
  let ok = true;
  if (dur < 45) { ok = false; reason = `too short ${dur.toFixed(0)}s`; }
  else if (dur > 900) { ok = false; reason = `too long ${dur.toFixed(0)}s`; }
  else if (roleful.length < 2) { ok = false; reason = `<2 roleful tracks (${roleful.length}) — single-mush/karaoke`; }
  else if (totalNotes < 120) { ok = false; reason = `only ${totalNotes} notes — stub`; }
  else if (bpm < 50 || bpm > 220) { ok = false; reason = `tempo ${bpm.toFixed(0)} insane`; }
  return { ok, reason, dur, tracks: roleful.length, notes: totalNotes };
}

(async () => {
  const report: string[] = [];
  for (const t of TARGETS) {
    const results = await search(t.key);
    const match = results.find((r) => {
      const n = norm(r.name);
      return t.must.every((tok) => n.includes(tok));
    });
    if (!match) { report.push(`✗ ${t.key} — no name-match in ${results.length} results`); continue; }
    const safe = t.key.replace(/[^a-z0-9]+/g, '_');
    const dest = `${REFS}/canon_${safe}.mid`;
    if (!existsSync(dest)) {
      try {
        const r = await fetch(`https://bitmidi.com${match.url}`, { signal: AbortSignal.timeout(20000) });
        const buf = Buffer.from(await r.arrayBuffer());
        writeFileSync(dest, buf);
      } catch (e) { report.push(`✗ ${t.key} — download fail ${(e as Error).message.slice(0, 30)}`); continue; }
    }
    const { readFileSync } = await import('node:fs');
    const g = objectiveGate(readFileSync(dest));
    report.push(`${g.ok ? '✓' : '✗'} ${t.key}  "${match.name.slice(0, 38)}"  dur=${g.dur.toFixed(0)}s tr=${g.tracks} n=${g.notes} ${g.ok ? '' : '— ' + g.reason}`);
  }
  console.log(report.join('\n'));
  console.log(`\nPASS objective: ${report.filter((r) => r.startsWith('✓')).length}/${TARGETS.length}`);
})();
