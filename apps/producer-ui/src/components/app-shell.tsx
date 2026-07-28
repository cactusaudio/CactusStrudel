import type { ComponentChildren, JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import type { RouteId } from '../contracts';
import { useAppState } from '../store';
import { Badge, StatusDot } from './ui';

const primary: Array<{ route: RouteId; label: string; glyph: string; hint: string }> = [
  { route: 'studio', label: 'Studio', glyph: 'S', hint: 'Create and judge' },
  { route: 'library', label: 'Library', glyph: 'L', hint: 'Pieces and revisions' },
  { route: 'research', label: 'Research', glyph: 'R', hint: 'Human-score evidence' },
  { route: 'activity', label: 'Activity', glyph: 'A', hint: 'Jobs and receipts' },
];

const settings: Array<{ route: RouteId; label: string }> = [
  { route: 'settings-agent', label: 'Agent' },
  { route: 'settings-generation', label: 'Generation' },
  { route: 'settings-system', label: 'System' },
];

export const routePaths: Record<RouteId, string> = {
  studio: '/studio',
  library: '/library',
  research: '/research',
  activity: '/activity',
  'settings-agent': '/settings/agent',
  'settings-generation': '/settings/generation',
  'settings-system': '/settings/system',
};

export function routeFromPath(pathname: string): RouteId {
  const clean = pathname.replace(/^\/runtime\/app/, '').replace(/\/+$/, '') || '/studio';
  return (Object.entries(routePaths).find(([, path]) => path === clean)?.[0] as RouteId | undefined) || 'studio';
}

function NavLink({
  route,
  label,
  glyph,
  hint,
  current,
  onNavigate,
}: {
  route: RouteId;
  label: string;
  glyph: string;
  hint: string;
  current: RouteId;
  onNavigate: (route: RouteId) => void;
}): JSX.Element {
  return (
    <a
      class={`nav-link${current === route ? ' nav-link--active' : ''}`}
      href={routePaths[route]}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(route);
      }}
    >
      <span class="nav-link__glyph">{glyph}</span>
      <span><strong>{label}</strong><small>{hint}</small></span>
    </a>
  );
}

export function AppShell({
  route,
  onNavigate,
  children,
}: {
  route: RouteId;
  onNavigate: (route: RouteId) => void;
  children: ComponentChildren;
}): JSX.Element {
  const state = useAppState();
  const running = useMemo(
    () => state.bootstrap?.jobs.filter((job) => ['queued', 'running', 'cancelling'].includes(job.state)).length || 0,
    [state.bootstrap?.jobs],
  );
  const title = primary.find((item) => item.route === route)?.label
    || settings.find((item) => item.route === route)?.label
    || 'Producer';

  return (
    <div class="app-shell">
      <aside class="app-nav">
        <div class="brand">
          <div class="brand__mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div><strong>CactusStrudel</strong><small>producer brain</small></div>
        </div>

        <nav class="nav-group" aria-label="Main navigation">
          <div class="nav-group__label">Workspaces</div>
          {primary.map((item) => (
            <NavLink
              key={item.route}
              {...item}
              current={route}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <nav class="nav-group nav-group--settings" aria-label="Settings navigation">
          <div class="nav-group__label">Settings</div>
          {settings.map((item) => (
            <a
              key={item.route}
              class={`settings-link${route === item.route ? ' settings-link--active' : ''}`}
              href={routePaths[item.route]}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(item.route);
              }}
            >
              <span>{item.label}</span>
              <i>›</i>
            </a>
          ))}
        </nav>

        <div class="runtime-card">
          <div>
            <StatusDot
              tone={state.eventState === 'connected' ? 'green' : state.eventState === 'retrying' ? 'amber' : 'red'}
              pulse={state.eventState === 'retrying'}
            />
            <span>{state.eventState === 'connected' ? 'Live runtime' : state.eventState}</span>
          </div>
          {running > 0 && <Badge tone="blue">{running} active</Badge>}
          <small>Events reconnect without cancelling server jobs.</small>
        </div>
      </aside>

      <div class="app-main">
        <header class="topbar">
          <div class="topbar__title">
            <span class="eyebrow">CactusStrudel /</span>
            <strong>{title}</strong>
          </div>
          <div class="topbar__status">
            {state.bootstrap?.settings.agent.active.model_id && (
              <div class="active-agent">
                <span>Brain</span>
                <strong>{state.bootstrap.settings.agent.active.model_id}</strong>
                <i>{state.bootstrap.settings.agent.active.reasoning_effort}</i>
              </div>
            )}
            <span class="server-clock">{state.bootstrap?.server_time ? `Synced ${new Date(state.bootstrap.server_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Local'}</span>
          </div>
        </header>
        <main class={`route route--${route}`}>{children}</main>
      </div>

      <div class="toast-stack" aria-live="polite">
        {state.toasts.map((toast) => (
          <div key={toast.id} class={`toast toast--${toast.tone}`}>
            <StatusDot tone={toast.tone === 'ok' ? 'green' : toast.tone === 'warn' ? 'amber' : 'red'} />
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
