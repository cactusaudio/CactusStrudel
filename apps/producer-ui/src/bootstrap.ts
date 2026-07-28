import { api } from './api-client';
import type { BootstrapPayload } from './contracts';
import { BootstrapCoordinator } from './state/bootstrap-coordinator';
import { appStore } from './store';

export const bootstrapCoordinator = new BootstrapCoordinator<BootstrapPayload>({
  fetchSnapshot: (signal) => api.bootstrap(signal),
  getCurrent: () => appStore.getSnapshot().bootstrap,
  apply: (bootstrap) => {
    appStore.setBootstrap(bootstrap);
  },
});
