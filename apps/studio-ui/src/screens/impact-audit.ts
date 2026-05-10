// G11A §6 (subset): cookbook-impact A/B view. Lists every smoke-real run,
// renders per-brief / per-mode metrics with deltas. The champion baseline
// (minimal) is the comparison anchor.

import { h, render, pill, fmt, missingEvidence } from '../dom.js';
import { listImpactAudits, loadImpactReport, suggestCommandForMissing, browserFetcher } from '../data/loaders.js';
import type { ImpactReportRow, ImpactReport } from '../data/types.js';

export async function renderImpactAudits(host: HTMLElement): Promise<void> {
  render(host, h('div', { class: 'panel muted' }, h('h2', {}, 'Loading impact audits...')));
  const list = await listImpactAudits(browserFetcher);
  if (!list.ok || list.data.length === 0) {
    render(host, h('div', { class: 'panel' },
      missingEvidence('no smoke-real impact audits captured',
        suggestCommandForMissing('cookbook-impact-real-report.json')),
    ));
    return;
  }
  const tsList = list.data.sort().reverse(); // newest first
  // Load each report eagerly — they're small.
  const reports: Array<{ ts: string; report: ImpactReport }> = [];
  for (const ts of tsList) {
    const r = await loadImpactReport(browserFetcher, ts);
    if (r.ok) reports.push({ ts, report: r.data });
  }

  if (reports.length === 0) {
    render(host, h('div', { class: 'panel' },
      missingEvidence('no readable impact audit reports', '(check audit output dir)'),
    ));
    return;
  }

  // Show the latest report by default; older runs in a sidebar table.
  const latest = reports[0]!;
  render(host,
    h('div', { class: 'panel' },
      h('h2', {}, h('span', { class: 'accent' }, 'Cookbook-impact (smoke-real)'), ` — ${latest.report.suite}`),
      h('div', { class: 'metric-strip' },
        h('div', { class: 'metric' },
          h('div', { class: 'lbl' }, 'verdict'),
          h('div', { class: 'val' }, verdictPill(latest.report.verdict)),
        ),
        h('div', { class: 'metric' },
          h('div', { class: 'lbl' }, 'modes'),
          h('div', { class: 'val' }, latest.report.modes.join(' vs ')),
        ),
        h('div', { class: 'metric' },
          h('div', { class: 'lbl' }, 'briefs'),
          h('div', { class: 'val' }, String(latest.report.per_brief.length)),
        ),
        h('div', { class: 'metric' },
          h('div', { class: 'lbl' }, 'ts'),
          h('div', { class: 'val' }, latest.ts.replace(/-/g, ':').slice(0, 19)),
        ),
      ),
      h('ul', { style: 'list-style: none; padding-left: 0; margin: 8px 0; font-size: 11px; color: var(--muted)' },
        ...latest.report.notes.map((n) => h('li', {}, '· ', n)),
      ),
    ),

    ...latest.report.per_brief.map(renderBriefBlock),

    h('div', { class: 'panel' },
      h('h2', {}, `Run history — ${reports.length}`),
      h('table', { class: 'dense' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'ts'), h('th', {}, 'suite'), h('th', {}, 'verdict'),
          h('th', { class: 'num' }, 'briefs'), h('th', { class: 'num' }, 'modes'),
        )),
        h('tbody', {}, ...reports.map((r) => h('tr', {},
          h('td', { class: 'meta' }, r.ts.replace(/-/g, ':').slice(0, 19)),
          h('td', {}, r.report.suite),
          h('td', {}, verdictPill(r.report.verdict)),
          h('td', { class: 'num' }, String(r.report.per_brief.length)),
          h('td', { class: 'num' }, String(r.report.modes.length)),
        ))),
      ),
    ),
  );
}

function renderBriefBlock(b: ImpactReport['per_brief'][number]): HTMLElement {
  const minimal = b.rows.find((r) => r.mode === 'minimal');
  return h('div', { class: 'panel' },
    h('h2', {}, `${b.genre ?? '—'} — `, h('span', { style: 'color: var(--muted); font-weight: 400' }, b.brief)),
    h('table', { class: 'dense' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'mode'),
        h('th', {}, 'gate'),
        h('th', { class: 'num' }, 'hard fails'),
        h('th', { class: 'num' }, 'severe warns'),
        h('th', { class: 'num' }, 'lufs Δ'),
        h('th', { class: 'num' }, 'true peak'),
        h('th', { class: 'num' }, 'non-silent'),
        h('th', { class: 'num' }, 'critic'),
        h('th', { class: 'num' }, 'overlap vs min'),
      )),
      h('tbody', {}, ...b.rows.map((r) => renderRow(r, minimal))),
    ),
  );
}

function renderRow(r: ImpactReportRow, baseline: ImpactReportRow | undefined): HTMLElement {
  return h('tr', {},
    h('td', {}, modePill(r.mode)),
    h('td', {}, r.gate_pass ? pill('PASS', 'ok') : pill('FAIL', 'fail')),
    h('td', { class: 'num' }, deltaCell(r.hard_fail_count, baseline?.hard_fail_count, false)),
    h('td', { class: 'num' }, deltaCell(r.severe_warning_count, baseline?.severe_warning_count, false)),
    h('td', { class: 'num' }, deltaCell(r.lufs_distance ?? null, baseline?.lufs_distance ?? null, false)),
    h('td', { class: 'num' }, fmt(r.true_peak_db, 2)),
    h('td', { class: 'num' }, deltaCell(r.non_silent_ratio, baseline?.non_silent_ratio, true)),
    h('td', { class: 'num' }, deltaCell(r.critic_issue_count, baseline?.critic_issue_count, false)),
    h('td', { class: 'num' }, fmt(r.mini_notation_token_overlap_vs_minimal, 3)),
  );
}

function deltaCell(value: number | null | undefined, baseline: number | null | undefined, higherIsBetter: boolean): HTMLElement {
  const v = value == null ? null : value;
  const cell = h('span', {}, fmt(v, 3));
  if (baseline == null || v == null) return cell;
  const d = v - baseline;
  if (Math.abs(d) < 1e-6) return h('span', {}, fmt(v, 3), ' ', h('span', { class: 'delta-flat meta' }, '(=)'));
  const better = higherIsBetter ? d > 0 : d < 0;
  const cls = better ? 'delta-up' : 'delta-down';
  const arrow = d > 0 ? '↑' : '↓';
  return h('span', {}, fmt(v, 3), ' ', h('span', { class: `${cls} meta` }, `(${arrow} ${fmt(Math.abs(d), 3)})`));
}

function modePill(mode: string): HTMLElement {
  if (mode === 'enabled' || mode === 'enabled_mutating') return pill(mode, 'ok');
  if (mode === 'minimal') return pill(mode, 'muted');
  return pill(mode, 'info');
}

function verdictPill(v: string): HTMLElement {
  if (v.includes('positive') || v === 'cookbook_improves_quality') return pill(v, 'ok');
  if (v.includes('regression') || v.includes('regresses')) return pill(v, 'fail');
  if (v.includes('inconclusive')) return pill(v, 'warn');
  return pill(v, 'muted');
}
