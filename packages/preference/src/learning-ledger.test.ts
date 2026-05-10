// G7: learning ledger append-only contract.

import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  appendLedgerEntry, readLedger, buildLedgerEntryFromClosedLoop,
  type LedgerEntry,
} from './learning-ledger.js';

const TMP = path.join(os.tmpdir(), 'cactus-ledger-tests');

beforeEach(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
  await fs.mkdir(TMP, { recursive: true });
});

const baseEntry: LedgerEntry = {
  ts: '2026-05-10T12:00:00.000Z',
  session_id: '00000000-0000-4000-8000-000000000001',
  mode: 'produce-closed-loop',
  brief: 'peak time techno 130 BPM',
  iterations: 3,
  stopped_reason: 'accepted',
  hard_fail_count: 0,
  severe_warning_count: 1,
  patches_applied: 4,
  failed_patch_iters: [],
  weighted_score_first: 0.42,
  weighted_score_last: 0.71,
  spectrogram_path: '/tmp/spec.png',
};

describe('learning ledger (G7)', () => {
  it('appendLedgerEntry creates the file and writes one JSON line', async () => {
    const ledgerPath = path.join(TMP, 'led.jsonl');
    await appendLedgerEntry(baseEntry, { ledgerPath });
    const raw = await fs.readFile(ledgerPath, 'utf8');
    expect(raw.split('\n').filter(Boolean).length).toBe(1);
    const parsed = JSON.parse(raw.trim());
    expect(parsed.session_id).toBe(baseEntry.session_id);
  });

  it('multiple appends preserve order (newest last) and never overwrite', async () => {
    const ledgerPath = path.join(TMP, 'multi.jsonl');
    await appendLedgerEntry(baseEntry, { ledgerPath });
    await appendLedgerEntry({ ...baseEntry, session_id: '00000000-0000-4000-8000-000000000002', stopped_reason: 'plateau' }, { ledgerPath });
    await appendLedgerEntry({ ...baseEntry, session_id: '00000000-0000-4000-8000-000000000003', stopped_reason: 'failure', hard_fail_count: 2 }, { ledgerPath });
    const all = await readLedger({ ledgerPath });
    expect(all.length).toBe(3);
    expect(all[0]!.session_id.endsWith('000001')).toBe(true);
    expect(all[1]!.stopped_reason).toBe('plateau');
    expect(all[2]!.hard_fail_count).toBe(2);
  });

  it('readLedger returns [] when file does not exist', async () => {
    const out = await readLedger({ ledgerPath: path.join(TMP, 'never-existed.jsonl') });
    expect(out).toEqual([]);
  });

  it('readLedger skips malformed lines without throwing', async () => {
    const ledgerPath = path.join(TMP, 'mixed.jsonl');
    await fs.writeFile(ledgerPath, JSON.stringify(baseEntry) + '\n' + 'this is not json\n' + JSON.stringify({ ...baseEntry, session_id: '00000000-0000-4000-8000-000000000099' }) + '\n');
    const out = await readLedger({ ledgerPath });
    expect(out.length).toBe(2); // valid lines only
  });

  it('buildLedgerEntryFromClosedLoop summarizes iteration log correctly', () => {
    const entry = buildLedgerEntryFromClosedLoop({
      sessionId: 'abc-123',
      brief: 'test brief',
      stoppedReason: 'plateau',
      iterations: 3,
      hardFailures: ['x failed'],
      iterationLog: [
        { iter: 0, appliedOps: 0, qualityPass: false, weighted: 0.3, classification: { categories: ['silence'] } },
        { iter: 1, appliedOps: 2, qualityPass: false, weighted: 0.45, classification: { categories: [] } },
        { iter: 2, appliedOps: 3, qualityPass: true, weighted: 0.6, classification: { categories: [] } },
      ],
      failedPatchIters: [1],
    });
    expect(entry.session_id).toBe('abc-123');
    expect(entry.iterations).toBe(3);
    expect(entry.stopped_reason).toBe('plateau');
    expect(entry.hard_fail_count).toBe(1);
    expect(entry.severe_warning_count).toBe(2); // 2 iters with qualityPass=false
    expect(entry.patches_applied).toBe(5);
    expect(entry.weighted_score_first).toBe(0.3);
    expect(entry.weighted_score_last).toBe(0.6);
    expect(entry.failed_patch_iters).toEqual([1]);
  });

  it('correction entry can reference an earlier session via corrects_session_id', async () => {
    const ledgerPath = path.join(TMP, 'corr.jsonl');
    await appendLedgerEntry(baseEntry, { ledgerPath });
    await appendLedgerEntry({
      ...baseEntry,
      session_id: '00000000-0000-4000-8000-0000000000ff',
      corrects_session_id: baseEntry.session_id,
      notes: 'previous entry overstated patches_applied; correct value is 2',
      patches_applied: 2,
    }, { ledgerPath });
    const all = await readLedger({ ledgerPath });
    expect(all.length).toBe(2);
    expect(all[1]!.corrects_session_id).toBe(baseEntry.session_id);
  });
});
