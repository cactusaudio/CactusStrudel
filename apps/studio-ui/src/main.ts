// G11A: studio inspector entry point. Tab-based navigation; URL hash drives
// state so links + screenshots are stable.

import './style.css';
import { h, render } from './dom.js';
import { renderSessionsList } from './screens/sessions-list.js';
import { renderSessionOverview } from './screens/session-overview.js';
import { renderQualityGates } from './screens/quality-gates.js';
import { renderCookbookTrace } from './screens/cookbook-trace.js';
import { renderImpactAudits } from './screens/impact-audit.js';
import { renderLedger } from './screens/ledger.js';

type Screen =
  | { kind: 'sessions' }
  | { kind: 'session'; id: string; tab: 'overview' | 'gates' | 'trace' }
  | { kind: 'impact' }
  | { kind: 'ledger' };

function parseHash(): Screen {
  const h = location.hash.slice(1);
  if (!h) return { kind: 'sessions' };
  const parts = h.split('/');
  if (parts[0] === 'session' && parts[1]) {
    const tab = (parts[2] as 'overview' | 'gates' | 'trace') ?? 'overview';
    return { kind: 'session', id: parts[1], tab };
  }
  if (parts[0] === 'impact') return { kind: 'impact' };
  if (parts[0] === 'ledger') return { kind: 'ledger' };
  return { kind: 'sessions' };
}

function setHash(s: Screen): void {
  if (s.kind === 'sessions') location.hash = '';
  else if (s.kind === 'session') location.hash = `session/${s.id}/${s.tab}`;
  else if (s.kind === 'impact') location.hash = 'impact';
  else if (s.kind === 'ledger') location.hash = 'ledger';
}

async function navigate(screen: Screen): Promise<void> {
  const main = document.getElementById('main') as HTMLElement;
  for (const btn of document.querySelectorAll('.topbar nav button')) btn.classList.remove('active');
  const activeTopId =
    screen.kind === 'sessions' ? 'tab-sessions'
    : screen.kind === 'session' ? 'tab-sessions'
    : screen.kind === 'impact' ? 'tab-impact'
    : 'tab-ledger';
  document.getElementById(activeTopId)?.classList.add('active');

  if (screen.kind === 'sessions') {
    await renderSessionsList(main, (id) => {
      setHash({ kind: 'session', id, tab: 'overview' });
    });
    return;
  }
  if (screen.kind === 'session') {
    const subTabs = h('div', { class: 'panel', style: 'padding: 8px 16px' },
      h('div', { style: 'display: flex; gap: 12px; align-items: center' },
        h('span', { class: 'meta', style: 'font-family: var(--font-mono)' }, `session ${screen.id.slice(0, 8)}`),
        ...(['overview', 'gates', 'trace'] as const).map((t) =>
          h('button', {
            class: t === screen.tab ? 'primary' : '',
            onclick: (() => setHash({ kind: 'session', id: screen.id, tab: t })) as EventListener,
          }, t),
        ),
        h('button', {
          style: 'margin-left: auto',
          onclick: (() => setHash({ kind: 'sessions' })) as EventListener,
        }, '← back'),
      ),
    );
    render(main, subTabs);
    const body = h('div', {});
    main.appendChild(body);
    if (screen.tab === 'overview') await renderSessionOverview(body, screen.id);
    else if (screen.tab === 'gates') await renderQualityGates(body, screen.id);
    else if (screen.tab === 'trace') await renderCookbookTrace(body, screen.id);
    return;
  }
  if (screen.kind === 'impact') { await renderImpactAudits(main); return; }
  if (screen.kind === 'ledger') { await renderLedger(main); return; }
}

function bootstrap(): void {
  const app = h('div', { class: 'app' },
    h('header', { class: 'topbar' },
      h('h1', {}, 'CACTUS · STUDIO'),
      h('nav', {},
        h('button', { id: 'tab-sessions', onclick: (() => setHash({ kind: 'sessions' })) as EventListener }, 'sessions'),
        h('button', { id: 'tab-impact', onclick: (() => setHash({ kind: 'impact' })) as EventListener }, 'impact a/b'),
        h('button', { id: 'tab-ledger', onclick: (() => setHash({ kind: 'ledger' })) as EventListener }, 'ledger'),
      ),
      h('div', { class: 'right' }, 'read-only · file-backed inspector'),
    ),
    h('main', { id: 'main' }),
  );
  render(document.body, app);
  void navigate(parseHash());
  window.addEventListener('hashchange', () => { void navigate(parseHash()); });
}

bootstrap();
