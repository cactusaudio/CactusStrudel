import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, ApiError } from '../api-client';
import type { Piece } from '../contracts';
import { appStore, useAppState } from '../store';
import { parseCommaTags } from '../state/invariants';
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  ProvenanceStrip,
  formatDateTime,
  formatDuration,
  provenanceEffortLabel,
} from '../components/ui';
import { PromptReceipt } from '../components/prompt-receipt';

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.detail || error.message;
  return error instanceof Error ? error.message : 'Library operation failed.';
}

type Filter = 'active' | 'archived' | 'all';

export function LibraryScreen(): JSX.Element {
  const state = useAppState();
  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [promotingId, setPromotingId] = useState<string>();
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [metadataName, setMetadataName] = useState('');
  const [metadataTags, setMetadataTags] = useState('');
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataError, setMetadataError] = useState<string>();
  const [receiptRevisionId, setReceiptRevisionId] = useState<string>();
  const all = state.bootstrap?.pieces || [];
  const pieces = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((piece) => {
      if (filter === 'active' && piece.archived) return false;
      if (filter === 'archived' && !piece.archived) return false;
      if (!needle) return true;
      return `${piece.name} ${piece.tags.join(' ')} ${piece.active_revision.provenance.model_id}`
        .toLowerCase()
        .includes(needle);
    });
  }, [all, filter, query]);
  const selected = pieces.find((piece) => piece.id === state.selectedPieceId);
  useEffect(() => {
    setEditingMetadata(false);
    setMetadataName(selected?.name || '');
    setMetadataTags(selected?.tags.join(', ') || '');
    setMetadataError(undefined);
    setReceiptRevisionId(undefined);
  }, [selected?.id]);

  const toggleArchive = async (piece: Piece) => {
    setBusyId(piece.id);
    try {
      const { piece: updated } = await api.patchPiece(piece.id, { archived: !piece.archived });
      appStore.upsertPiece(updated);
      appStore.toast(updated.archived ? 'Piece archived. It can be restored here.' : 'Piece restored to the active library.');
    } catch (error) {
      appStore.toast(messageOf(error), 'error');
    } finally {
      setBusyId(undefined);
    }
  };
  const promote = async (piece: Piece, revisionId: string) => {
    const intent = appStore.captureWorkspaceIntent();
    if (intent.pieceId !== piece.id) return;
    setPromotingId(revisionId);
    try {
      const { piece: updated } = await api.promoteRevision(piece.id, revisionId);
      const selected = appStore.applyPromotionResult(intent, updated, revisionId);
      appStore.toast(
        selected
          ? 'Preview promoted. A, score and Brain context now point to the committed audio.'
          : 'Preview promoted; the current audition and editor draft were left untouched.',
        selected ? 'ok' : 'warn',
      );
    } catch (error) {
      appStore.toast(messageOf(error), 'error');
    } finally {
      setPromotingId(undefined);
    }
  };
  const saveMetadata = async (piece: Piece) => {
    const targetPieceId = piece.id;
    const name = metadataName.trim();
    if (!name) {
      setMetadataError('Piece name cannot be empty.');
      return;
    }
    const tags = parseCommaTags(metadataTags);
    setMetadataSaving(true);
    setMetadataError(undefined);
    try {
      const { piece: updated } = await api.patchPiece(piece.id, { name, tags });
      appStore.upsertPiece(updated);
      if (appStore.getSnapshot().selectedPieceId === targetPieceId) {
        setMetadataName(updated.name);
        setMetadataTags(updated.tags.join(', '));
        setEditingMetadata(false);
      }
      appStore.toast(`Saved ${updated.name} and ${updated.tags.length} tag${updated.tags.length === 1 ? '' : 's'}.`);
    } catch (error) {
      const message = messageOf(error);
      if (appStore.getSnapshot().selectedPieceId === targetPieceId) {
        setMetadataError(message);
      } else {
        appStore.toast(`Saving metadata for ${piece.name} failed: ${message}`, 'error');
      }
    } finally {
      setMetadataSaving(false);
    }
  };
  const selectedIsCurrent = Boolean(selected && state.selectedPieceId === selected.id);
  const auditionSide = selectedIsCurrent ? state.compare.selected : 'a';
  const auditioned = selected && selectedIsCurrent
    ? auditionSide === 'b' && state.compare.b
      ? state.compare.b
      : state.compare.a || selected.active_revision
    : selected?.active_revision;

  return (
    <div class="page-grid page-grid--library">
      <section class="page-heading">
        <div>
          <div class="eyebrow">Corpus</div>
          <h1>Library</h1>
          <p>One list, one inspector, one audio engine. Every score stays attached to an exact render.</p>
        </div>
        <div class="page-heading__metric">
          <strong>{all.filter((piece) => !piece.archived).length}</strong>
          <span>active pieces</span>
        </div>
      </section>

      <Panel class="library-list">
        <div class="library-toolbar">
          <div class="segmented">
            {(['active', 'archived', 'all'] as const).map((item) => (
              <button key={item} class={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
                {item}
                <small>
                  {item === 'active'
                    ? all.filter((piece) => !piece.archived).length
                    : item === 'archived'
                      ? all.filter((piece) => piece.archived).length
                      : all.length}
                </small>
              </button>
            ))}
          </div>
          <label class="search-field">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              placeholder="Search name, tag, exact model…"
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        </div>

        <div class="library-table__head">
          <span>Piece</span>
          <span>Exact provenance</span>
          <span>Revision</span>
          <span>Score</span>
          <span>Created</span>
          <span />
        </div>
        <div class="library-table">
          {pieces.map((piece) => (
            <button
              key={piece.id}
              class={`library-line${selected?.id === piece.id ? ' library-line--selected' : ''}`}
              onClick={() => appStore.selectPiece(piece.id)}
            >
              <span class="library-line__name">
                <i>{piece.name.slice(0, 2).toUpperCase()}</i>
                <span>
                  <strong>{piece.name}</strong>
                  <small>
                    {formatDuration(piece.active_revision.duration_seconds)}
                  </small>
                </span>
              </span>
              <span>
                <strong>{piece.active_revision.provenance.model_id || 'legacy_unknown'}</strong>
                <small>{provenanceEffortLabel(piece.active_revision.provenance)} · {piece.active_revision.provenance.orchestration || 'standard'}</small>
              </span>
              <code>{piece.active_revision.id.slice(0, 10)}</code>
              <span class="table-score">
                {typeof piece.active_revision.score === 'number' ? piece.active_revision.score.toFixed(1) : '—'}
              </span>
              <time>{formatDateTime(piece.created_at)}</time>
              <span class="library-line__chev">›</span>
            </button>
          ))}
          {pieces.length === 0 && (
            <EmptyState
              title={query ? 'No matching pieces' : `No ${filter} pieces`}
              body={query ? 'Try a model ID, tag or shorter name.' : 'This view updates from the durable piece store.'}
            />
          )}
        </div>
      </Panel>

      <Panel class="library-inspector">
        {selected ? (
          <>
            <PanelHeader
              eyebrow={selected.archived ? 'Archived piece' : 'Selected piece'}
              title={selected.name}
              detail={<ProvenanceStrip provenance={(auditioned || selected.active_revision).provenance} />}
              actions={
                <>
                  <Button
                    size="sm"
                    disabled={metadataSaving}
                    onClick={() => {
                      setMetadataError(undefined);
                      setMetadataName(selected.name);
                      setMetadataTags(selected.tags.join(', '));
                      setEditingMetadata((value) => !value);
                    }}
                  >
                    {editingMetadata ? 'Cancel edit' : 'Edit name & tags'}
                  </Button>
                  <Button
                    size="sm"
                    busy={busyId === selected.id}
                    disabled={metadataSaving}
                    onClick={() => void toggleArchive(selected)}
                  >
                    {selected.archived ? 'Restore' : 'Archive'}
                  </Button>
                  <Button
                    size="sm"
                    tone="primary"
                    onClick={() => {
                      appStore.selectPiece(selected.id);
                      appStore.selectBrainJob(undefined);
                      window.history.pushState({}, '', '/studio');
                      appStore.setRoute('studio');
                    }}
                  >
                    Ask Brain
                  </Button>
                </>
              }
            />
            {editingMetadata
              ? (
                <form
                  class="library-metadata-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveMetadata(selected);
                  }}
                >
                  <label>
                    <span>Piece name</span>
                    <input
                      value={metadataName}
                      disabled={metadataSaving}
                      onInput={(event) => setMetadataName(event.currentTarget.value)}
                    />
                  </label>
                  <label>
                    <span>Tags <small>comma-separated</small></span>
                    <input
                      value={metadataTags}
                      disabled={metadataSaving}
                      placeholder="warehouse, dub"
                      onInput={(event) => setMetadataTags(event.currentTarget.value)}
                    />
                  </label>
                  {metadataError && <p class="inline-error" role="alert">{metadataError}</p>}
                  <div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingMetadata(false);
                        setMetadataError(undefined);
                        setMetadataName(selected.name);
                        setMetadataTags(selected.tags.join(', '));
                      }}
                    >
                      Cancel
                    </Button>
                    <Button tone="primary" size="sm" busy={metadataSaving} type="submit">Save metadata</Button>
                  </div>
                </form>
              )
              : (
                <div class="piece-tags" aria-label="Piece tags">
                  {selected.tags.length > 0
                    ? selected.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
                    : <span>No tags</span>}
                </div>
              )}
            <button
              class="inspector-play"
              onClick={() => appStore.selectRevision(selected.id, auditioned || selected.active_revision, auditionSide, true)}
            >
              <span>▶</span>
              <div>
                <strong>Listen to {auditionSide.toUpperCase()} in global transport</strong>
                <small>{formatDuration(auditioned?.duration_seconds)} · {auditioned?.audio_sha.slice(0, 12)}</small>
              </div>
            </button>

            <dl class="inspector-facts">
              <div><dt>Active revision</dt><dd><code>{selected.active_revision.id}</code></dd></div>
              <div><dt>Auditioning</dt><dd><code>{auditionSide.toUpperCase()} · {auditioned?.id}</code></dd></div>
              <div><dt>Audio SHA</dt><dd><code>{auditioned?.audio_sha}</code></dd></div>
              <div><dt>Route</dt><dd>{auditioned?.provenance.route || 'legacy_unknown'}</dd></div>
              <div><dt>Validator</dt><dd>{auditioned?.provenance.validator_mode || 'unknown'}</dd></div>
              <div><dt>Library state</dt><dd>{selected.archived ? 'archived' : 'active'}</dd></div>
            </dl>

            <div class="inspector-section">
              <h3>Revision history <Badge>{selected.revisions.length}</Badge></h3>
              <div class="revision-list">
                {selected.revisions.map((revision) => {
                  const isA = selectedIsCurrent && state.compare.a?.id === revision.id;
                  const isB = selectedIsCurrent && state.compare.b?.id === revision.id;
                  const side = isB ? 'b' : isA ? 'a' : revision.preview && !revision.promoted ? 'b' : 'a';
                  const receiptOpen = receiptRevisionId === revision.id;
                  return (
                  <div
                    key={revision.id}
                    class={`revision-row${revision.id === selected.active_revision_id ? ' active' : ''}${isA ? ' revision-row--a' : ''}${isB ? ' revision-row--b' : ''}`}
                  >
                    <button
                      class="revision-row__main"
                      onClick={() => appStore.selectRevision(selected.id, revision, side, true)}
                    >
                      <span class="revision-list__dot" />
                      <span>
                        <strong>{revision.label || (revision.preview ? 'Preview' : 'Committed revision')}</strong>
                        <small>{formatDateTime(revision.created_at)} · {revision.audio_sha.slice(0, 8)}</small>
                      </span>
                      <span class="table-score">{typeof revision.score === 'number' ? revision.score.toFixed(1) : '—'}</span>
                    </button>
                    <div class="revision-row__actions">
                      <button
                        class={isA ? 'active' : ''}
                        title="Use this exact revision as A"
                        onClick={() => appStore.selectRevision(selected.id, revision, 'a', false)}
                      >
                        A
                      </button>
                      <button
                        class={isB ? 'active' : ''}
                        title="Use this exact revision as B"
                        disabled={isA}
                        onClick={() => appStore.selectRevision(selected.id, revision, 'b', false)}
                      >
                        B
                      </button>
                      {revision.preview && !revision.promoted && (
                        <Button
                          tone="primary"
                          size="sm"
                          busy={promotingId === revision.id}
                          onClick={() => void promote(selected, revision.id)}
                        >
                          Promote
                        </Button>
                      )}
                      <Button
                        size="sm"
                        tone={receiptOpen ? 'quiet' : 'neutral'}
                        onClick={() => setReceiptRevisionId(receiptOpen ? undefined : revision.id)}
                      >
                        {receiptOpen ? 'Close' : 'Receipt'}
                      </Button>
                    </div>
                    {receiptOpen && (
                      <div class="revision-row__receipt">
                        <PromptReceipt revision={revision} compact />
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title={pieces.length > 0 ? 'No visible selection' : 'Nothing selected'}
            body={pieces.length > 0
              ? 'Choose a visible piece. Filters never change the global audition or discard an editor draft.'
              : 'Choose a piece to inspect its immutable revisions and receipts.'}
          />
        )}
      </Panel>
    </div>
  );
}
