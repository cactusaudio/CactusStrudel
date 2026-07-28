import type { JSX } from 'preact';
import type { PieceRevision } from '../contracts';
import { Badge, EmptyState } from './ui';

export function PromptReceipt({
  revision,
  compact = false,
}: {
  revision: PieceRevision;
  compact?: boolean;
}): JSX.Element {
  const summary = revision.prompt_summary;
  const available = Boolean(summary || revision.prompt_url || revision.receipt_url);
  if (!available) {
    return (
      <div class={`prompt-receipt${compact ? ' prompt-receipt--compact' : ''}`}>
        <EmptyState
          compact
          title="Prompt receipt unavailable"
          body="This revision predates prompt receipts. No compiled prompt was copied into bootstrap."
        />
      </div>
    );
  }

  return (
    <div class={`prompt-receipt${compact ? ' prompt-receipt--compact' : ''}`}>
      <header>
        <div>
          <Badge tone="blue">Prompt receipt</Badge>
          <code>{revision.id}</code>
        </div>
        <code>{summary?.kernel_hash || revision.provenance.kernel_hash || 'kernel unknown'}</code>
      </header>
      <p>
        {summary?.producer_brief
          || (summary?.legacy_name ? `Legacy prompt: ${summary.legacy_name}` : undefined)
          || 'A durable receipt exists for this exact revision.'}
      </p>
      {summary && (
        <dl class="prompt-receipt__summary">
          <div><dt>Mode</dt><dd>{summary.mode || 'unknown'}</dd></div>
          <div><dt>Model</dt><dd>{summary.model_id || revision.provenance.model_id || 'unknown'}</dd></div>
          {summary.legacy_name && <div><dt>Legacy name</dt><dd>{summary.legacy_name}</dd></div>}
        </dl>
      )}
      <div class="prompt-receipt__links">
        {revision.prompt_url && (
          <a href={revision.prompt_url} target="_blank" rel="noreferrer">
            Open prompt source ↗
          </a>
        )}
        {revision.receipt_url
          ? (
            <a href={revision.receipt_url} target="_blank" rel="noreferrer">
              Raw JSON receipt ↗
            </a>
          )
          : <span>Raw JSON receipt unavailable</span>}
      </div>
    </div>
  );
}
