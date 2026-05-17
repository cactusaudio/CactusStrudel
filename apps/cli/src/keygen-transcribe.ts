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
