// G11A §1: session overview. Brief, seed/genre/bpm, mode, artifact summary,
// reproduce command, raw graph for jump-in inspection.

import { h, render, pill, metric, missingEvidence } from '../dom.js';
import {
  loadSessionSummary, loadCompiledCode, loadCookbookTrace, loadQualityGates,
  buildReproCommand, suggestCommandForMissing, browserFetcher,
} from '../data/loaders.js';

export async function renderSessionOverview(host: HTMLElement, sessionId: string): Promise<void> {
  render(host, h('div', { class: 'panel muted' }, h('h2', {}, 'Loading session...')));
  const s = await loadSessionSummary(browserFetcher, sessionId);
  if (!s.ok) {
    render(host, h('div', { class: 'missing-evidence' },
      h('span', { class: 'lbl' }, 'NO SESSION — '),
      `cannot load session ${sessionId}`,
    ));
    return;
  }
  const summary = s.data;
  const trace = await loadCookbookTrace(browserFetcher, sessionId);
  const code = await loadCompiledCode(browserFetcher, sessionId, 0);
  const gates = await loadQualityGates(browserFetcher, sessionId, 0);

  const repro = buildReproCommand(summary);
  const inv = summary.inventory;

  const traceCount = trace.ok ? trace.data.picks.length : 0;
  const traceModeKind: 'ok' | 'warn' | 'muted' =
    trace.ok && (trace.data.mode === 'enabled' || trace.data.mode === 'enabled_mutating')
      ? 'ok' : 'muted';

  render(host,
    h('div', { class: 'panel' },
      h('h2', {}, h('span', { class: 'accent' }, 'Session — '), summary.session_id),
      h('div', { class: 'metric-strip' },
        metric('brief', summary.brief ?? '—'),
        metric('genre', summary.primary_genre ?? '—'),
        metric('bpm', summary.bpm ?? '—'),
        metric('bars', summary.total_bars ?? '—'),
        metric('schema', summary.schema_version ?? '—'),
        metric('cookbook mode', summary.cookbook_mode ?? '—'),
        metric('created', summary.created_at?.slice(0, 19).replace('T', ' ') ?? '—'),
      ),
    ),

    h('div', { class: 'cols-3' },
      h('div', { class: 'panel' },
        h('h2', {}, 'Quality gates'),
        gates.ok
          ? h('div', {},
              h('div', { class: 'metric-strip' },
                metric('overall', gates.data.overall_pass ? 'PASS' : 'FAIL'),
                metric('hard fails', gates.data.hard_fail_count ?? 0),
                metric('warnings', gates.data.severe_warning_count ?? 0),
                metric('skipped', gates.data.skipped_count ?? 0),
              ),
              h('p', { class: 'meta', style: 'font-size: 11px; margin-top: 8px' },
                `${gates.data.gates.length} gates evaluated. Open the Gates tab for the per-gate breakdown.`,
              ),
            )
          : missingEvidence('quality gates not run for this iteration', suggestCommandForMissing('iter_0000.quality-gates.json')),
      ),

      h('div', { class: 'panel' },
        h('h2', {}, 'Cookbook trace'),
        trace.ok
          ? h('div', {},
              h('div', { class: 'metric-strip' },
                metric('mode', trace.data.mode),
                metric('picks', traceCount),
                metric('genre', trace.data.genre),
                metric('bpm', trace.data.bpm),
              ),
              trace.data.baseline_only
                ? h('p', { class: 'meta', style: 'font-size:11px; margin-top:8px' }, pill('baseline only', 'muted'), ' minimal mode emitted; cookbook did not influence this run.')
                : h('p', { class: 'meta', style: 'font-size:11px; margin-top:8px' }, pill(trace.data.mode, traceModeKind), ' Open the Trace tab for the per-pick breakdown.'),
            )
          : missingEvidence('no cookbook trace; producer ran without trace capture', suggestCommandForMissing('cookbook-trace.json')),
      ),

      h('div', { class: 'panel' },
        h('h2', {}, 'Artifacts'),
        h('table', { class: 'dense' },
          h('tbody', {},
            row('graph', inv.has.graph),
            row('compiled code', inv.has.code),
            row('cookbook-trace', inv.has.cookbook_trace),
            row('report.md', inv.has.report),
            row('wav', inv.has.wav.length > 0, `${inv.has.wav.length} iter(s)`),
            row('features', inv.has.features.length > 0, `${inv.has.features.length} iter(s)`),
            row('quality-gates', inv.has.quality_gates.length > 0, `${inv.has.quality_gates.length} iter(s)`),
            row('critique', inv.has.critique.length > 0, `${inv.has.critique.length} iter(s)`),
            row('failure-taxonomy', inv.has.failure_taxonomy.length > 0, `${inv.has.failure_taxonomy.length} iter(s)`),
            row('revision-plan', inv.has.revision_plan.length > 0, `${inv.has.revision_plan.length} iter(s)`),
            row('locality', inv.has.locality.length > 0, `${inv.has.locality.length} iter(s)`),
            row('spectrogram', inv.has.spectrogram.length > 0, `${inv.has.spectrogram.length} iter(s)`),
          ),
        ),
      ),
    ),

    h('div', { class: 'panel' },
      h('h2', {}, 'Reproduce / artifact path'),
      h('div', { class: 'metric', style: 'margin-bottom:8px' },
        h('div', { class: 'lbl' }, 'reproduce command'),
        h('pre', { class: 'code', style: 'max-height:60px; margin: 4px 0' }, repro),
      ),
      h('div', { class: 'metric' },
        h('div', { class: 'lbl' }, 'artifact dir'),
        h('pre', { class: 'code', style: 'max-height:60px; margin: 4px 0' }, `apps/cli/sessions/${sessionId}/`),
      ),
    ),

    h('div', { class: 'panel' },
      h('h2', {}, 'Compiled Strudel — iter 0000'),
      code.ok
        ? h('pre', { class: 'code' }, code.data)
        : missingEvidence('no compiled output', '(this should always exist; check the session)'),
    ),
  );
}

function row(name: string, present: boolean, sub?: string): HTMLElement {
  return h('tr', {},
    h('td', {}, name),
    h('td', {}, pill(present ? 'present' : 'absent', present ? 'ok' : 'muted')),
    h('td', { class: 'meta' }, sub ?? ''),
  );
}
