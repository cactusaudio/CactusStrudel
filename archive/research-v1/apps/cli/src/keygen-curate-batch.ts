// #75 batch curation. I cannot judge musicality (Bowei's ear is the
// oracle) — selection is STRUCTURAL: 4-channel (clean role
// separation), moderate pattern count (real songs, not 1-bar loops or
// 50-pattern epics), spread across the 5 demo genres so each demo's
// enabled-mode render has keygen melodic/harmonic material to pull.
// Genre auto-assigned by the module's OWN nominal BPM; a melodic
// subset is forced to idm (the only demo genre whose buildLayers has
// a `lead` layer → exercises lead_hook). Copies sources into
// refs/keygen/ (gitignored) and validate-writes entries.

import { readFileSync, copyFileSync, existsSync, readFileSync as rf, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CookbookEntrySchema } from '@cactus/cookbook';
import { parseXM, channelStats, inferRole, toCookbookEntry } from './keygen-transcribe.js';

const PACK = '/Users/bowei/Downloads/keygenmusic-main/KEYGENMUSiC MusicPack/Core';
const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const REFS = path.join(REPO, 'refs', 'keygen');

// Structural pick (4-channel, moderate complexity = real songs).
// .mod dropped — the parser is XM-only (ProTracker .mod is a different
// binary format; deferred per contract §2, not silently broken).
// Genre = which DEMO pulls this material (the compiler re-times to the
// demo's BPM anyway, so the keygen's own tempo is irrelevant for the
// tag). Spread evenly across the 5 demo genres so EVERY demo's
// enabled-mode render gets keygen melodic/harmonic content — bpm-
// bucketing collapsed everything to dub_techno (keygen clusters ~125).
const PICKS: Array<{ file: string; genre: string }> = [
  { file: 'CORE - Airfoil 4.7.4 MacOSX kg.xm', genre: 'techno' },
  { file: 'CORE - WebSaver 0.2.1 MacOSX kg.xm', genre: 'techno' },
  { file: 'CORE - Publicspace.net A Better Finder Rename 8.71 kg.xm', genre: 'dub_techno' },
  { file: 'CORE - ProfitTrain 2.0.7 MacOSX kg.xm', genre: 'dub_techno' },
  { file: 'CORE - PreFab UI Actions 1.2.1 MacOSX kg.xm', genre: 'ambient' },
  { file: 'CORE - VMware Fusion 3.1.0 Mac OS X kg.xm', genre: 'ambient' },
  { file: 'CORE - MacDrive 8 kg.xm', genre: 'dnb' },
  { file: 'CORE - Sorenson Squeeze Pro 8.5 kg.xm', genre: 'dnb' },
  { file: 'CORE - Hibari 1.x MacOS kg.xm', genre: 'idm' },
  { file: 'CORE - Rocketbox 1.x MacOS kg.xm', genre: 'idm' },
  { file: 'CORE - 33 RPM 1.1.7 MacOSX kg.xm', genre: 'idm' },
];

const dry = process.argv.includes('--dry');
let totalW = 0, totalSkip = 0, totalInvalid = 0;
const perGenre: Record<string, Record<string, number>> = {};

for (const { file, genre } of PICKS) {
  const src = path.join(PACK, file);
  if (!existsSync(src)) { console.log(`MISSING: ${file}`); continue; }
  let m;
  try { m = parseXM(readFileSync(src)); }
  catch (e) { console.log(`PARSE FAIL ${file}: ${(e as Error).message}`); continue; }
  if (!dry) { mkdirSync(REFS, { recursive: true }); copyFileSync(src, path.join(REFS, file)); }
  const roles: string[] = [];
  for (let c = 0; c < m.numChannels; c++) {
    const s = channelStats(m, c);
    if (!inferRole(s)) continue;
    const entry = toCookbookEntry(m, c, genre);
    if (!entry) continue;
    const v = CookbookEntrySchema.safeParse(entry);
    if (!v.success) { totalInvalid++; continue; }
    const fp = path.join(REPO, 'cookbook', genre, `${entry.role}.jsonl`);
    const had = existsSync(fp) ? rf(fp, 'utf8') : '';
    if (had.includes(`"id":"${entry.id}"`)) { totalSkip++; continue; }
    if (!dry) { mkdirSync(path.dirname(fp), { recursive: true }); appendFileSync(fp, JSON.stringify(v.data) + '\n'); }
    totalW++;
    roles.push(entry.role);
    (perGenre[genre] ??= {})[entry.role] = ((perGenre[genre] ??= {})[entry.role] ?? 0) + 1;
  }
  console.log(`${dry ? '[dry] ' : ''}"${m.name}" bpm=${m.bpm} → ${genre}: [${roles.join(', ') || 'none'}]`);
}
console.log(`\ntotal: ${totalW} written, ${totalSkip} skipped, ${totalInvalid} invalid${dry ? ' (dry)' : ''}`);
console.log('per-genre roles:', JSON.stringify(perGenre));
