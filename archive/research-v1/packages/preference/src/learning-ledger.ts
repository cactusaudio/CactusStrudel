// G7: append-only learning ledger. Records what each closed-loop / revise /
// audit session tried and what came out, so the next session can learn from
// the last instead of re-discovering the same plateaus.
//
// One JSON object per line in docs/learning-ledger.jsonl.
// Append-only; never rewritten. Corrections reference original session_id.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export type LedgerMode = 'produce-closed-loop' | 'revise' | 'audit' | 'sketch';

export interface LedgerEntry {
  ts: string;
  session_id: string;
  mode: LedgerMode;
  brief: string;
  iterations: number;
  stopped_reason:
    | 'accepted'
    | 'plateau'
    | 'max_iterations'
    | 'no_patches'
    | 'failure'
    | 'completed'
    | 'no-op';
  hard_fail_count: number;
  severe_warning_count: number;
  patches_applied: number;
  failed_patch_iters: number[];
  weighted_score_first: number | null;
  weighted_score_last: number | null;
  spectrogram_path: string | null;
  notes?: string;
  /** When this entry corrects a prior entry, set the original's session_id. */
  corrects_session_id?: string;
}

export const DEFAULT_LEDGER_PATH = 'docs/learning-ledger.jsonl';

export interface AppendLedgerOptions {
  /** Override for the ledger file path. Defaults to docs/learning-ledger.jsonl. */
  ledgerPath?: string;
  /** Repo root; used to resolve a relative ledgerPath. Defaults to process.cwd(). */
  rootDir?: string;
}

export async function appendLedgerEntry(
  entry: LedgerEntry,
  opts: AppendLedgerOptions = {},
): Promise<string> {
  const root = opts.rootDir ?? process.cwd();
  const ledgerPath = path.isAbsolute(opts.ledgerPath ?? DEFAULT_LEDGER_PATH)
    ? (opts.ledgerPath ?? DEFAULT_LEDGER_PATH)
    : path.join(root, opts.ledgerPath ?? DEFAULT_LEDGER_PATH);
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  const line = JSON.stringify(entry) + '\n';
  await fs.appendFile(ledgerPath, line, 'utf8');
  return ledgerPath;
}

/**
 * Read the ledger as an array (newest last). Useful for regression tests +
 * the future Cactus Governor "what did we already try" prompt.
 */
export async function readLedger(opts: AppendLedgerOptions = {}): Promise<LedgerEntry[]> {
  const root = opts.rootDir ?? process.cwd();
  const ledgerPath = path.isAbsolute(opts.ledgerPath ?? DEFAULT_LEDGER_PATH)
    ? (opts.ledgerPath ?? DEFAULT_LEDGER_PATH)
    : path.join(root, opts.ledgerPath ?? DEFAULT_LEDGER_PATH);
  let raw: string;
  try {
    raw = await fs.readFile(ledgerPath, 'utf8');
  } catch {
    return [];
  }
  const out: LedgerEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as LedgerEntry);
    } catch {
      /* skip malformed line — never throw from ledger reader */
    }
  }
  return out;
}

/**
 * Convenience: build an entry from a closed-loop result.
 */
export function buildLedgerEntryFromClosedLoop(input: {
  sessionId: string;
  brief: string;
  stoppedReason: string;
  iterations: number;
  hardFailures: string[];
  iterationLog: Array<{
    iter: number;
    appliedOps: number;
    qualityPass: boolean;
    weighted: number;
    classification: { categories: string[] };
  }>;
  failedPatchIters?: number[];
  spectrogramPath?: string;
  notes?: string;
}): LedgerEntry {
  const hardFails = input.hardFailures.length;
  const severeWarnings = input.iterationLog.reduce(
    (acc, it) => acc + (it.qualityPass ? 0 : 1),
    0,
  );
  const patchesApplied = input.iterationLog.reduce((acc, it) => acc + it.appliedOps, 0);
  const first = input.iterationLog[0]?.weighted ?? null;
  const last = input.iterationLog[input.iterationLog.length - 1]?.weighted ?? null;
  return {
    ts: new Date().toISOString(),
    session_id: input.sessionId,
    mode: 'produce-closed-loop',
    brief: input.brief,
    iterations: input.iterations,
    stopped_reason: (input.stoppedReason as LedgerEntry['stopped_reason']),
    hard_fail_count: hardFails,
    severe_warning_count: severeWarnings,
    patches_applied: patchesApplied,
    failed_patch_iters: input.failedPatchIters ?? [],
    weighted_score_first: first,
    weighted_score_last: last,
    spectrogram_path: input.spectrogramPath ?? null,
    ...(input.notes ? { notes: input.notes } : {}),
  };
}
