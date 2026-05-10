// G11A §3: per-gate breakdown. Operators must see exactly which gate fired
// at which severity tier. No collapsed score.

import { h, render, pill, fmt, missingEvidence } from '../dom.js';
import { loadQualityGates, suggestCommandForMissing, browserFetcher } from '../data/loaders.js';
import type { QualityGateResult } from '../data/types.js';

export async function renderQualityGates(host: HTMLElement, sessionId: string): Promise<void> {
  render(host, h('div', { class: 'panel muted' }, h('h2', {}, 'Loading gates...')));
  const r = await loadQualityGates(browserFetcher, sessionId, 0);
  if (!r.ok) {
    render(host, h('div', { class: 'panel' },
      missingEvidence(`no quality-gates.json for session ${sessionId.slice(0, 8)}`, suggestCommandForMissing('iter_0000.quality-gates.json')),
    ));
    return;
  }
  const report = r.data;
  // Sort: hard_fail first, then severe_warning, then calibration, then ok.
  const order: Record<string, number> = {
    hard_fail: 0, severe_warning: 1, calibration_warning: 2, informational: 3, skipped: 4,
  };
  const sorted = [...report.gates].sort((a, b) => {
    const aT = a.severity_tier ?? (a.passed ? 'informational' : 'severe_warning');
    const bT = b.severity_tier ?? (b.passed ? 'informational' : 'severe_warning');
    if (order[aT] !== order[bT]) return (order[aT] ?? 5) - (order[bT] ?? 5);
    return b.severity - a.severity;
  });

  render(host,
    h('div', { class: 'panel' },
      h('h2', {}, h('span', { class: 'accent' }, 'Quality gates'), ` — iter 0000`),
      h('div', { class: 'metric-strip' },
        h('div', { class: 'metric' },
          h('div', { class: 'lbl' }, 'overall'),
          h('div', { class: 'val' }, report.overall_pass ? pill('PASS', 'ok') : pill('FAIL', 'fail')),
        ),
        h('div', { class: 'metric' },
          h('div', { class: 'lbl' }, 'hard_fail'),
          h('div', { class: 'val' }, String(report.hard_fail_count ?? 0)),
        ),
        h('div', { class: 'metric' },
          h('div', { class: 'lbl' }, 'severe_warn'),
          h('div', { class: 'val' }, String(report.severe_warning_count ?? 0)),
        ),
        h('div', { class: 'metric' },
          h('div', { class: 'lbl' }, 'calibration'),
          h('div', { class: 'val' }, String(report.calibration_warning_count ?? 0)),
        ),
        h('div', { class: 'metric' },
          h('div', { class: 'lbl' }, 'skipped'),
          h('div', { class: 'val' }, String(report.skipped_count ?? 0)),
        ),
      ),
    ),
    h('div', { class: 'panel' },
      h('h2', {}, 'Per-gate breakdown'),
      h('table', { class: 'dense' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'gate'),
          h('th', {}, 'tier'),
          h('th', {}, 'status'),
          h('th', { class: 'num' }, 'measured'),
          h('th', { class: 'num' }, 'threshold'),
          h('th', { class: 'num' }, 'severity'),
          h('th', {}, 'confidence'),
          h('th', {}, 'notes'),
        )),
        h('tbody', {}, ...sorted.map(renderGateRow)),
      ),
    ),
  );
}

function renderGateRow(g: QualityGateResult): HTMLElement {
  const tier = g.severity_tier ?? (g.passed ? 'informational' : 'severe_warning');
  const tierKind: Record<string, 'ok' | 'warn' | 'fail' | 'skip' | 'info'> = {
    hard_fail: 'fail',
    severe_warning: 'warn',
    calibration_warning: 'warn',
    informational: 'info',
    skipped: 'skip',
  };
  const statusPill = g.passed ? pill('PASS', 'ok') : pill('FAIL', tierKind[tier] ?? 'fail');
  return h('tr', {},
    h('td', {}, g.name),
    h('td', {}, pill(tier, tierKind[tier] ?? 'muted')),
    h('td', {}, statusPill),
    h('td', { class: 'num' }, fmt(g.value, 3)),
    h('td', { class: 'num' }, fmt(g.threshold, 3)),
    h('td', { class: 'num' }, severityBar(g.severity)),
    h('td', {}, g.confidence ?? '—'),
    h('td', { class: 'meta' }, g.notes ?? ''),
  );
}

function severityBar(sev: number): HTMLElement {
  const pct = Math.max(0, Math.min(1, sev)) * 100;
  const kind = pct > 70 ? 'fail' : pct > 30 ? 'warn' : 'ok';
  return h('span', {},
    h('span', { style: 'min-width: 36px; display: inline-block' }, fmt(sev, 2)),
    h('span', { class: `bar ${kind}` }, h('i', { style: `width: ${pct}%` })),
  );
}
