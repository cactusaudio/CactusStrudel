// G11A: artifact loaders. Fetcher-injectable so tests can run them in Node.
// "Missing evidence" is a first-class result; we never invent fields.

import type {
  SessionSummary, SessionArtifactInventory, CookbookMode,
  QualityGatesReport, CookbookTrace, ImpactReport, LedgerSummary, Evidence,
} from './types.js';

export type Fetcher = (apiPath: string) => Promise<Response>;

/** Default fetcher: relative URL → window.fetch. */
export const browserFetcher: Fetcher = (p) => fetch(p);

interface DirEntry { name: string; type: 'dir' | 'file'; size?: number; mtime: number }
interface DirListing { kind: 'dir'; path: string; entries: DirEntry[] }

async function getJson<T>(fetcher: Fetcher, apiPath: string): Promise<Evidence<T>> {
  const res = await fetcher(apiPath);
  if (res.status === 404) {
    return { ok: false, reason: 'missing', missing_path: apiPath, suggested_command: '' };
  }
  if (!res.ok) {
    return { ok: false, reason: 'parse_error', message: `HTTP ${res.status} for ${apiPath}` };
  }
  const text = await res.text();
  try { return { ok: true, data: JSON.parse(text) as T }; }
  catch (e) {
    return { ok: false, reason: 'parse_error', message: e instanceof Error ? e.message : String(e) };
  }
}

async function getText(fetcher: Fetcher, apiPath: string): Promise<Evidence<string>> {
  const res = await fetcher(apiPath);
  if (res.status === 404) return { ok: false, reason: 'missing', missing_path: apiPath, suggested_command: '' };
  if (!res.ok) return { ok: false, reason: 'parse_error', message: `HTTP ${res.status}` };
  return { ok: true, data: await res.text() };
}

/** Catalogue a session dir's artifacts. */
export async function loadSessionInventory(fetcher: Fetcher, sessionId: string): Promise<Evidence<SessionArtifactInventory>> {
  const dir = await getJson<DirListing>(fetcher, `/api/sessions/${sessionId}`);
  if (!dir.ok) return dir;
  const files = dir.data.entries.filter((e) => e.type === 'file').map((e) => e.name);
  const has = {
    graph: files.includes('iter_0000.json'),
    code: files.includes('iter_0000.strudel.js'),
    cookbook_trace: files.includes('cookbook-trace.json'),
    report: files.some((n) => n.endsWith('.report.md') || n === 'produce-report.md'),
    wav: indicesFor(files, '.wav'),
    features: indicesFor(files, '.features.json'),
    quality_gates: indicesFor(files, '.quality-gates.json'),
    critique: indicesFor(files, '.critique.json'),
    failure_taxonomy: indicesFor(files, '.failure-taxonomy.json'),
    revision_plan: indicesFor(files, '.revision-plan.json'),
    locality: indicesFor(files, '.locality.json'),
    spectrogram: indicesFor(files, '.spectrogram.png'),
  };
  const iters = Array.from(new Set(
    files.flatMap((n) => {
      const m = n.match(/^iter_(\d{4})\b/);
      return m ? [parseInt(m[1]!, 10)] : [];
    }),
  )).sort((a, b) => a - b);
  return { ok: true, data: { iterations: iters, has } };
}

function indicesFor(files: string[], suffix: string): number[] {
  const out: number[] = [];
  for (const f of files) {
    const m = f.match(/^iter_(\d{4})\b/);
    if (m && f.endsWith(suffix)) out.push(parseInt(m[1]!, 10));
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

interface SessionGraph {
  brief?: { text?: string; primary_genre?: string; bpm?: number };
  song?: { total_bars?: number };
  schema_version?: string;
  created_at?: string;
  session_id?: string;
}

export async function loadSessionSummary(fetcher: Fetcher, sessionId: string): Promise<Evidence<SessionSummary>> {
  const inv = await loadSessionInventory(fetcher, sessionId);
  if (!inv.ok) return inv;
  const graph = await getJson<SessionGraph>(fetcher, `/api/sessions/${sessionId}/iter_0000.json`);
  const trace = await getJson<CookbookTrace>(fetcher, `/api/sessions/${sessionId}/cookbook-trace.json`);
  const summary: SessionSummary = {
    session_id: sessionId,
    inventory: inv.data,
    cookbook_mode: 'unknown',
  };
  if (graph.ok) {
    summary.brief = graph.data.brief?.text;
    summary.primary_genre = graph.data.brief?.primary_genre;
    summary.bpm = graph.data.brief?.bpm;
    summary.total_bars = graph.data.song?.total_bars;
    summary.schema_version = graph.data.schema_version;
    summary.created_at = graph.data.created_at;
  }
  if (trace.ok) summary.cookbook_mode = trace.data.mode;
  return { ok: true, data: summary };
}

export async function listSessions(fetcher: Fetcher): Promise<Evidence<string[]>> {
  const dir = await getJson<DirListing>(fetcher, '/api/sessions');
  if (!dir.ok) return dir;
  const ids = dir.data.entries
    .filter((e) => e.type === 'dir' && /^[0-9a-f-]{36}$/.test(e.name))
    .map((e) => e.name);
  return { ok: true, data: ids };
}

export async function loadCookbookTrace(fetcher: Fetcher, sessionId: string): Promise<Evidence<CookbookTrace>> {
  return getJson<CookbookTrace>(fetcher, `/api/sessions/${sessionId}/cookbook-trace.json`);
}

export async function loadCompiledCode(fetcher: Fetcher, sessionId: string, iter = 0): Promise<Evidence<string>> {
  return getText(fetcher, `/api/sessions/${sessionId}/iter_${String(iter).padStart(4, '0')}.strudel.js`);
}

export async function loadQualityGates(fetcher: Fetcher, sessionId: string, iter = 0): Promise<Evidence<QualityGatesReport>> {
  return getJson<QualityGatesReport>(fetcher, `/api/sessions/${sessionId}/iter_${String(iter).padStart(4, '0')}.quality-gates.json`);
}

export async function listImpactAudits(fetcher: Fetcher): Promise<Evidence<string[]>> {
  const dir = await getJson<DirListing>(fetcher, '/api/audits/cookbook-impact-real');
  if (!dir.ok) return dir;
  return {
    ok: true,
    data: dir.data.entries.filter((e) => e.type === 'dir').map((e) => e.name),
  };
}

export async function loadImpactReport(fetcher: Fetcher, ts: string): Promise<Evidence<ImpactReport>> {
  return getJson<ImpactReport>(fetcher, `/api/audits/cookbook-impact-real/${ts}/cookbook-impact-real-report.json`);
}

export async function loadLedger(fetcher: Fetcher): Promise<Evidence<LedgerSummary>> {
  const subs: Array<keyof LedgerSummary> = ['promoted', 'candidates', 'rejected', 'regressions'];
  const dirNames: Record<keyof LedgerSummary, string> = {
    promoted: 'promoted_priors',
    candidates: 'candidate_priors',
    rejected: 'rejected_priors',
    regressions: 'regressions',
  };
  const out: LedgerSummary = { promoted: [], candidates: [], rejected: [], regressions: [] };
  for (const sub of subs) {
    const dir = await getJson<DirListing>(fetcher, `/api/learning_ledger/cookbook/${dirNames[sub]}`);
    if (dir.ok) {
      out[sub] = dir.data.entries
        .filter((e) => e.type === 'file' && e.name.endsWith('.md') && e.name !== 'README.md')
        .map((e) => e.name);
    }
  }
  return { ok: true, data: out };
}

export async function loadLedgerEntry(fetcher: Fetcher, kind: 'promoted_priors' | 'candidate_priors' | 'rejected_priors' | 'regressions', filename: string): Promise<Evidence<string>> {
  return getText(fetcher, `/api/learning_ledger/cookbook/${kind}/${filename}`);
}

/**
 * G11A §11: build the exact reproduce command for a given session. UI shows
 * this in the command-runner panel so the operator can repro from a clean
 * shell.
 */
export function buildReproCommand(summary: SessionSummary): string {
  const parts = ['pnpm cactus produce'];
  if (summary.brief) parts.push(`-b '${summary.brief.replace(/'/g, "'\\''")}'`);
  parts.push('--no-render');
  return parts.join(' ');
}

/**
 * For a missing-evidence case, suggest the command that would generate it.
 */
export function suggestCommandForMissing(missingPath: string): string {
  if (/quality-gates\.json$/.test(missingPath)) return 'pnpm cactus audit:repair';
  if (/features\.json$/.test(missingPath)) return 'pnpm cactus produce -b ... (without --no-render)';
  if (/cookbook-trace\.json$/.test(missingPath)) return 'CACTUS_COOKBOOK_MODE=enabled pnpm cactus produce -b ...';
  if (/critique\.json$/.test(missingPath)) return 'pnpm cactus produce -b ... (closed-loop mode)';
  if (/spectrogram\.png$/.test(missingPath)) return 'pnpm cactus produce -b ... (closed-loop emits spectrogram)';
  if (/impact-real-report\.json$/.test(missingPath)) return 'pnpm cactus audit:cookbook-impact --suite smoke-real --seeds 1';
  return '(no specific command — check the artifact path)';
}
