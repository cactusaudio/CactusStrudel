// Keygen .xm → cookbook transcriber (contract path C, Tier-A:
// pitch/rhythm faithful; timbre is the oscillator-renderer's problem,
// not transcription's). Binary offsets verified against openmpt123
// --info on refs/keygen/proof.xm (4ch / 4pat / 6ord / speed 11 /
// BPM 143). FastTracker II XM v1.04.

export interface XmCell {
  note: number;   // 0 none, 1..96 = C-0..B-7, 97 key-off
  inst: number;
  vol: number;
  fx: number;
  fxp: number;
}
export interface XmModule {
  name: string;
  numChannels: number;
  numPatterns: number;
  numInstruments: number;
  speed: number;          // ticks per row
  bpm: number;            // module nominal tempo
  order: number[];        // pattern play order
  patterns: XmCell[][][]; // [pattern][row][channel]
}

import type { CookbookEntry } from '@cactus/cookbook';

const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

/** XM note number (1 = C-0) → Strudel note literal ("c4"); '' for none/keyoff. */
export function xmNoteToStrudel(n: number): string {
  if (n <= 0 || n >= 97) return '';
  const s = n - 1;
  return NOTE_NAMES[s % 12]! + Math.floor(s / 12);
}

export function parseXM(buf: Buffer): XmModule {
  if (buf.toString('latin1', 0, 17) !== 'Extended Module: ') {
    throw new Error('not an XM module (bad magic)');
  }
  const name = buf.toString('latin1', 17, 37).replace(/\0+$/, '').trim();
  const headerSize = buf.readUInt32LE(60);
  const songLength = buf.readUInt16LE(64);
  const numChannels = buf.readUInt16LE(68);
  const numPatterns = buf.readUInt16LE(70);
  const numInstruments = buf.readUInt16LE(72);
  const speed = buf.readUInt16LE(76);
  const bpm = buf.readUInt16LE(78);
  const order: number[] = [];
  for (let i = 0; i < songLength; i++) order.push(buf.readUInt8(80 + i));

  // Patterns begin at 60 + headerSize; each: own header then packed data.
  let off = 60 + headerSize;
  const patterns: XmCell[][][] = [];
  for (let p = 0; p < numPatterns; p++) {
    const patHdrLen = buf.readUInt32LE(off);
    const numRows = buf.readUInt16LE(off + 5);
    const packedSize = buf.readUInt16LE(off + 7);
    let d = off + patHdrLen;
    const end = d + packedSize;
    const rows: XmCell[][] = [];
    for (let r = 0; r < numRows; r++) {
      const chans: XmCell[] = [];
      for (let c = 0; c < numChannels; c++) {
        const cell: XmCell = { note: 0, inst: 0, vol: 0, fx: 0, fxp: 0 };
        if (d < end) {
          const b = buf.readUInt8(d++);
          if (b & 0x80) {
            if (b & 0x01) cell.note = buf.readUInt8(d++);
            if (b & 0x02) cell.inst = buf.readUInt8(d++);
            if (b & 0x04) cell.vol = buf.readUInt8(d++);
            if (b & 0x08) cell.fx = buf.readUInt8(d++);
            if (b & 0x10) cell.fxp = buf.readUInt8(d++);
          } else {
            cell.note = b;
            cell.inst = buf.readUInt8(d++);
            cell.vol = buf.readUInt8(d++);
            cell.fx = buf.readUInt8(d++);
            cell.fxp = buf.readUInt8(d++);
          }
        }
        chans.push(cell);
      }
      rows.push(chans);
    }
    patterns.push(rows);
    off = end; // packedSize==0 ⇒ empty pattern, off stays put correctly
  }
  return { name, numChannels, numPatterns, numInstruments, speed, bpm, order, patterns };
}

// XM note# reference: 1=C-0, +12/octave. C-2=25 C-3=37 C-4=49 C-5=61.
export type CbRole = CookbookEntry['role'];

/**
 * Channel → cookbook role. Heuristic over channelStats (the proven
 * signal: pitch-range + density + single-pitch detection). The
 * transcriber PROPOSES; curation/ear confirms (contract §4). Returns
 * null for an empty channel.
 */
export function inferRole(s: ReturnType<typeof channelStats>): CbRole | null {
  if (s.notes === 0) return null;
  const range = s.hi - s.lo;
  // Fixed-pitch channel = a drum/sample trigger. SKIP: the cookbook
  // already has kick/hat/perc, a single-pitch trigger does not
  // transcribe as a useful *pitched* entry, and keygen's value (the
  // contract's precision budget) is the melodic/harmonic content the
  // cookbook is MISSING — not drums.
  if (range <= 2) return null;
  if (s.meanNote < 49) return 'bass';                          // below C-4
  if (s.density < 0.22) return 'pad_atmo';                      // sparse, sustained
  if (s.meanNote >= 56 && s.density >= 0.45) return 'lead_hook'; // high + busy
  return 'chord_stab';                                          // mid ground
}

function clampBpm(_b: number): [number, number] {
  // Transcribed melodic/harmonic content is tempo-AGNOSTIC: it is pitch
  // material that the compiler re-times to the consuming demo's BPM
  // (the genre tag already decouples it from the keygen's own tempo).
  // A narrow ±6 (copied from bpm-calibrated drum-groove entries) was
  // wrong modelling — it hard-excluded the entry from retrieve()'s bpm
  // filter for any demo at a different tempo (dnb 174 / idm 110 / …).
  // Wide range = "usable across the electronic tempo span".
  return [60, 200];
}
function energyFor(density: number): CookbookEntry['energy_range'] {
  if (density < 0.3) return ['low', 'mid'];
  if (density < 0.6) return ['mid'];
  if (density < 0.8) return ['mid', 'high'];
  return ['high', 'peak'];
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'mod';
}

/**
 * One channel → a schema-valid CookbookEntry (NOT yet validated here;
 * the caller validates against CookbookEntrySchema before writing).
 * mini_notation = the channel's busiest ordered pattern (most
 * representative), capped at 64 rows (≤4 bars — the cookbook unit).
 * Tier-A faithful; timbre is the renderer's job (source_type records
 * provenance; validation_status starts `candidate`).
 */
export function toCookbookEntry(
  m: XmModule, ch: number, genre: string,
): CookbookEntry | null {
  const s = channelStats(m, ch);
  const role = inferRole(s);
  if (!role) return null;
  // Most representative pattern for this channel = max note count.
  let bestPat = m.order[0] ?? 0, bestNotes = -1;
  for (const pi of new Set(m.order)) {
    const pat = m.patterns[pi];
    if (!pat) continue;
    let n = 0;
    for (const row of pat) { const v = row[ch]?.note ?? 0; if (v > 0 && v < 97) n++; }
    if (n > bestNotes) { bestNotes = n; bestPat = pi; }
  }
  const patRows = m.patterns[bestPat]?.length ?? 16;
  const mini = channelBarMiniNotation(m, ch, bestPat, 0, Math.min(patRows, 64));
  if (!mini || /^[~\s]*$/.test(mini)) return null;
  const busy = s.density >= 0.5 ? 'busy' : 'sparse';
  return {
    schema_version: '2.0.0',
    id: `kg-${genre}-${role}-${slug(m.name)}-c${ch}`.slice(0, 60),
    genre,
    role,
    mini_notation: mini,
    energy_range: energyFor(s.density),
    bpm_range: clampBpm(m.bpm),
    bar_intent: `keygen ${role} from "${m.name}" ch${ch}: ${s.notes}-note ${busy} line, ${s.hi - s.lo}-semitone range`.slice(0, 200),
    compatible_sections: s.density < 0.25 ? ['intro', 'main'] : ['main'],
    incompatible_sections: [],
    required_layers: [],
    forbidden_constraints: [],
    sound_palette_tags: [],
    free_tags: ['keygen', 'tracker', slug(m.name)],
    mix_implications: {},
    expected_movement: {},
    revision_affordances: [],
    validation_status: 'candidate',
    source_type: 'external_reference_transcription',
    provenance_note: `CORE keygen pack — "${m.name}" ch${ch}; inferred ${role} (meanNote ${s.meanNote.toFixed(0)}, density ${s.density.toFixed(2)}); XM v1.04 Tier-A pitch/rhythm, timbre Tier-B`,
    known_failure_modes: [],
  } as CookbookEntry;
}

/** Per-channel note presence + pitch stats — drives role inference. */
export function channelStats(m: XmModule, ch: number) {
  let notes = 0, sum = 0, lo = 999, hi = 0, rows = 0;
  for (const pi of m.order) {
    const pat = m.patterns[pi];
    if (!pat) continue;
    for (const row of pat) {
      rows++;
      const n = row[ch]?.note ?? 0;
      if (n > 0 && n < 97) { notes++; sum += n; lo = Math.min(lo, n); hi = Math.max(hi, n); }
    }
  }
  return { ch, notes, density: rows ? notes / rows : 0, meanNote: notes ? sum / notes : 0, lo, hi };
}

/**
 * One bar (default 16 rows = 4 beats) of a channel as Strudel
 * mini-notation. A held note stays until the next note/key-off;
 * trailing rests collapse into the previous note's `@` weight so the
 * grid reads like the corpus, not 16 lonely tokens.
 */
export function channelBarMiniNotation(
  m: XmModule, ch: number, patternIdx: number, startRow = 0, barRows = 16,
): string {
  const pat = m.patterns[patternIdx];
  if (!pat) return '~';
  const toks: string[] = [];
  for (let i = 0; i < barRows; i++) {
    const cell = pat[startRow + i]?.[ch];
    const nm = cell ? xmNoteToStrudel(cell.note) : '';
    if (nm) toks.push(nm);
    else if (cell?.note === 97) toks.push('~');     // key-off → rest
    else toks.push(toks.length ? '_' : '~');         // sustain prev / leading rest
  }
  // Collapse: "c4 _ _ ~" → "c4@3 ~". `_` extends the previous token.
  const out: string[] = [];
  for (const t of toks) {
    if (t === '_' && out.length) {
      const last = out[out.length - 1]!;
      const m2 = last.match(/^(.*?)(?:@(\d+))?$/);
      const base = m2![1]!;
      const w = m2![2] ? parseInt(m2![2], 10) : 1;
      out[out.length - 1] = `${base}@${w + 1}`;
    } else {
      out.push(t === '_' ? '~' : t);
    }
  }
  return out.join(' ');
}
