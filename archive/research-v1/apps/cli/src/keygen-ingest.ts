// Keygen .xm → cookbook JSONL writer (contract §4/§7). Usage:
//   tsx src/keygen-ingest.ts <module.xm> <genre> [--dry]
// Emits one CookbookEntry per non-empty channel, VALIDATES each
// against CookbookEntrySchema (fail loud — verify, don't assume),
// idempotently appends to cookbook/<genre>/<role>.jsonl. refs/keygen
// source stays gitignored; provenance on every entry.

import { readFileSync, existsSync, readFileSync as rf, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CookbookEntrySchema } from '@cactus/cookbook';
import { parseXM, channelStats, inferRole, toCookbookEntry } from './keygen-transcribe.js';

const [modPath, genre, ...rest] = process.argv.slice(2);
const dry = rest.includes('--dry');
if (!modPath || !genre) {
  console.error('usage: keygen-ingest <module.xm> <genre> [--dry]');
  process.exit(2);
}
const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const m = parseXM(readFileSync(modPath));
console.log(`"${m.name}" → genre=${genre}  ch=${m.numChannels} bpm=${m.bpm}${dry ? '  [DRY]' : ''}`);

let written = 0, skipped = 0, invalid = 0;
for (let c = 0; c < m.numChannels; c++) {
  const s = channelStats(m, c);
  const proposed = inferRole(s);
  if (!proposed) { console.log(`  ch${c}: empty — skip`); continue; }
  const entry = toCookbookEntry(m, c, genre);
  if (!entry) { console.log(`  ch${c}: no usable line — skip`); continue; }

  const parsed = CookbookEntrySchema.safeParse(entry);
  if (!parsed.success) {
    invalid++;
    console.log(`  ch${c}: ✗ SCHEMA INVALID (${proposed}) — ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    continue;
  }
  const file = path.join(REPO, 'cookbook', genre, `${entry.role}.jsonl`);
  const existing = existsSync(file) ? rf(file, 'utf8') : '';
  if (existing.includes(`"id":"${entry.id}"`)) {
    skipped++;
    console.log(`  ch${c}: = ${entry.role} ${entry.id} (already present — idempotent skip)`);
    continue;
  }
  console.log(`  ch${c}: → ${entry.role} ${entry.id}  "${entry.mini_notation!.slice(0, 56)}${entry.mini_notation!.length > 56 ? '…' : ''}"`);
  if (!dry) {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(parsed.data) + '\n');
    written++;
  }
}
console.log(`done: ${written} written, ${skipped} skipped, ${invalid} invalid${dry ? ' (dry — nothing written)' : ''}`);
