import { render } from 'preact';
import { useCallback, useEffect } from 'preact/hooks';
import { api, connectEvents } from './api-client';
import { reconcilePendingOperations } from './state/operation-intents';
import { bootstrapCoordinator } from './bootstrap';
import { AppShell, routeFromPath, routePaths } from './components/app-shell';
import { Transport } from './components/transport';
import { LoadingState } from './components/ui';
import type { RouteId } from './contracts';
import { ActivityScreen } from './screens/activity';
import { LibraryScreen } from './screens/library';
import { ResearchScreen } from './screens/research';
import {
  AgentSettingsScreen,
  GenerationSettingsScreen,
  SystemSettingsScreen,
} from './screens/settings';
import { StudioScreen } from './screens/studio';
import { appStore, useAppState } from './store';
import './style.css';

function Screen({ route }: { route: RouteId }) {
  switch (route) {
    case 'studio':
      return <StudioScreen />;
    case 'library':
      return <LibraryScreen />;
    case 'research':
      return <ResearchScreen />;
    case 'activity':
      return <ActivityScreen />;
    case 'settings-agent':
      return <AgentSettingsScreen />;
    case 'settings-generation':
      return <GenerationSettingsScreen />;
    case 'settings-system':
      return <SystemSettingsScreen />;
  }
}

function App() {
  const state = useAppState();

  const load = useCallback(async (signal?: AbortSignal) => {
    appStore.patch({ loadState: 'loading', loadError: undefined });
    try {
      await bootstrapCoordinator.refresh(signal);
    } catch (error) {
      if (!signal?.aborted) {
        appStore.patch({
          loadState: 'error',
          loadError: error instanceof Error ? error.message : 'Bootstrap failed.',
          eventState: 'offline',
        });
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    appStore.setRoute(routeFromPath(window.location.pathname));
    void load(controller.signal);
    const pop = () => appStore.setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', pop);
    return () => {
      controller.abort();
      window.removeEventListener('popstate', pop);
    };
  }, [load]);

  useEffect(() => {
    if (state.loadState !== 'ready') return;
    // IDEM-001: before the user can duplicate anything, resolve every
    // intent that survived a browser restart against the server's exact
    // prior outcome.
    void reconcilePendingOperations((key) => api.operationReadback(key)).then(
      (resolved) => {
        for (const { intent, readback } of resolved) {
          if (readback.found) {
            appStore.toast(
              `Restored: “${intent.summary}” already committed as ${readback.kind}. Showing the durable outcome.`,
              'ok',
            );
          } else {
            appStore.toast(
              `Restored: “${intent.summary}” never committed. Safe to redo.`,
              'warn',
            );
          }
        }
        if (resolved.some(({ readback }) => readback.found)) {
          void bootstrapCoordinator.refresh();
        }
      },
    );
  }, [state.loadState]);

  useEffect(() => {
    if (state.loadState !== 'ready' || !state.bootstrap) return;
    return connectEvents(
      state.bootstrap.cursor,
      (event) => appStore.applyEvent(event),
      (eventState) => appStore.patch({ eventState }),
    );
  }, [state.loadState, Boolean(state.bootstrap)]);

  useEffect(() => {
    if (state.loadState !== 'ready') return;
    let stopped = false;
    let refreshing = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (stopped || refreshing) return;
      refreshing = true;
      try {
        await bootstrapCoordinator.refresh(controller.signal);
      } catch {
        // SSE keeps retrying independently; the next focus/interval readback
        // repairs any event published outside a domain transaction.
      } finally {
        refreshing = false;
      }
    };
    const onFocus = () => void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [state.loadState]);

  const navigate = (route: RouteId) => {
    if (state.route === route) return;
    window.history.pushState({}, '', routePaths[route]);
    appStore.setRoute(route);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  return (
    <AppShell route={state.route} onNavigate={navigate}>
      <LoadingState state={state.loadState} error={state.loadError} onRetry={() => void load()} />
      {state.loadState === 'ready' && <Screen route={state.route} />}
      <Transport />
    </AppShell>
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app mount.');
render(<App />, root);
