// G11A: session list — the entry screen. Lists every session under
// /api/sessions, with brief + cookbook mode + artifact summary.

import { h, render, pill } from '../dom.js';
import { listSessions, loadSessionSummary, browserFetcher } from '../data/loaders.js';
import type { SessionSummary } from '../data/types.js';

export async function renderSessionsList(host: HTMLElement, onPick: (id: string) => void): Promise<void> {
  render(host, h('div', { class: 'panel' },
    h('h2', {}, 'Loading sessions...'),
  ));
  const list = await listSessions(browserFetcher);
  if (!list.ok) {
    render(host, h('div', { class: 'missing-evidence' }, 'cannot list sessions; the artifact API is not responding.'));
    return;
  }
  const summaries: SessionSummary[] = [];
  for (const id of list.data.slice(0, 50)) {
    const s = await loadSessionSummary(browserFetcher, id);
    if (s.ok) summaries.push(s.data);
  }
  // Newest first.
  summaries.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

  const rows = summaries.map((s) => h('tr', {
    onclick: (() => onPick(s.session_id)) as EventListener,
    style: 'cursor: pointer',
  },
    h('td', {}, s.session_id.slice(0, 8)),
    h('td', {}, s.brief ?? '—'),
    h('td', {}, s.primary_genre ?? '—'),
    h('td', { class: 'num' }, s.bpm != null ? String(s.bpm) : '—'),
    h('td', { class: 'num' }, s.total_bars != null ? String(s.total_bars) : '—'),
    h('td', {}, modePill(s.cookbook_mode)),
    h('td', {}, artifactSummary(s)),
    h('td', { class: 'meta' }, s.created_at?.slice(0, 19).replace('T', ' ') ?? '—'),
  ));

  render(host,
    h('div', { class: 'panel' },
      h('h2', {}, h('span', { class: 'accent' }, 'Sessions'), ` — ${summaries.length}`),
      h('table', { class: 'dense' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'id'), h('th', {}, 'brief'), h('th', {}, 'genre'),
          h('th', { class: 'num' }, 'bpm'), h('th', { class: 'num' }, 'bars'),
          h('th', {}, 'mode'), h('th', {}, 'artifacts'),
          h('th', {}, 'created'),
        )),
        h('tbody', {}, ...rows),
      ),
    ),
  );
}

function modePill(mode: SessionSummary['cookbook_mode']): HTMLElement {
  if (mode === 'enabled' || mode === 'enabled_mutating') return pill(mode, 'ok');
  if (mode === 'minimal') return pill(mode, 'muted');
  if (mode === 'hybrid') return pill(mode, 'info');
  return pill('unknown', 'muted');
}

function artifactSummary(s: SessionSummary): HTMLElement {
  const inv = s.inventory;
  const parts: HTMLElement[] = [];
  parts.push(pill(inv.has.graph ? 'graph' : '·', inv.has.graph ? 'ok' : 'muted'));
  parts.push(pill(inv.has.code ? 'code' : '·', inv.has.code ? 'ok' : 'muted'));
  parts.push(pill(inv.has.cookbook_trace ? 'trace' : '·', inv.has.cookbook_trace ? 'ok' : 'muted'));
  parts.push(pill(inv.has.wav.length > 0 ? `wav×${inv.has.wav.length}` : 'no-wav', inv.has.wav.length > 0 ? 'ok' : 'muted'));
  parts.push(pill(inv.has.quality_gates.length > 0 ? `gates×${inv.has.quality_gates.length}` : 'no-gates', inv.has.quality_gates.length > 0 ? 'ok' : 'muted'));
  return h('span', { style: 'display:inline-flex; gap:4px; flex-wrap:wrap' }, ...parts);
}
