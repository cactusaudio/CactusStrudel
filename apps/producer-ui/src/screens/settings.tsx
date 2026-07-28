import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../api-client';
import { bootstrapCoordinator } from '../bootstrap';
import type {
  AgentConnectionDraft,
  AgentSettings,
  GenerationProfile,
  ModelCatalogItem,
  ReasoningEffort,
} from '../contracts';
import {
  appStore,
  type AgentSettingsOperationKind,
  type AgentSettingsOperationOwnership,
  useAppState,
} from '../store';
import {
  currentSettingsTest,
  modelDefaultEffort,
  settingsTestState,
} from '../state/invariants';
import { Badge, Button, EmptyState, Panel, PanelHeader, StatusDot, formatDateTime } from '../components/ui';

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.detail || error.message;
  return error instanceof Error ? error.message : 'Settings operation failed.';
}

function ModelOption({ model }: { model: ModelCatalogItem }): JSX.Element {
  return (
    <option value={model.id}>
      {model.label || model.id}
      {model.capability_source === 'unknown' ? ' · capabilities unknown' : ''}
    </option>
  );
}

function ActiveProfileCard({ settings }: { settings: AgentSettings }): JSX.Element {
  const active = settings.active;
  const hasActive = Boolean(settings.revision_id && active.model_id);
  return (
    <Panel class="active-profile-card">
      <PanelHeader
        eyebrow="Currently active"
        title={active.model_id || 'No active model'}
        actions={
          <Badge tone={settings.status?.ready ? 'green' : 'amber'}>
            {settings.status?.ready ? 'ready' : 'attention'}
          </Badge>
        }
      />
      <div class="active-profile__route">
        <StatusDot tone={settings.status?.ready ? 'green' : 'amber'} />
        <code>{hasActive ? active.base_url : '—'}</code>
      </div>
      <dl class="settings-facts">
        <div><dt>API key</dt><dd>{hasActive ? (active.key_present ? '•••••••••••• stored' : 'Not stored') : '—'}</dd></div>
        <div><dt>Reasoning</dt><dd>{hasActive ? (active.reasoning_effort || 'default') : '—'}</dd></div>
        <div><dt>Orchestration</dt><dd>{hasActive ? active.orchestration : '—'}</dd></div>
        <div><dt>Revision</dt><dd><code>{settings.revision_id || '—'}</code></dd></div>
      </dl>
      <p class="muted">{settings.status?.detail || 'This revision remains active until a tested draft is atomically applied.'}</p>
    </Panel>
  );
}

export function AgentSettingsScreen(): JSX.Element {
  const state = useAppState();
  const settings = state.bootstrap?.settings.agent;
  const draft = state.agentDraft;
  const operation = state.agentSettingsOperation?.kind;
  const [pendingApiKey, setPendingApiKey] = useState(() => draft?.api_key || '');

  if (!settings || !draft) {
    return <EmptyState title="Agent settings unavailable" body="The bootstrap snapshot did not include an Agent Settings v3 document." />;
  }

  const selectedModel = settings.catalog.find((model) => model.id === draft.model_id);
  const efforts: ReasoningEffort[] = selectedModel?.reasoning_efforts || [];
  const testIsCurrent = currentSettingsTest(settings);
  const testState = settingsTestState(settings);
  const ultraAllowed = Boolean(selectedModel?.supports_ultra);
  const locked = operation !== undefined;

  const edit = (patch: Partial<AgentConnectionDraft>) => {
    appStore.setAgentDraft(patch);
  };
  const requestDraft = (): AgentConnectionDraft => ({
    ...draft,
    api_key: pendingApiKey || undefined,
  });
  const begin = (
    next: AgentSettingsOperationKind,
  ): AgentSettingsOperationOwnership | undefined => (
    appStore.beginAgentSettingsOperation(next)
  );
  const acceptAuthoritativeReadback = async (
    ownership: AgentSettingsOperationOwnership,
  ): Promise<{ document: AgentSettings; accepted: boolean }> => {
    const document = await api.getAgentSettings();
    const accepted = appStore.applyAgentSettingsReadback(ownership, document);
    if (accepted) {
      bootstrapCoordinator.markExternalApply();
      setPendingApiKey('');
    }
    return { document, accepted };
  };
  const discover = async () => {
    const ownership = begin('discover');
    if (!ownership) return;
    try {
      const result = await api.discoverModels(requestDraft());
      const { document, accepted } = await acceptAuthoritativeReadback(ownership);
      appStore.toast(
        accepted
          ? `Authenticated catalog returned ${document.catalog.length || result.catalog.length} exact model IDs.`
          : 'Discovery completed, but a newer Agent draft owns the panel. Its fields were preserved.',
        accepted ? 'ok' : 'warn',
      );
    } catch (error) {
      appStore.toast(errorText(error), 'error');
    } finally {
      appStore.finishAgentSettingsOperation(ownership);
    }
  };
  const test = async () => {
    const ownership = begin('test');
    if (!ownership) return;
    try {
      const submitted = requestDraft();
      const result = await api.testAgent(submitted);
      const { document, accepted } = await acceptAuthoritativeReadback(ownership);
      if (!accepted) {
        appStore.toast('The Test completed, but a newer Agent draft owns the panel. Its fields were preserved.', 'warn');
      } else if (document.test?.id !== result.test?.id) {
        appStore.toast('The Test completed, but newer Agent settings now own the panel. Showing authoritative readback.', 'warn');
      } else if (document.test?.ok) {
        appStore.toast(`Connection passed with ${document.test.model_id || submitted.model_id}.`);
      } else {
        appStore.toast(document.test?.error || 'Connection test failed.', 'error');
      }
    } catch (error) {
      appStore.toast(errorText(error), 'error');
    } finally {
      appStore.finishAgentSettingsOperation(ownership);
    }
  };
  const apply = async () => {
    if (!settings.test?.id || !testIsCurrent) return;
    const ownership = begin('apply');
    if (!ownership) return;
    try {
      const result = await api.applyAgent(requestDraft(), settings.test.id);
      const { document, accepted } = await acceptAuthoritativeReadback(ownership);
      if (!accepted) {
        appStore.toast('Apply completed, but a newer Agent draft owns the panel. Its fields were preserved.', 'warn');
      } else if (document.revision_id !== result.revision_id) {
        appStore.toast('Apply committed, but a newer Agent revision now owns the runtime. Showing authoritative readback.', 'warn');
      } else {
        appStore.toast(`Agent profile ${document.active.model_id} applied and read back.`);
      }
    } catch (error) {
      appStore.toast(errorText(error), 'error');
    } finally {
      appStore.finishAgentSettingsOperation(ownership);
    }
  };
  const discard = async () => {
    const ownership = begin('discard');
    if (!ownership) return;
    try {
      const result = await api.resetAgentDraft();
      const { document, accepted } = await acceptAuthoritativeReadback(ownership);
      if (!accepted) {
        appStore.toast('Draft reset completed, but a newer Agent draft owns the panel. Its fields were preserved.', 'warn');
      } else if (document.draft_fingerprint !== result.draft_fingerprint) {
        appStore.toast('Draft reset completed, but newer Agent settings now own the panel. Showing authoritative readback.', 'warn');
      } else {
        appStore.toast('Draft and its candidate credential were discarded.');
      }
    } catch (error) {
      appStore.toast(errorText(error), 'error');
    } finally {
      appStore.finishAgentSettingsOperation(ownership);
    }
  };

  return (
    <div class="settings-page">
      <section class="page-heading">
        <div>
          <div class="eyebrow">Agent Settings v3</div>
          <h1>Brain connection</h1>
          <p>Draft → authenticated discovery → real selected-model probe → atomic Apply. No silent fallback.</p>
        </div>
        <Badge tone="gold">CLIProxy native / Responses</Badge>
      </section>

      {settings.managed_overrides && settings.managed_overrides.length > 0 && (
        <div class="managed-banner">
          <Badge tone="amber">Managed override</Badge>
          <span>{settings.managed_overrides.join(', ')} is controlled outside this panel and shown explicitly.</span>
        </div>
      )}

      <div class="settings-columns">
        <ActiveProfileCard settings={settings} />

        <form
          class="panel settings-editor"
          aria-busy={locked}
          onSubmit={(event) => event.preventDefault()}
        >
          <fieldset class="settings-editor__operation-scope" disabled={locked}>
          <PanelHeader
            eyebrow="Draft"
            title="Candidate profile"
            detail="Editing any field invalidates the prior test."
            actions={state.agentDraftDirty && <Badge tone="amber">not applied</Badge>}
          />

          <div class="form-grid">
            <label class="field field--wide">
              <span>Base URL</span>
              <input
                value={draft.base_url}
                spellcheck={false}
                placeholder="http://127.0.0.1:8318/v1"
                onInput={(event) => edit({ base_url: event.currentTarget.value })}
              />
              <small>Direct CLIProxy OpenAI-compatible endpoint. No secondary fallback.</small>
            </label>
            <label class="field field--wide">
              <span>API key</span>
              <div class="secret-input">
                <input
                  type="password"
                  autocomplete="new-password"
                  value={pendingApiKey}
                  placeholder={draft.key_present ? 'Stored key · enter only to replace' : 'Required'}
                  onInput={(event) => {
                    const value = event.currentTarget.value;
                    setPendingApiKey(value);
                    edit({ api_key: value || undefined });
                  }}
                />
                <span class={pendingApiKey ? 'pending' : ''}>
                  {pendingApiKey ? 'pending' : draft.key_present ? 'stored' : 'missing'}
                </span>
              </div>
              <small>The applied secret is kept by the runtime credential store, never echoed here.</small>
            </label>

            <label class="field field--model">
              <span>Exact model ID</span>
              <select
                value={draft.model_id}
                disabled={settings.catalog.length === 0}
                onChange={(event) => {
                  const model = settings.catalog.find((item) => item.id === event.currentTarget.value);
                  edit({
                    model_id: event.currentTarget.value,
                    reasoning_effort: modelDefaultEffort(model),
                    orchestration: model?.supports_ultra ? draft.orchestration : 'standard',
                  });
                }}
              >
                {settings.catalog.length === 0 && <option value={draft.model_id}>{draft.model_id || 'Discover models first'}</option>}
                {settings.catalog.map((model) => <ModelOption key={model.id} model={model} />)}
              </select>
              <small>
                {selectedModel
                  ? `${selectedModel.capability_source} capability record`
                  : 'Authenticate and discover; the UI does not guess unavailable IDs.'}
              </small>
            </label>
            <div class="discover-field">
              <Button busy={operation === 'discover'} onClick={discover}>Discover models</Button>
              <small>Calls authenticated <code>/models</code></small>
            </div>

            <label class="field">
              <span>Reasoning effort</span>
              <select
                value={draft.reasoning_effort || ''}
                disabled={efforts.length === 0}
                onChange={(event) => edit({
                  reasoning_effort: event.currentTarget.value
                    ? event.currentTarget.value as ReasoningEffort
                    : null,
                })}
              >
                {efforts.length === 0 && <option value="">Not advertised</option>}
                {efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
              </select>
              {selectedModel?.capability_source === 'unknown' && <small class="warning-copy">Capability unknown; no extra effort values inferred.</small>}
            </label>

            <fieldset class="field orchestration-field">
              <legend>Orchestration</legend>
              <div class="mode-cards">
                <button type="button" class={draft.orchestration === 'standard' ? 'active' : ''} onClick={() => edit({ orchestration: 'standard' })}>
                  <strong>Standard</strong>
                  <small>One lead agent, exact upstream effort</small>
                </button>
                <button
                  type="button"
                  class={draft.orchestration === 'ultra' ? 'active' : ''}
                  disabled={!ultraAllowed}
                  onClick={() => edit({ orchestration: 'ultra' })}
                >
                  <strong>Ultra</strong>
                  <small>{ultraAllowed ? 'Client orchestration · wire effort max' : 'Not supported for this exact model'}</small>
                </button>
              </div>
            </fieldset>
          </div>

          <div class="settings-test">
            <div class="settings-test__copy">
              <strong>Test the selected profile</strong>
              <small>One small Responses tool probe. No 50-model matrix.</small>
              {settings.test && (
                <div class={`test-result test-result--${testState === 'current-pass' ? 'ok' : testState === 'stale-pass' ? 'stale' : 'error'}`}>
                  <StatusDot tone={testState === 'current-pass' ? 'green' : testState === 'stale-pass' ? 'amber' : 'red'} />
                  <span>
                    {testState === 'stale-pass'
                      ? `${settings.test.model_id || 'Previous model'} passed, but this draft has changed.`
                      : settings.test.ok
                      ? `${settings.test.model_id || draft.model_id} replied${settings.test.latency_ms ? ` in ${settings.test.latency_ms} ms` : ''}`
                      : settings.test.error || 'Probe failed'}
                  </span>
                  <time>{formatDateTime(settings.test.tested_at)}</time>
                </div>
              )}
            </div>
            <Button busy={operation === 'test'} disabled={!draft.base_url || !draft.model_id} onClick={test}>Test connection</Button>
          </div>

          <div class="settings-apply">
            <div>
              <strong>{testIsCurrent ? 'Test receipt matches this draft.' : 'A current passing test is required.'}</strong>
              <small>The old active profile remains untouched until Apply commits and reads back.</small>
            </div>
            <Button busy={operation === 'discard'} onClick={discard} disabled={!state.agentDraftDirty}>Discard draft</Button>
            <Button tone="primary" size="lg" busy={operation === 'apply'} disabled={!testIsCurrent} onClick={apply}>
              Apply profile
            </Button>
          </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}

function ProfileCard({
  profile,
  selected,
  onUse,
  busy,
  disabled,
}: {
  profile: GenerationProfile;
  selected: boolean;
  onUse: () => void;
  busy: boolean;
  disabled: boolean;
}): JSX.Element {
  return (
    <article class={`profile-card${selected ? ' profile-card--selected' : ''}`}>
      <div class="profile-card__top">
        <span class="profile-monogram">{profile.label.slice(0, 2).toUpperCase()}</span>
        {selected && <Badge tone="gold">Studio default</Badge>}
      </div>
      <h3>{profile.label}</h3>
      <p>{profile.description || 'Independent first-shot generation profile.'}</p>
      <dl>
        <div><dt>Exact model</dt><dd>{profile.model_id}</dd></div>
        <div><dt>Effort</dt><dd>{profile.reasoning_effort || 'default'}</dd></div>
        <div><dt>Mode</dt><dd>{profile.orchestration}</dd></div>
      </dl>
      <Button size="sm" tone={selected ? 'quiet' : 'neutral'} busy={busy} disabled={selected || disabled} onClick={onUse}>
        {selected ? 'Studio default' : 'Use in Studio'}
      </Button>
    </article>
  );
}

export function GenerationSettingsScreen(): JSX.Element {
  const state = useAppState();
  const settings = state.bootstrap?.settings.generation;
  const agent = state.bootstrap?.settings.agent;
  const [operation, setOperation] = useState<
    { kind: 'default'; profileId: string } | { kind: 'sync' }
  >();
  const operationRef = useRef<typeof operation>(undefined);
  const [operationError, setOperationError] = useState<string>();
  if (!settings) return <EmptyState title="Generation settings unavailable" body="No generation settings were included in bootstrap." />;
  const syncTest = agent && currentSettingsTest(agent) ? agent.test : undefined;
  const canSync = Boolean(syncTest?.id);
  const locked = operation !== undefined;

  const begin = (next: NonNullable<typeof operation>): boolean => {
    if (operationRef.current) return false;
    operationRef.current = next;
    setOperation(next);
    return true;
  };
  const finish = (kind: NonNullable<typeof operation>['kind']): void => {
    if (operationRef.current?.kind !== kind) return;
    operationRef.current = undefined;
    setOperation(undefined);
  };

  const readback = async () => {
    const result = await bootstrapCoordinator.refresh();
    return result.snapshot;
  };
  const useProfile = async (profile: GenerationProfile) => {
    if (!begin({ kind: 'default', profileId: profile.id })) return;
    setOperationError(undefined);
    try {
      await api.setGenerationDefault(profile.id);
      const bootstrap = await readback();
      const confirmed = bootstrap.settings.generation.default_profile_id;
      if (confirmed !== profile.id) {
        throw new Error(`Readback returned ${confirmed || 'no default'} instead of ${profile.id}.`);
      }
      appStore.patch({ selectedProfileId: confirmed });
      appStore.toast(`${profile.label} is now the durable Studio default.`);
    } catch (error) {
      const message = errorText(error);
      setOperationError(message);
      appStore.toast(message, 'error');
    } finally {
      finish('default');
    }
  };
  const syncProfiles = async () => {
    if (!syncTest?.id || !begin({ kind: 'sync' })) return;
    setOperationError(undefined);
    try {
      await api.syncGenerationProfiles(syncTest.id);
      const bootstrap = await readback();
      const count = bootstrap.settings.generation.profiles.length;
      appStore.patch({
        selectedProfileId: bootstrap.settings.generation.default_profile_id
          || bootstrap.settings.generation.profiles[0]?.id,
      });
      appStore.toast(`Read back ${count} generation profile${count === 1 ? '' : 's'} from the tested connection.`);
    } catch (error) {
      const message = errorText(error);
      setOperationError(message);
      appStore.toast(message, 'error');
    } finally {
      finish('sync');
    }
  };
  return (
    <div class="settings-page">
      <section class="page-heading">
        <div>
          <div class="eyebrow">Generation</div>
          <h1>First-shot profiles</h1>
          <p>Profiles come from the authenticated catalog. They record exact model and effort, never a misleading slot name.</p>
        </div>
        <Badge tone="green">deterministic validator</Badge>
      </section>

      <Panel class="generation-contract">
        <div>
          <span class="contract-icon">K</span>
          <div>
            <strong>Prompt kernel</strong>
            <code>{settings.kernel_hash || 'unavailable'}</code>
            <small>{settings.kernel_fragments?.length || 0} technical-envelope fragments</small>
          </div>
        </div>
        <div>
          <span class="contract-icon">V</span>
          <div>
            <strong>Validator</strong>
            <code>{settings.validator_mode}</code>
            <small>No model-driven rewrite in the first-shot path</small>
          </div>
        </div>
        <div>
          <span class="contract-icon">N</span>
          <div>
            <strong>Best-of-N</strong>
            <code>1 / 2 / 4</code>
            <small>Independent generations, not serial mutation</small>
          </div>
        </div>
      </Panel>

      <Panel class="generation-sync">
        <div>
          <div class="eyebrow">Catalog → generation only</div>
          <strong>Sync profiles from tested connection</strong>
          <small>
            {canSync
              ? `Uses current passing test ${syncTest?.id}.`
              : 'Run a passing test for the current Agent draft first.'}
            {' '}This does not Apply or change the Producer Brain profile.
          </small>
        </div>
        <Button busy={operation?.kind === 'sync'} disabled={!canSync || locked} onClick={() => void syncProfiles()}>
          Sync profiles
        </Button>
      </Panel>

      {operationError && <p class="settings-operation-error inline-error" role="alert">{operationError}</p>}

      <div class="profiles-grid">
        {settings.profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            selected={settings.default_profile_id === profile.id}
            busy={operation?.kind === 'default' && operation.profileId === profile.id}
            disabled={locked}
            onUse={() => void useProfile(profile)}
          />
        ))}
        {settings.profiles.length === 0 && (
          <Panel><EmptyState title="No generation profiles" body="Discover models under Agent Settings before creating catalog-backed profiles." /></Panel>
        )}
      </div>

      <div class="settings-boundary">
        <Badge tone="blue">Boundary</Badge>
        <p>Composer profiles use the same direct CLIProxy topology, but changing the Music Brain profile does not silently change generation jobs already in flight.</p>
      </div>
    </div>
  );
}

export function SystemSettingsScreen(): JSX.Element {
  const state = useAppState();
  const system = state.bootstrap?.settings.system;
  if (!system) return <EmptyState title="System status unavailable" body="The runtime did not include its storage contract." />;
  const legacySnapshotAvailable = system.legacy_snapshot_available ?? system.legacy_routes_enabled ?? false;
  const legacyApiEnabled = system.legacy_api_enabled ?? false;
  const recoveryCandidates = system.recovery_candidates || [];
  const recoveryCandidateCount = system.recovery_candidate_count ?? recoveryCandidates.length;
  return (
    <div class="settings-page">
      <section class="page-heading">
        <div>
          <div class="eyebrow">Local runtime</div>
          <h1>System truth</h1>
          <p>Operational state is durable; immutable music assets remain readable on disk.</p>
        </div>
        <Badge tone={legacySnapshotAvailable ? 'amber' : 'green'}>
          {legacySnapshotAvailable ? 'frozen GUI available' : 'v3 live surface'}
        </Badge>
      </section>

      <div class="system-grid">
        <Panel>
          <PanelHeader title="Runtime" />
          <dl class="settings-facts settings-facts--large">
            <div><dt>API version</dt><dd><code>{system.api_version || 'v2'}</code></dd></div>
            <div><dt>Started</dt><dd>{formatDateTime(system.server_started_at)}</dd></div>
            <div><dt>Event cursor</dt><dd><code>{state.bootstrap?.cursor || 0}</code></dd></div>
            <div><dt>Connection</dt><dd><StatusDot tone={state.eventState === 'connected' ? 'green' : 'amber'} /> {state.eventState}</dd></div>
          </dl>
        </Panel>
        <Panel>
          <PanelHeader title="Storage" />
          <dl class="settings-facts settings-facts--large">
            <div><dt>Database</dt><dd><code>{system.database_path || 'runtime-managed'}</code></dd></div>
            <div><dt>Immutable assets</dt><dd><code>{system.asset_root || 'producer-brain/assets'}</code></dd></div>
            <div><dt>Scored pieces</dt><dd>{(state.bootstrap?.pieces || []).filter((piece) => typeof piece.active_revision.score === 'number').length}</dd></div>
            <div><dt>Recovery candidates</dt><dd>{recoveryCandidateCount}</dd></div>
          </dl>
        </Panel>
      </div>

      <Panel class="recovery-evidence-panel">
        <PanelHeader
          eyebrow="Read-only evidence"
          title={<>Recovery candidates <Badge tone="amber">{recoveryCandidateCount}</Badge></>}
          detail="Historical completed-task assets that require a human decision. They are not pieces and are not imported here."
        />
        <div class="recovery-evidence-list">
          {recoveryCandidates.map((candidate) => (
            <article key={`${candidate.task_id}:${candidate.source_line}`}>
              <div class="recovery-evidence__heading">
                <code>{candidate.task_id}</code>
                <span>source line {candidate.source_line}</span>
                {candidate.human_decision_required && <Badge tone="amber">Human decision</Badge>}
              </div>
              <dl>
                <div><dt>JS</dt><dd><code>{candidate.js}</code></dd></div>
                <div><dt>MP3</dt><dd><code>{candidate.mp3}</code></dd></div>
                <div><dt>Code SHA</dt><dd><code>{candidate.code_sha.slice(0, 12)}</code></dd></div>
                <div><dt>Audio SHA</dt><dd><code>{candidate.audio_sha.slice(0, 12)}</code></dd></div>
              </dl>
            </article>
          ))}
          {recoveryCandidates.length === 0 && (
            <EmptyState
              compact
              title={recoveryCandidateCount > 0 ? `${recoveryCandidateCount} candidates reported` : 'No recovery candidates'}
              body={recoveryCandidateCount > 0
                ? 'The runtime reported a count but did not expose the compact evidence rows in this snapshot.'
                : 'No completed legacy task assets currently require review.'}
            />
          )}
        </div>
      </Panel>

      <Panel class="migration-panel">
        <PanelHeader
          eyebrow="Readback"
          title="Migration ledger"
          detail="Legacy ambiguity remains labelled; it is never silently guessed away."
        />
        <div class="migration-list">
          {(system.migrations || []).map((migration) => (
            <div key={migration.id}>
              <StatusDot tone={migration.status === 'done' ? 'green' : migration.status === 'failed' ? 'red' : 'amber'} />
              <code>{migration.id}</code>
              <span>{migration.detail || migration.status}</span>
              <Badge tone={migration.status === 'done' ? 'green' : 'amber'}>{migration.status}</Badge>
            </div>
          ))}
          {(!system.migrations || system.migrations.length === 0) && (
            <EmptyState compact title="No migrations reported" body="The runtime has not exposed migration receipts in this snapshot." />
          )}
        </div>
      </Panel>

      <div class="settings-boundary">
        <Badge tone="gold">Human gate</Badge>
        <p>Recovery candidates and music acceptance stay human decisions. This page reports evidence only; it offers no import or score action.</p>
      </div>
      {legacySnapshotAvailable && (
        <div class="settings-boundary settings-boundary--legacy">
          <Badge tone="neutral">{legacyApiEnabled ? 'legacy API on' : 'legacy API off'}</Badge>
          <p>The pre-v3 GUI is preserved as a read-only recovery snapshot, not a second live control plane.</p>
          <a class="button button--neutral button--sm" href="/legacy/main" target="_blank" rel="noreferrer">
            Open frozen GUI ↗
          </a>
        </div>
      )}
    </div>
  );
}
