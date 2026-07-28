// G11A §7: ledger view. Promoted / candidate / rejected / regressions
// listings, with click-to-open the markdown evidence.

import { h, render, pill, missingEvidence } from '../dom.js';
import { loadLedger, loadLedgerEntry, browserFetcher } from '../data/loaders.js';

const REQUIRED = [
  'source trigger', 'proposed prior', 'expected benefit', 'possible harm',
  'validation evidence', 'promotion decision', 'rollback path',
];

export async function renderLedger(host: HTMLElement): Promise<void> {
  render(host, h('div', { class: 'panel muted' }, h('h2', {}, 'Loading ledger...')));
  const r = await loadLedger(browserFetcher);
  if (!r.ok) {
    render(host, h('div', { class: 'panel' }, missingEvidence('no ledger directory', '(it should exist; check learning_ledger/cookbook/)')));
    return;
  }
  const led = r.data;

  const sectionRows = async (kind: 'promoted_priors' | 'candidate_priors' | 'rejected_priors' | 'regressions', files: string[]) => {
    const rows: HTMLElement[] = [];
    for (const f of files) {
      const c = await loadLedgerEntry(browserFetcher, kind, f);
      const text = c.ok ? c.data : '';
      const present = REQUIRED.filter((sec) => text.toLowerCase().includes(sec.toLowerCase()));
      const missing = REQUIRED.filter((sec) => !text.toLowerCase().includes(sec.toLowerCase()));
      const evidenceComplete = missing.length === 0;
      rows.push(h('tr', {
        onclick: (() => openEntry(f, text)) as EventListener,
        style: 'cursor: pointer',
      },
        h('td', {}, f),
        h('td', {}, evidenceComplete ? pill('complete', 'ok') : pill(`${missing.length} missing`, 'warn')),
        h('td', { class: 'meta' }, `${present.length}/${REQUIRED.length} sections`),
      ));
    }
    return rows;
  };

  // Render shells immediately; populate sections asynchronously.
  const shell = h('div', {});
  render(host, shell);

  shell.appendChild(await section('Promoted', led.promoted, await sectionRows('promoted_priors', led.promoted)));
  shell.appendChild(await section('Candidates', led.candidates, await sectionRows('candidate_priors', led.candidates)));
  shell.appendChild(await section('Rejected', led.rejected, await sectionRows('rejected_priors', led.rejected)));
  shell.appendChild(await section('Regressions', led.regressions, await sectionRows('regressions', led.regressions)));
}

async function section(title: string, files: string[], rows: HTMLElement[]): Promise<HTMLElement> {
  return h('div', { class: 'panel' },
    h('h2', {}, h('span', { class: 'accent' }, title), ` — ${files.length}`),
    files.length === 0
      ? h('div', { class: 'meta', style: 'font-size: 11px' }, '(empty)')
      : h('table', { class: 'dense' },
          h('thead', {}, h('tr', {}, h('th', {}, 'file'), h('th', {}, 'evidence'), h('th', {}, 'sections'))),
          h('tbody', {}, ...rows),
        ),
  );
}

function openEntry(filename: string, text: string): void {
  const dialog = h('div', {
    style: 'position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100',
    onclick: ((e: Event) => { if (e.target === e.currentTarget) dialog.remove(); }) as EventListener,
  },
    h('div', { style: 'background: var(--bg-1); border: 1px solid var(--line); border-radius: 2px; max-width: 800px; max-height: 80vh; overflow: auto; padding: 16px' },
      h('h2', { style: 'font-family: var(--font-mono); font-size: 12px; margin: 0 0 12px; color: var(--accent)' }, filename),
      h('pre', { class: 'code', style: 'max-height: 60vh' }, text),
      h('div', { style: 'margin-top: 12px; text-align: right' },
        h('button', { onclick: (() => dialog.remove()) as EventListener }, 'close'),
      ),
    ),
  );
  document.body.appendChild(dialog);
}
