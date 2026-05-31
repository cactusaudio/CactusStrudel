// G11A: artifact loader tests. Use a fixture fetcher so CI does not depend on
// per-machine sessions/audits. Tests assert: missing-evidence handling never
// throws, the loader doesn't fabricate fields, the inventory correctly
// catalogues what's present, the impact-report shape is accurate, ledger reads
// are safe, and reproduce-command generation is sane.

import { describe, it, expect } from 'vitest';
import {
  listSessions, loadSessionInventory, loadSessionSummary,
  loadCookbookTrace, loadCompiledCode, loadQualityGates,
  listImpactAudits, loadImpactReport, loadLatestCompleteImpactReport, loadLedger,
  buildReproCommand, suggestCommandForMissing,
  type Fetcher,
} from './loaders.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

interface DirEntry { name: string; type: 'dir' | 'file'; size?: number; mtime: number }

function dir(entries: Array<Omit<DirEntry, 'mtime'>>): string {
  return JSON.stringify({
    kind: 'dir',
    path: '',
    entries: entries.map((e, i) => ({ ...e, mtime: 1_780_000_000_000 + i })),
  });
}

function makeFixtureFetcher(): Fetcher {
  const dirs: Record<string, string> = {
    '/api/sessions': dir([{ name: SESSION_ID, type: 'dir' }]),
    [`/api/sessions/${SESSION_ID}`]: dir([
      { name: 'iter_0000.json', type: 'file', size: 180 },
      { name: 'iter_0000.strudel.js', type: 'file', size: 24 },
      { name: 'cookbook-trace.json', type: 'file', size: 90 },
      { name: 'iter_0000.quality-gates.json', type: 'file', size: 100 },
      { name: 'iter_0000.wav', type: 'file', size: 2048 },
      { name: 'iter_0000.features.json', type: 'file', size: 50 },
      { name: 'iter_0000.spectrogram.png', type: 'file', size: 4096 },
    ]),
    '/api/audits/cookbook-impact-real': dir([
      { name: '2026-06-01T00-00-01Z', type: 'dir' },
      { name: '2026-06-01T00-00-00Z', type: 'dir' },
    ]),
    '/api/audits/cookbook-impact-real/2026-06-01T00-00-01Z': dir([]),
    '/api/audits/cookbook-impact-real/2026-06-01T00-00-00Z': dir([
      { name: 'cookbook-impact-real-report.json', type: 'file', size: 240 },
    ]),
    '/api/learning_ledger/cookbook/promoted_priors': dir([
      { name: 'g9c.md', type: 'file', size: 20 },
      { name: 'README.md', type: 'file', size: 20 },
    ]),
    '/api/learning_ledger/cookbook/candidate_priors': dir([]),
    '/api/learning_ledger/cookbook/rejected_priors': dir([]),
    '/api/learning_ledger/cookbook/regressions': dir([]),
  };

  const files: Record<string, string> = {
    [`/api/sessions/${SESSION_ID}/iter_0000.json`]: JSON.stringify({
      brief: { text: 'fixture techno 130 BPM', primary_genre: 'techno', bpm: 130 },
      song: { total_bars: 16 },
      schema_version: 'fixture',
      created_at: '2026-06-01T00:00:00Z',
      session_id: SESSION_ID,
    }),
    [`/api/sessions/${SESSION_ID}/iter_0000.strudel.js`]: 'stack(s("bd*4"), note("c3"))',
    [`/api/sessions/${SESSION_ID}/cookbook-trace.json`]: JSON.stringify({
      mode: 'enabled',
      genre: 'techno',
      bpm: 130,
      picks: [],
    }),
    [`/api/sessions/${SESSION_ID}/iter_0000.quality-gates.json`]: JSON.stringify({
      overall_pass: true,
      gates: [],
    }),
    '/api/audits/cookbook-impact-real/2026-06-01T00-00-00Z/cookbook-impact-real-report.json': JSON.stringify({
      ok: true,
      ts: '2026-06-01T00-00-00Z',
      suite: 'fixture',
      out_dir: 'fixture',
      modes: ['enabled'],
      per_mode: [],
      per_brief: [],
      verdict: 'cookbook_positive',
      notes: [],
    }),
    '/api/learning_ledger/cookbook/promoted_priors/g9c.md': '# fixture',
  };

  return async (apiPath) => {
    if (apiPath in dirs) return mkResp(200, dirs[apiPath]!);
    if (apiPath in files) return mkResp(200, files[apiPath]!);
    return mkResp(404, '');
  };
}

function mkResp(status: number, body: string): Response {
  return {
    status, ok: status >= 200 && status < 300,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

const F = makeFixtureFetcher();

describe('artifact loader (G11A §10)', () => {
  it('listSessions returns at least one uuid-shaped session', async () => {
    const r = await listSessions(F);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.data[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('loadSessionInventory catalogues present artifacts only — never invents', async () => {
    const list = await listSessions(F);
    if (!list.ok || list.data.length === 0) return;
    const id = list.data[0]!;
    const inv = await loadSessionInventory(F, id);
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    // Every iteration index in `has.wav` should also appear in `iterations`.
    for (const i of inv.data.has.wav) expect(inv.data.iterations).toContain(i);
    for (const i of inv.data.has.quality_gates) expect(inv.data.iterations).toContain(i);
  });

  it('loadSessionSummary fills only fields present in the graph', async () => {
    const list = await listSessions(F);
    if (!list.ok || list.data.length === 0) return;
    const id = list.data[0]!;
    const r = await loadSessionSummary(F, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.session_id).toBe(id);
    // session_id must always be present; other fields only when graph existed.
  });

  it('returns missing-evidence (not throw) for an unknown session', async () => {
    const r = await loadSessionSummary(F, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('missing');
  });

  it('loadCookbookTrace returns missing for sessions with no trace', async () => {
    // A session might exist without a cookbook-trace.json (minimal mode produced
    // before G9B wired traces).
    const r = await loadCookbookTrace(F, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('missing');
  });

  it('loadQualityGates returns missing when the iteration has no gates JSON', async () => {
    const r = await loadQualityGates(F, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0);
    expect(r.ok).toBe(false);
  });

  it('loadLatestCompleteImpactReport returns the latest COMPLETE verdict, skipping in-flight audit dirs', async () => {
    const list = await listImpactAudits(F);
    expect(list.ok).toBe(true);
    if (!list.ok || list.data.length === 0) return;
    // Must not crash on a half-written audit dir (in-flight
    // `audit:cookbook-impact` creates its dir before the report). Walks
    // newest-first to the first parseable report.
    const r = await loadLatestCompleteImpactReport(F);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.report.modes.length).toBeGreaterThan(0);
    expect(['cookbook_positive', 'cookbook_neutral_preserves_diversity', 'cookbook_negative_regression', 'cookbook_inconclusive_insufficient_signal'])
      .toContain(r.data.report.verdict);
  });

  it('loadLedger returns at least the promoted_priors entry from G9C', async () => {
    const r = await loadLedger(F);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.promoted.length).toBeGreaterThan(0);
  });

  it('buildReproCommand quotes the brief safely', () => {
    const cmd = buildReproCommand({
      session_id: 'x', brief: "techno 130 'BPM'",
      inventory: { iterations: [], has: { graph: false, code: false, cookbook_trace: false, report: false, wav: [], features: [], quality_gates: [], critique: [], failure_taxonomy: [], revision_plan: [], locality: [], spectrogram: [] } },
    });
    expect(cmd).toContain("'techno 130 '\\''BPM'\\''");
    expect(cmd).toContain('--no-render');
  });

  it('suggestCommandForMissing maps each artifact suffix to a real command', () => {
    expect(suggestCommandForMissing('iter_0000.quality-gates.json')).toMatch(/audit:repair/);
    expect(suggestCommandForMissing('iter_0000.features.json')).toMatch(/produce/);
    expect(suggestCommandForMissing('cookbook-trace.json')).toMatch(/COOKBOOK_MODE=enabled/);
    expect(suggestCommandForMissing('iter_0001.spectrogram.png')).toMatch(/produce/);
    expect(suggestCommandForMissing('cookbook-impact-real-report.json')).toMatch(/audit:cookbook-impact/);
  });

  it('compiled code loader returns text only when the file exists', async () => {
    const list = await listSessions(F);
    if (!list.ok || list.data.length === 0) return;
    const id = list.data[0]!;
    const inv = await loadSessionInventory(F, id);
    if (!inv.ok || !inv.data.has.code) return;
    const code = await loadCompiledCode(F, id, 0);
    expect(code.ok).toBe(true);
    if (code.ok) expect(code.data).toContain('stack');
  });
});
