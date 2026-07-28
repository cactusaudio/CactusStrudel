import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { api, ApiError } from '../api-client';
import type { BrainJob, GenerationJob } from '../contracts';
import { appStore, useAppState } from '../store';
import { isCancellableJobState } from '../state/invariants';
import {
  ActivityIcon,
  Badge,
  Button,
  EmptyState,
  Panel,
  StateBadge,
  formatDateTime,
} from '../components/ui';

function activityError(error: unknown): string {
  if (error instanceof ApiError) return error.detail || error.message;
  return error instanceof Error ? error.message : 'Cancellation did not complete.';
}

function ActiveOperation({
  kind,
  job,
  busy,
  error,
  onCancel,
}: {
  kind: 'generation' | 'brain';
  job: GenerationJob | BrainJob;
  busy: boolean;
  error?: string;
  onCancel: () => void;
}): JSX.Element {
  const generation = kind === 'generation' ? job as GenerationJob : undefined;
  const detail = generation
    ? `${generation.completed_count}/${generation.count} committed · ${generation.stage || 'waiting for durable progress'}`
    : `${(job as BrainJob).messages.length} messages · context ${(job as BrainJob).revision_id?.slice(0, 10) || 'unpinned'}`;
  const cancelling = job.state === 'cancelling';
  return (
    <article class="active-operation">
      <div class={`active-operation__mark active-operation__mark--${kind}`}>
        {kind === 'generation' ? 'G' : 'B'}
      </div>
      <div>
        <span>{kind === 'generation' ? 'Generation job' : 'Brain job'}</span>
        <strong><code>{job.id}</code> <StateBadge state={job.state} /></strong>
        <small>{detail}</small>
        {error && <p class="inline-error" role="alert">{error}</p>}
      </div>
      <Button
        tone="danger"
        size="sm"
        busy={busy || cancelling}
        onClick={onCancel}
      >
        {cancelling ? 'Cancelling' : 'Cancel'}
      </Button>
    </article>
  );
}

export function ActivityScreen(): JSX.Element {
  const state = useAppState();
  const [filter, setFilter] = useState('all');
  const [cancelBusy, setCancelBusy] = useState<Record<string, boolean>>({});
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});
  const events = state.bootstrap?.activity || [];
  const categories = useMemo(
    () => Array.from(new Set(events.map((event) => event.kind.split('.')[0] || 'other'))),
    [events],
  );
  const visible = filter === 'all'
    ? events
    : events.filter((event) => event.kind.startsWith(`${filter}.`) || event.kind === filter);
  const jobs = state.bootstrap?.jobs || [];
  const brainJobs = state.bootstrap?.brain_jobs || [];
  const activeJobs = jobs.filter((job) => isCancellableJobState(job.state));
  const activeBrainJobs = brainJobs.filter((job) => isCancellableJobState(job.state));

  const cancel = async (kind: 'generation' | 'brain', id: string) => {
    const key = `${kind}:${id}`;
    setCancelBusy((current) => ({ ...current, [key]: true }));
    setCancelErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      if (kind === 'generation') {
        const { job } = await api.cancelJob(id);
        appStore.upsertJob(job);
      } else {
        const { job } = await api.cancelBrainJob(id);
        appStore.upsertBrainJob(job);
      }
    } catch (error) {
      const message = activityError(error);
      setCancelErrors((current) => ({ ...current, [key]: message }));
      appStore.toast(message, 'error');
    } finally {
      setCancelBusy((current) => ({ ...current, [key]: false }));
    }
  };

  return (
    <div class="activity-page">
      <section class="page-heading">
        <div>
          <div class="eyebrow">Durable operation truth</div>
          <h1>Activity</h1>
          <p>Refresh-safe jobs, receipts and honest cancellation state. SSE is only the observer.</p>
        </div>
        <div class="connection-chip">
          <span class={`live-pulse${state.eventState !== 'connected' ? ' live-pulse--amber' : ''}`} />
          {state.eventState === 'connected' ? 'Live events connected' : 'Reconnecting from cursor'}
          <code>{state.bootstrap?.cursor || 0}</code>
        </div>
      </section>

      <div class="activity-summary">
        <Panel><span>Generation jobs</span><strong>{jobs.length}</strong><small>{jobs.filter((job) => job.state === 'running').length} running</small></Panel>
        <Panel><span>Brain jobs</span><strong>{brainJobs.length}</strong><small>{brainJobs.filter((job) => job.state === 'running').length} running</small></Panel>
        <Panel><span>Committed receipts</span><strong>{[...jobs, ...brainJobs].filter((job) => job.receipt).length}</strong><small>readable here</small></Panel>
        <Panel><span>Event cursor</span><strong>{state.bootstrap?.cursor || 0}</strong><small>monotonic</small></Panel>
      </div>

      {(activeJobs.length > 0 || activeBrainJobs.length > 0) && (
        <Panel class="active-operations">
          <div class="active-operations__heading">
            <div>
              <span class="eyebrow">Mutable now</span>
              <h2>Active operations</h2>
            </div>
            <Badge tone="blue">{activeJobs.length + activeBrainJobs.length} active</Badge>
          </div>
          <div class="active-operations__list">
            {activeJobs.map((job) => {
              const key = `generation:${job.id}`;
              return (
                <ActiveOperation
                  key={key}
                  kind="generation"
                  job={job}
                  busy={Boolean(cancelBusy[key])}
                  error={cancelErrors[key]}
                  onCancel={() => void cancel('generation', job.id)}
                />
              );
            })}
            {activeBrainJobs.map((job) => {
              const key = `brain:${job.id}`;
              return (
                <ActiveOperation
                  key={key}
                  kind="brain"
                  job={job}
                  busy={Boolean(cancelBusy[key])}
                  error={cancelErrors[key]}
                  onCancel={() => void cancel('brain', job.id)}
                />
              );
            })}
          </div>
        </Panel>
      )}

      <Panel class="activity-ledger">
        <div class="activity-filter">
          <span>Timeline</span>
          <div class="segmented segmented--compact">
            {['all', ...categories].map((item) => (
              <button key={item} class={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
        <div class="timeline">
          {visible.map((event) => (
            <article class="timeline-event" key={`${event.seq}-${event.id}`}>
              <ActivityIcon event={event} />
              <div class="timeline-event__copy">
                <div>
                  <strong>{event.title}</strong>
                  <Badge>{event.kind}</Badge>
                </div>
                {event.detail && <p>{event.detail}</p>}
                <small>
                  seq {event.seq}
                  {event.job_id && <> · job <code>{event.job_id.slice(0, 12)}</code></>}
                  {event.piece_id && <> · piece <code>{event.piece_id.slice(0, 12)}</code></>}
                </small>
              </div>
              <time>{formatDateTime(event.at)}</time>
            </article>
          ))}
          {visible.length === 0 && (
            <EmptyState title="No matching activity" body="The durable event ledger is empty for this category." />
          )}
        </div>
      </Panel>

      <Panel class="job-receipt-grid">
        <div class="job-receipt-grid__heading">Latest terminal states</div>
        {[...jobs, ...brainJobs].filter((job) => !['queued', 'running', 'cancelling'].includes(job.state)).slice(0, 8).map((job) => (
          <div class="job-receipt-card" key={job.id}>
            <div><code>{job.id.slice(0, 14)}</code><StateBadge state={job.state} /></div>
            <small>{formatDateTime(job.updated_at || job.created_at)}</small>
            {job.receipt ? <p>{job.receipt.summary}</p> : <p class="muted">No mutation receipt attached.</p>}
          </div>
        ))}
      </Panel>
    </div>
  );
}
