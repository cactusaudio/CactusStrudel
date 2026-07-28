// G11A §4: cookbook trace / blame. Per-pick: query terms, top candidates,
// selected entry, fallback reason, mutation, blame graph_path.

import { h, render, pill, missingEvidence } from '../dom.js';
import { loadCookbookTrace, suggestCommandForMissing, browserFetcher } from '../data/loaders.js';
import type { CookbookTracePick } from '../data/types.js';

export async function renderCookbookTrace(host: HTMLElement, sessionId: string): Promise<void> {
  render(host, h('div', { class: 'panel muted' }, h('h2', {}, 'Loading trace...')));
  const r = await loadCookbookTrace(browserFetcher, sessionId);
  if (!r.ok) {
    render(host, h('div', { class: 'panel' },
      missingEvidence(`no cookbook-trace.json for session ${sessionId.slice(0, 8)}`,
        suggestCommandForMissing('cookbook-trace.json')),
    ));
    return;
  }
  const trace = r.data;
  const baselineOnly = trace.baseline_only === true;
  const picksWithSelection = trace.picks.filter((p) => p.selected_id !== null).length;
  const picksWithFallback = trace.picks.filter((p) => p.fallback_reason).length;
  const picksWithMutation = trace.picks.filter((p) => p.mutation_applied).length;

  render(host,
    h('div', { class: 'panel' },
      h('h2', {}, h('span', { class: 'accent' }, 'Cookbook trace'), ` — ${trace.mode}`),
      baselineOnly
        ? h('div', { class: 'missing-evidence' },
            h('span', { class: 'lbl' }, 'BASELINE — '),
            'minimal mode; cookbook did not influence pattern selection. Re-run with ',
            h('code', {}, 'CACTUS_COOKBOOK_MODE=enabled'),
            ' to see retrieval evidence.',
          )
        : h('div', { class: 'metric-strip' },
            metricInline('mode', trace.mode),
            metricInline('genre', trace.genre),
            metricInline('bpm', String(trace.bpm)),
            metricInline('picks', String(trace.picks.length)),
            metricInline('selected', String(picksWithSelection)),
            metricInline('fell back', String(picksWithFallback)),
            metricInline('mutated', String(picksWithMutation)),
          ),
    ),
    !baselineOnly && trace.picks.length > 0
      ? h('div', { class: 'panel' },
          h('h2', {}, 'Per-pick decisions'),
          h('table', { class: 'dense' },
            h('thead', {}, h('tr', {},
              h('th', {}, 'role'),
              h('th', {}, 'section'),
              h('th', {}, 'cookbook role'),
              h('th', { class: 'num' }, 'top'),
              h('th', { class: 'num' }, 'cands'),
              h('th', {}, 'selected'),
              h('th', {}, 'reason / fallback'),
              h('th', {}, 'mutation'),
              h('th', {}, 'blame path'),
              h('th', { class: 'num' }, 'orbit'),
            )),
            h('tbody', {}, ...trace.picks.map(renderPickRow)),
          ),
        )
      : null,
  );
}

function renderPickRow(p: CookbookTracePick): HTMLElement {
  const sel = p.selected_id ? pill(p.selected_id, 'ok') : pill('—', 'muted');
  const reason = p.selected_id
    ? h('span', { class: 'meta' }, p.selection_reason ?? '')
    : h('span', { class: 'meta' }, p.fallback_reason ?? '—');
  const mutation = p.mutation_applied
    ? pill(p.mutation_applied.operator, 'info')
    : pill('—', 'muted');
  const blamePath = p.blame ? h('span', { class: 'meta' }, p.blame.graph_path) : h('span', { class: 'meta' }, '—');
  const orbit = p.blame?.contributes_to_orbit;
  return h('tr', {},
    h('td', {}, p.layer_role),
    h('td', {}, p.section_function),
    h('td', {}, p.cookbook_role ?? '—'),
    h('td', { class: 'num' }, p.candidates_top_ids.slice(0, 1).join('') || '—'),
    h('td', { class: 'num' }, String(p.candidates_total)),
    h('td', {}, sel),
    h('td', {}, reason),
    h('td', {}, mutation),
    h('td', {}, blamePath),
    h('td', { class: 'num' }, orbit != null ? String(orbit) : '—'),
  );
}

function metricInline(label: string, value: string): HTMLElement {
  return h('div', { class: 'metric' },
    h('div', { class: 'lbl' }, label),
    h('div', { class: 'val' }, value),
  );
}
