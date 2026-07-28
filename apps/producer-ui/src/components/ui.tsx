import type { ComponentChildren, JSX } from 'preact';
import type { ActivityEvent, JobState, LoadState, OperationReceipt, Provenance } from '../contracts';

export function Button({
  children,
  tone = 'neutral',
  size = 'md',
  busy = false,
  class: className = '',
  type = 'button',
  ...props
}: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'neutral' | 'primary' | 'danger' | 'quiet';
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
}): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      class={`button button--${tone} button--${size} ${className}`}
      disabled={props.disabled || busy}
    >
      {busy && <span class="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ComponentChildren;
  tone?: 'neutral' | 'gold' | 'green' | 'red' | 'blue' | 'amber';
}): JSX.Element {
  return <span class={`badge badge--${tone}`}>{children}</span>;
}

export function StateBadge({ state }: { state: JobState | string }): JSX.Element {
  const tone = state === 'done'
    ? 'green'
    : state === 'failed'
      ? 'red'
      : state.includes('cancel')
        ? 'neutral'
        : state === 'running' || state === 'waiting_for_tool'
          ? 'blue'
          : 'amber';
  return <Badge tone={tone}>{state.replaceAll('_', ' ')}</Badge>;
}

export function StatusDot({
  tone = 'muted',
  pulse = false,
}: {
  tone?: 'green' | 'amber' | 'red' | 'blue' | 'muted';
  pulse?: boolean;
}): JSX.Element {
  return <span class={`status-dot status-dot--${tone}${pulse ? ' status-dot--pulse' : ''}`} aria-hidden="true" />;
}

export function Panel({
  children,
  class: className = '',
  as: Tag = 'section',
}: {
  children: ComponentChildren;
  class?: string;
  as?: keyof JSX.IntrinsicElements;
}): JSX.Element {
  return <Tag class={`panel ${className}`}>{children}</Tag>;
}

export function PanelHeader({
  eyebrow,
  title,
  detail,
  actions,
}: {
  eyebrow?: string;
  title: ComponentChildren;
  detail?: ComponentChildren;
  actions?: ComponentChildren;
}): JSX.Element {
  return (
    <header class="panel-header">
      <div class="panel-header__copy">
        {eyebrow && <div class="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
        {detail && <div class="panel-header__detail">{detail}</div>}
      </div>
      {actions && <div class="panel-header__actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  title,
  body,
  action,
  compact = false,
}: {
  title: string;
  body: string;
  action?: ComponentChildren;
  compact?: boolean;
}): JSX.Element {
  return (
    <div class={`empty-state${compact ? ' empty-state--compact' : ''}`}>
      <div class="empty-state__mark" aria-hidden="true">◌</div>
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function OutcomeUnknownNotice({
  title,
  body,
  retryLabel,
  newIntentLabel,
  busy = false,
  onRetry,
  onStartNew,
}: {
  title: string;
  body: string;
  retryLabel: string;
  newIntentLabel: string;
  busy?: boolean;
  onRetry: () => void;
  onStartNew: () => void;
}): JSX.Element {
  return (
    <div class="outcome-unknown" role="status">
      <div>
        <strong>{title}</strong>
        <small>{body}</small>
      </div>
      <div class="outcome-unknown__actions">
        <Button size="sm" busy={busy} onClick={onRetry}>{retryLabel}</Button>
        <Button tone="quiet" size="sm" disabled={busy} onClick={onStartNew}>
          {newIntentLabel}
        </Button>
      </div>
    </div>
  );
}

export function LoadingState({
  state,
  error,
  onRetry,
}: {
  state: LoadState;
  error?: string;
  onRetry?: () => void;
}): JSX.Element | null {
  if (state === 'loading' || state === 'idle') {
    return (
      <div class="loading-stage" aria-live="polite">
        <div class="loading-orbit"><span /><span /><span /></div>
        <div>
          <strong>Opening the producer room</strong>
          <span>Reading pieces, durable jobs and the active brain profile.</span>
        </div>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div class="loading-stage loading-stage--error" role="alert">
        <div class="empty-state__mark">!</div>
        <div>
          <strong>Producer runtime is unavailable</strong>
          <span>{error || 'The local runtime did not return a bootstrap snapshot.'}</span>
          {onRetry && <Button onClick={onRetry}>Retry connection</Button>}
        </div>
      </div>
    );
  }
  return null;
}

export function ScoreMeter({
  value,
  onChange,
  disabled = false,
}: {
  value?: number | null;
  onChange: (score: number) => void;
  disabled?: boolean;
}): JSX.Element {
  const current = typeof value === 'number' ? value : undefined;
  return (
    <div class="score-meter" aria-label="Human score out of ten">
      <div class="score-meter__number">
        {current === undefined ? <span>—</span> : current.toFixed(1)}
        <small>/10</small>
      </div>
      <input
        type="range"
        min="0"
        max="10"
        step="0.1"
        value={current ?? 5}
        disabled={disabled}
        aria-label="Score"
        onInput={(event) => onChange(Number((event.currentTarget as HTMLInputElement).value))}
      />
      <div class="score-meter__ticks"><span>0</span><span>human ear</span><span>10</span></div>
    </div>
  );
}

export function ProvenanceStrip({ provenance }: { provenance: Provenance }): JSX.Element {
  return (
    <div class="provenance-strip" title="Exact generation provenance">
      <span>{provenance.model_id || 'legacy unknown'}</span>
      {provenance.reasoning_effort && <i>·</i>}
      {provenance.reasoning_effort && <span>{provenance.reasoning_effort}</span>}
      {provenance.orchestration && <i>·</i>}
      {provenance.orchestration && <span>{provenance.orchestration}</span>}
      {provenance.kernel_hash && <i>·</i>}
      {provenance.kernel_hash && <code>k:{provenance.kernel_hash.slice(0, 8)}</code>}
      {provenance.legacy && <Badge tone="neutral">legacy</Badge>}
    </div>
  );
}

export function provenanceEffortLabel(provenance: Provenance): string {
  if (provenance.reasoning_effort) return provenance.reasoning_effort;
  return provenance.legacy || provenance.model_id === 'legacy_unknown'
    ? 'unknown'
    : 'default';
}

export function Receipt({ receipt }: { receipt: OperationReceipt }): JSX.Element {
  return (
    <details class="receipt">
      <summary>
        <StatusDot tone={receipt.status === 'done' || receipt.status === 'ok' ? 'green' : 'amber'} />
        <span>{receipt.summary}</span>
        <code>{receipt.id.slice(0, 10)}</code>
      </summary>
      <dl>
        <div><dt>Operation</dt><dd>{receipt.kind}</dd></div>
        <div><dt>Status</dt><dd>{receipt.status}</dd></div>
        <div><dt>Committed</dt><dd>{formatDateTime(receipt.at)}</dd></div>
        {receipt.details && Object.entries(receipt.details).map(([key, value]) => (
          <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{formatReceiptValue(value)}</dd></div>
        ))}
      </dl>
    </details>
  );
}

export function ActivityIcon({ event }: { event: ActivityEvent }): JSX.Element {
  const tone = event.status === 'error'
    ? 'red'
    : event.status === 'warn'
      ? 'amber'
      : event.status === 'ok'
        ? 'green'
        : 'blue';
  return <span class={`activity-icon activity-icon--${tone}`}>{event.kind.split('.')[0]?.slice(0, 1).toUpperCase()}</span>;
}

export function formatDateTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '—:——';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

function formatReceiptValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unreadable value]';
    }
  }
  return String(value);
}
