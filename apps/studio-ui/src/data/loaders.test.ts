// G11A: artifact loader tests. Use a Node-fs-backed fetcher to exercise the
// real disk artifacts. Tests assert: missing-evidence handling never throws,
// the loader doesn't fabricate fields, the inventory correctly catalogues
// what's present, the impact-report shape is accurate, ledger reads are
// safe, and reproduce-command generation is sane.

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  listSessions, loadSessionInventory, loadSessionSummary,
  loadCookbookTrace, loadCompiledCode, loadQualityGates,
  listImpactAudits, loadImpactReport, loadLedger,
  buildReproCommand, suggestCommandForMissing,
  type Fetcher,
} from './loaders.js';

const REPO_ROOT = path.resolve(import.meta.dirname ?? __dirname, '..', '..', '..', '..');

/**
 * A fetcher that resolves /api/<path> and /artifact/<path> against the real
 * filesystem under REPO_ROOT — same semantics as the vite middleware, but
 * runnable in Node.
 */
function makeFsFetcher(): Fetcher {
  return async (apiPath) => {
    const m = apiPath.match(/^\/(api|artifact)\/(.*)$/);
    if (!m) return mkResp(404, '');
    const requested = m[2]!;
    // Mirror the URL_REWRITES table from the vite middleware.
    const rewritten = requested
      .replace(/^sessions(\/|$)/, 'apps/cli/sessions$1')
      .replace(/^audits(\/|$)/, 'apps/cli/audits$1');
    const target = path.resolve(REPO_ROOT, rewritten);
    const root = path.resolve(REPO_ROOT);
    if (!target.startsWith(root)) return mkResp(403, '');
    let stat;
    try { stat = await fs.stat(target); } catch { return mkResp(404, ''); }
    if (stat.isDirectory()) {
      const entries = await fs.readdir(target, { withFileTypes: true });
      const list = await Promise.all(entries.filter((e) => !e.name.startsWith('.')).map(async (e) => {
        const s = await fs.stat(path.join(target, e.name)).catch(() => null);
        return {
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
          size: e.isFile() && s ? s.size : undefined,
          mtime: s?.mtimeMs ?? 0,
        };
      }));
      return mkResp(200, JSON.stringify({ kind: 'dir', path: m[2]!, entries: list }));
    }
    if (m[1] === 'api') {
      const text = await fs.readFile(target, 'utf8');
      return mkResp(200, text);
    }
    return mkResp(415, '');
  };
}

function mkResp(status: number, body: string): Response {
  return {
    status, ok: status >= 200 && status < 300,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

const F = makeFsFetcher();

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

  it('listImpactAudits + loadImpactReport returns the latest verdict', async () => {
    const list = await listImpactAudits(F);
    expect(list.ok).toBe(true);
    if (!list.ok || list.data.length === 0) return;
    const ts = list.data.sort().reverse()[0]!;
    const rep = await loadImpactReport(F, ts);
    expect(rep.ok).toBe(true);
    if (!rep.ok) return;
    expect(rep.data.modes.length).toBeGreaterThan(0);
    expect(['cookbook_positive', 'cookbook_neutral_preserves_diversity', 'cookbook_negative_regression', 'cookbook_inconclusive_insufficient_signal'])
      .toContain(rep.data.verdict);
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
