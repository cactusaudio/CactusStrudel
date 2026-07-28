import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  api,
  ApiError,
  createMutationIntent,
  MutationOutcomeUnknownError,
  type MutationIntent,
} from '../api-client';
import type {
  BrainJob,
  BrainJobInput,
  GenerationJob,
  GenerationJobInput,
  Piece,
  PieceRevision,
  PreviewInput,
  ScoreInput,
} from '../contracts';
import { appStore, useAppState, type WorkspaceIntent } from '../store';
import { agentProfileReady, brainJobMatchesContext } from '../state/invariants';
import {
  Badge,
  Button,
  EmptyState,
  OutcomeUnknownNotice,
  Panel,
  PanelHeader,
  ProvenanceStrip,
  Receipt,
  ScoreMeter,
  StateBadge,
  clampScore,
  formatDateTime,
  formatDuration,
} from '../components/ui';
import { PromptReceipt } from '../components/prompt-receipt';

function humanError(error: unknown): string {
  if (error instanceof ApiError) return error.detail || error.message;
  return error instanceof Error ? error.message : 'The operation did not complete.';
}

function compactJobError(error: string): string {
  const normalized = error.replace(/\s+/g, ' ').trim();
  return normalized.length > 260 ? `${normalized.slice(0, 257)}…` : normalized;
}

function PieceRow({ piece, selected }: { piece: Piece; selected: boolean }): JSX.Element {
  const revision = piece.active_revision;
  return (
    <button
      class={`piece-row${selected ? ' piece-row--selected' : ''}`}
      onClick={() => appStore.selectPiece(piece.id)}
    >
      <span class="piece-row__score">
        {typeof revision.score === 'number' ? revision.score.toFixed(1) : '—'}
      </span>
      <span class="piece-row__copy">
        <strong>{piece.name}</strong>
        <small>
          {revision.provenance.model_id || 'legacy unknown'}
          <i>·</i>
          {formatDateTime(piece.created_at)}
        </small>
      </span>
      <span class="piece-row__duration">{formatDuration(revision.duration_seconds)}</span>
    </button>
  );
}

interface GenerationSubmission {
  intent: MutationIntent;
  input: GenerationJobInput;
  composerValue: string;
}

function GenerationPanel(): JSX.Element {
  const state = useAppState();
  const [submitting, setSubmitting] = useState(false);
  const [unknownGeneration, setUnknownGeneration] = useState<GenerationSubmission>();
  const submittingRef = useRef(false);
  const profiles = state.bootstrap?.settings.generation.profiles || [];
  const activeJobs = (state.bootstrap?.jobs || []).filter((job) =>
    ['queued', 'running', 'cancelling'].includes(job.state),
  );

  const submitGeneration = async (submission: GenerationSubmission) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const { job } = await api.createGenerationJob(submission.input, submission.intent);
      setUnknownGeneration((current) => (
        current?.intent.idempotencyKey === submission.intent.idempotencyKey ? undefined : current
      ));
      appStore.upsertJob(job);
      if (appStore.getSnapshot().generationPrompt === submission.composerValue) {
        appStore.patch({ generationPrompt: '' });
      }
      appStore.toast(`${job.count} first-shot${job.count > 1 ? 's' : ''} queued.`);
    } catch (error) {
      if (error instanceof MutationOutcomeUnknownError) {
        setUnknownGeneration(submission);
        appStore.toast(
          'Generation outcome is unknown. Reconcile the exact brief, profile and count with the same operation key.',
          'warn',
        );
      } else {
        setUnknownGeneration((current) => (
          current?.intent.idempotencyKey === submission.intent.idempotencyKey ? undefined : current
        ));
        appStore.toast(humanError(error), 'error');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const generate = () => {
    if (!state.selectedProfileId || unknownGeneration) return;
    void submitGeneration({
      intent: createMutationIntent(),
      composerValue: state.generationPrompt,
      input: {
        count: state.generationCount,
        prompt: state.generationPrompt.trim(),
        profile_id: state.selectedProfileId,
      },
    });
  };

  return (
    <Panel class="generation-card">
      <PanelHeader
        eyebrow="Generate"
        title="Fresh first shots"
        detail="Best-of-N creates independent pieces. It never rewrites the one you are judging."
      />
      <label class="field">
        <span>Producer brief <small>optional</small></span>
        <textarea
          rows={4}
          value={state.generationPrompt}
          placeholder="A slow-burning warehouse track with a fragile melodic center…"
          onInput={(event) => appStore.patch({ generationPrompt: event.currentTarget.value })}
        />
      </label>
      <label class="field">
        <span>Generation profile</span>
        <select
          value={state.selectedProfileId}
          onChange={(event) => appStore.patch({ selectedProfileId: event.currentTarget.value })}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label} · {profile.model_id} · {profile.reasoning_effort || 'default'}
            </option>
          ))}
        </select>
      </label>
      {unknownGeneration && (
        <OutcomeUnknownNotice
          title="Generation response unknown"
          body={`Best-of-${unknownGeneration.input.count} with ${unknownGeneration.input.profile_id || 'the captured profile'} may already own a durable batch.`}
          retryLabel="Reconcile generation"
          newIntentLabel="Abandon and use current brief"
          busy={submitting}
          onRetry={() => void submitGeneration(unknownGeneration)}
          onStartNew={() => setUnknownGeneration(undefined)}
        />
      )}
      <div class="generation-card__foot">
        <div class="segmented" aria-label="Number of independent first shots">
          {([1, 2, 4] as const).map((count) => (
            <button
              key={count}
              class={state.generationCount === count ? 'active' : ''}
              onClick={() => appStore.patch({ generationCount: count })}
              title={`${count} independent first-shot${count > 1 ? 's' : ''}`}
            >
              {count === 1 ? 'One' : `Best of ${count}`}
            </button>
          ))}
        </div>
        <Button
          tone="primary"
          size="lg"
          busy={submitting}
          disabled={!state.selectedProfileId || Boolean(unknownGeneration)}
          onClick={generate}
        >
          Generate <span aria-hidden="true">↗</span>
        </Button>
      </div>
      {activeJobs.length > 0 && (
        <div class="generation-card__active">
          <span class="live-pulse" />
          {activeJobs.length} durable job{activeJobs.length > 1 ? 's' : ''} will continue through refresh.
        </div>
      )}
    </Panel>
  );
}

function JobRow({ job }: { job: GenerationJob }): JSX.Element {
  const [cancelling, setCancelling] = useState(false);
  const cancellable = ['queued', 'running'].includes(job.state);
  const cancel = async () => {
    setCancelling(true);
    try {
      const { job: updated } = await api.cancelJob(job.id);
      appStore.upsertJob(updated);
    } catch (error) {
      appStore.toast(humanError(error), 'error');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div class="job-row">
      <div class="job-row__rail">
        <span style={{ height: `${Math.max(5, Math.min(100, (job.progress || 0) * 100))}%` }} />
      </div>
      <div class="job-row__body">
        <div>
          <strong>{job.stage || (job.count > 1 ? `Best-of-${job.count}` : 'First shot')}</strong>
          <StateBadge state={job.state} />
        </div>
        <small>
          {job.completed_count}/{job.count} committed
          <i>·</i>
          {formatDateTime(job.created_at)}
        </small>
        {job.error && (
          <p class="inline-error" title={job.error}>{compactJobError(job.error)}</p>
        )}
        {job.receipt && <Receipt receipt={job.receipt} />}
      </div>
      {cancellable && (
        <Button tone="quiet" size="sm" busy={cancelling} onClick={cancel}>Cancel</Button>
      )}
    </div>
  );
}

function StudioRail(): JSX.Element {
  const state = useAppState();
  const [jobOpen, setJobOpen] = useState(true);
  const pieces = (state.bootstrap?.pieces || []).filter((piece) => !piece.archived).slice(0, 18);
  const jobs = (state.bootstrap?.jobs || []).slice(0, 6);
  return (
    <aside class="studio-rail">
      <GenerationPanel />
      <Panel class="jobs-panel">
        <button class="section-toggle" onClick={() => setJobOpen(!jobOpen)}>
          <span>Jobs</span>
          <Badge tone={jobs.some((job) => ['running', 'queued'].includes(job.state)) ? 'blue' : 'neutral'}>
            {jobs.filter((job) => ['running', 'queued'].includes(job.state)).length} active
          </Badge>
          <i>{jobOpen ? '−' : '+'}</i>
        </button>
        {jobOpen && (
          <div class="jobs-list">
            {jobs.length > 0
              ? jobs.map((job) => <JobRow key={job.id} job={job} />)
              : <EmptyState compact title="No jobs yet" body="Your next generation will appear here." />}
          </div>
        )}
      </Panel>
      <Panel class="recent-panel">
        <div class="section-toggle section-toggle--static">
          <span>Recent pieces</span>
          <Badge>{pieces.length}</Badge>
        </div>
        <div class="piece-list">
          {pieces.length > 0
            ? pieces.map((piece) => (
              <PieceRow key={piece.id} piece={piece} selected={piece.id === state.selectedPieceId} />
            ))
            : <EmptyState compact title="The room is quiet" body="Generate a first shot to begin the corpus." />}
        </div>
      </Panel>
    </aside>
  );
}

interface PreviewSubmission {
  intent: MutationIntent;
  workspace: WorkspaceIntent;
  pieceId: string;
  input: PreviewInput;
}

function CodeWorkspace({ piece }: { piece: Piece }): JSX.Element {
  const state = useAppState();
  const [workspaceTab, setWorkspaceTab] = useState<'code' | 'prompt'>('code');
  const [previewing, setPreviewing] = useState(false);
  const [unknownPreview, setUnknownPreview] = useState<PreviewSubmission>();
  const [promoting, setPromoting] = useState(false);
  const [copied, setCopied] = useState(false);
  const previewingRef = useRef(false);
  const lineRailRef = useRef<HTMLDivElement>(null);
  const b = state.compare.b;
  const editorRevision = state.compare.a || piece.active_revision;
  const auditioningB = state.compare.selected === 'b' && Boolean(b);
  const receiptRevision = auditioningB && b
    ? b
    : editorRevision;

  const submitPreview = async (submission: PreviewSubmission) => {
    if (previewingRef.current) return;
    previewingRef.current = true;
    setPreviewing(true);
    try {
      const { revision, piece: durablePiece } = await api.createPreview(
        submission.pieceId,
        submission.input,
        submission.intent,
      );
      setUnknownPreview((current) => (
        current?.intent.idempotencyKey === submission.intent.idempotencyKey ? undefined : current
      ));
      const selected = appStore.applyPreviewResult(submission.workspace, durablePiece, revision);
      appStore.toast(
        selected
          ? 'Preview B rendered. A is still the committed version.'
          : 'Preview completed in the background and was added to revision history.',
        selected ? 'ok' : 'warn',
      );
    } catch (error) {
      if (error instanceof MutationOutcomeUnknownError) {
        setUnknownPreview(submission);
        appStore.toast(
          'Preview outcome is unknown. Reconcile the exact code and source revision with the same operation key.',
          'warn',
        );
      } else {
        setUnknownPreview((current) => (
          current?.intent.idempotencyKey === submission.intent.idempotencyKey ? undefined : current
        ));
        appStore.toast(humanError(error), 'error');
      }
    } finally {
      previewingRef.current = false;
      setPreviewing(false);
    }
  };

  const preview = () => {
    const workspace = appStore.captureWorkspaceIntent();
    if (!workspace.pieceId || !workspace.aRevisionId || workspace.pieceId !== piece.id) return;
    void submitPreview({
      intent: createMutationIntent(),
      workspace,
      pieceId: piece.id,
      input: {
        code: workspace.editorCode,
        source_revision_id: workspace.aRevisionId,
        intent: 'manual code preview',
      },
    });
  };
  const promote = async () => {
    if (!b) return;
    const intent = appStore.captureWorkspaceIntent();
    if (intent.pieceId !== piece.id || intent.bRevisionId !== b.id) return;
    setPromoting(true);
    try {
      const { piece: updated } = await api.promoteRevision(piece.id, b.id);
      const selected = appStore.applyPromotionResult(intent, updated, b.id);
      appStore.toast(
        selected
          ? 'Preview promoted as a new committed revision.'
          : 'Promotion completed in the background; your current workspace was left untouched.',
        selected ? 'ok' : 'warn',
      );
    } catch (error) {
      appStore.toast(humanError(error), 'error');
    } finally {
      setPromoting(false);
    }
  };
  const external = async () => {
    // Open inside the click activation before awaiting Clipboard permission.
    window.open('https://strudel.cc/', '_blank', 'noopener,noreferrer');
    try {
      await navigator.clipboard.writeText(state.editorCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Opening still works; the UI truthfully does not claim a copy.
    }
  };

  return (
    <div class="code-workspace">
      <div class="workspace-toolbar">
        <div class="editor-tabs">
          <button
            class={workspaceTab === 'code' ? 'active' : ''}
            onClick={() => setWorkspaceTab('code')}
          >
            Code
          </button>
          <button
            class={workspaceTab === 'prompt' ? 'active' : ''}
            onClick={() => setWorkspaceTab('prompt')}
          >
            Prompt receipt
          </button>
        </div>
        {workspaceTab === 'code'
          ? (
            <>
              <div class="workspace-toolbar__identity">
                <strong>Editing {state.editorDirty ? 'A draft' : 'A'}</strong>
                <i>·</i>
                <span>{auditioningB ? 'Auditioning B' : 'Auditioning A'}</span>
              </div>
              <div class="workspace-toolbar__actions">
                <Button size="sm" onClick={external}>
                  {copied
                    ? `Copied ${state.editorDirty ? 'A draft' : 'A code'} · DAW opened`
                    : `Copy ${state.editorDirty ? 'A draft' : 'A code'} & open DAW ↗`}
                </Button>
                <Button
                  tone="primary"
                  size="sm"
                  busy={previewing}
                  disabled={!state.editorDirty || Boolean(unknownPreview)}
                  onClick={preview}
                >
                  Render preview B
                </Button>
              </div>
            </>
          )
          : <Badge tone="blue">{state.compare.selected.toUpperCase()} · exact revision</Badge>}
      </div>

      {workspaceTab === 'code'
        ? (
          <>
            <div class="one-way-note">
              <span>↗</span>
              <div>
                <strong>
                  Editor and External DAW use {state.editorDirty ? 'the A draft' : 'A'} · {editorRevision.id.slice(0, 8)}.
                </strong>
                <small>
                  {auditioningB
                    ? `You are auditioning B · ${b?.id.slice(0, 8)}. Score, receipt and Brain follow B; copied code remains A/draft.`
                    : 'Score, receipt and Brain currently follow A. External changes do not sync back here.'}
                </small>
              </div>
            </div>

            {unknownPreview && (
              <OutcomeUnknownNotice
                title="Preview response unknown"
                body={`The exact ${unknownPreview.input.source_revision_id.slice(0, 8)} source and captured code may already be committed as an immutable preview.`}
                retryLabel="Reconcile preview"
                newIntentLabel="Abandon and render current"
                busy={previewing}
                onRetry={() => void submitPreview(unknownPreview)}
                onStartNew={() => setUnknownPreview(undefined)}
              />
            )}

            <div class="editor-shell">
              <div ref={lineRailRef} class="line-rail" aria-hidden="true">
                {Array.from({ length: Math.max(18, state.editorCode.split('\n').length) }, (_, index) => (
                  <span key={index}>{index + 1}</span>
                ))}
              </div>
              <textarea
                class="code-editor"
                spellcheck={false}
                aria-label={`Strudel code for ${piece.name}`}
                value={state.editorCode}
                onInput={(event) => appStore.updateEditor(event.currentTarget.value)}
                onScroll={(event) => {
                  if (lineRailRef.current) {
                    lineRailRef.current.scrollTop = event.currentTarget.scrollTop;
                  }
                }}
              />
            </div>
          </>
        )
        : (
          <div class="workspace-prompt-receipt">
            <PromptReceipt revision={receiptRevision} />
          </div>
        )}

      {workspaceTab === 'code' && b && (
        <div class="preview-bar">
          <div>
            <Badge tone="blue">B preview</Badge>
            <strong>{b.label || 'Uncommitted render'}</strong>
            <code>{b.audio_sha.slice(0, 10)}</code>
          </div>
          <div>
            <Button
              size="sm"
              onClick={() => {
                appStore.auditionSide('b', true);
              }}
            >
              Listen B
            </Button>
            <Button tone="primary" size="sm" busy={promoting} onClick={promote}>Promote B</Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ScoreSubmission {
  intent: MutationIntent;
  pieceId: string;
  revisionId: string;
  input: ScoreInput;
}

function PieceWorkspace(): JSX.Element {
  const state = useAppState();
  const piece = appStore.selectedPiece();
  const active = piece?.active_revision;
  const auditioned = state.compare.selected === 'b' && state.compare.b
    ? state.compare.b
    : state.compare.a || active;
  const [score, setScore] = useState<number | undefined>(
    typeof auditioned?.score === 'number' ? auditioned.score : undefined,
  );
  const [note, setNote] = useState(auditioned?.note || '');
  const [saving, setSaving] = useState(false);
  const [unknownScore, setUnknownScore] = useState<ScoreSubmission>();
  const savingRef = useRef(false);

  useEffect(() => {
    setScore(typeof auditioned?.score === 'number' ? auditioned.score : undefined);
    setNote(auditioned?.note || '');
  }, [auditioned?.id, auditioned?.audio_sha, auditioned?.score, auditioned?.note]);

  if (!piece || !active) {
    return (
      <section class="piece-workspace piece-workspace--empty">
        <EmptyState title="No piece selected" body="Create a first shot or choose a piece from the rail." />
      </section>
    );
  }

  const submitScore = async (submission: ScoreSubmission) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const { piece: updated } = await api.scoreRevision(
        submission.pieceId,
        submission.revisionId,
        submission.input,
        submission.intent,
      );
      setUnknownScore((current) => (
        current?.intent.idempotencyKey === submission.intent.idempotencyKey ? undefined : current
      ));
      appStore.upsertPiece(updated);
      appStore.toast(`Score ${submission.input.score.toFixed(1)} bound to this audio revision.`);
    } catch (error) {
      if (error instanceof MutationOutcomeUnknownError) {
        setUnknownScore(submission);
        appStore.toast(
          'Score outcome is unknown. Reconcile the exact revision, audio SHA, score and note with the same operation key.',
          'warn',
        );
      } else {
        setUnknownScore((current) => (
          current?.intent.idempotencyKey === submission.intent.idempotencyKey ? undefined : current
        ));
        appStore.toast(humanError(error), 'error');
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveScore = () => {
    if (!auditioned || score === undefined) return;
    void submitScore({
      intent: createMutationIntent(),
      pieceId: piece.id,
      revisionId: auditioned.id,
      input: {
        score: clampScore(score),
        note: note.trim(),
        audio_sha: auditioned.audio_sha,
      },
    });
  };

  return (
    <section class="piece-workspace">
      <header class="piece-heading">
        <div>
          <div class="eyebrow">Current piece</div>
          <h1>{piece.name}</h1>
          <ProvenanceStrip provenance={(auditioned || active).provenance} />
        </div>
        <div class="piece-heading__meta">
          <span><small>{state.compare.selected.toUpperCase()} revision</small><code>{(auditioned || active).id.slice(0, 12)}</code></span>
          <span><small>Audio SHA</small><code>{(auditioned || active).audio_sha.slice(0, 12)}</code></span>
        </div>
      </header>

      <div class="workspace-score">
        <div class="wave-field" aria-hidden="true">
          {Array.from({ length: 74 }, (_, index) => {
            const height = 18 + ((index * 31) % 47) + (index % 4) * 4;
            return <span key={index} style={{ height: `${height}%`, opacity: 0.28 + ((index * 7) % 10) / 20 }} />;
          })}
          <div class="wave-field__label">transport owns playback · one audio source</div>
        </div>
        <div class="score-card">
          <div class="score-card__heading">
            <div>
              <span>Ear score</span>
              <small>{state.compare.selected.toUpperCase()} · {auditioned?.audio_sha.slice(0, 8)}</small>
            </div>
            {auditioned?.preview && <Badge tone="blue">preview</Badge>}
          </div>
          <ScoreMeter value={score} onChange={setScore} disabled={saving || Boolean(unknownScore)} />
          <input
            class="score-note"
            value={note}
            disabled={saving || Boolean(unknownScore)}
            placeholder="What worked, what collapsed…"
            onInput={(event) => setNote(event.currentTarget.value)}
          />
          {unknownScore && (
            <OutcomeUnknownNotice
              title="Score response unknown"
              body={`Revision ${unknownScore.revisionId.slice(0, 8)} · audio ${unknownScore.input.audio_sha.slice(0, 8)} may already have this rating.`}
              retryLabel="Reconcile score"
              newIntentLabel="Abandon and edit current"
              busy={saving}
              onRetry={() => void submitScore(unknownScore)}
              onStartNew={() => setUnknownScore(undefined)}
            />
          )}
          <Button
            tone="primary"
            size="sm"
            busy={saving}
            disabled={score === undefined || Boolean(unknownScore)}
            onClick={saveScore}
          >
            Save to this audio
          </Button>
        </div>
      </div>
      <CodeWorkspace piece={piece} />
    </section>
  );
}

function BrainThread({ job, ready }: { job?: BrainJob; ready: boolean }): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'nearest' }), [job?.messages.length]);
  if (!job || job.messages.length === 0) {
    return (
      <EmptyState
        compact
        title={ready ? 'Brain is ready' : 'Apply an Agent profile'}
        body={ready
          ? 'Ask about the selected revision. Every action returns a receipt.'
          : 'Brain stays unavailable until Settings confirms one tested profile with Apply.'}
      />
    );
  }
  return (
    <div class="brain-thread">
      {job.messages.map((message) => (
        <div key={message.id} class={`brain-message brain-message--${message.role}`}>
          <div class="brain-message__role">
            {message.role === 'assistant' ? 'Brain' : message.role}
            {message.tool_name ? ` · ${message.tool_name}` : ''}
          </div>
          <div class="brain-message__text">{message.text}</div>
          {message.effect_state === 'reconciliation_required' && (
            <Badge tone="amber">effect: reconciliation required</Badge>
          )}
          {message.effect_state === 'effect_observed' && (
            <Badge tone="gold">effect: observed & reconciled</Badge>
          )}
          {message.mutating && message.committed
            && message.effect_state === 'finalized' && (
            <Badge tone="gold">effect committed</Badge>
          )}
          {message.receipt && <Receipt receipt={message.receipt} />}
          <time>{formatDateTime(message.created_at)}</time>
        </div>
      ))}
      {['queued', 'running', 'waiting_for_tool', 'cancelling'].includes(job.state) && (
        <div class="brain-thinking">
          <span /><span /><span />
          <small>{job.state === 'waiting_for_tool' ? 'Waiting for tool receipt' : 'Working on pinned context'}</small>
        </div>
      )}
      {job.error && <p class="inline-error">{job.error}</p>}
      {job.receipt && <Receipt receipt={job.receipt} />}
      <div ref={endRef} />
    </div>
  );
}

interface BrainSubmission {
  intent: MutationIntent;
  input: BrainJobInput;
  context: {
    pieceId?: string;
    revisionId?: string;
    audioSha?: string;
    score?: number | null;
  };
  composerValue?: string;
}

function BrainDock(): JSX.Element {
  const state = useAppState();
  const piece = appStore.selectedPiece();
  const revision = state.compare.selected === 'b' && state.compare.b
    ? state.compare.b
    : state.compare.a || piece?.active_revision;
  const relevant = useMemo(
    () => (state.bootstrap?.brain_jobs || []).filter((candidate) => brainJobMatchesContext(candidate, {
      pieceId: piece?.id,
      revisionId: revision?.id,
      audioSha: revision?.audio_sha,
      score: revision?.score,
    })),
    [state.bootstrap?.brain_jobs, piece?.id, revision?.id, revision?.audio_sha, revision?.score],
  );
  const job = relevant[0];
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [unknownBrain, setUnknownBrain] = useState<BrainSubmission>();
  const sendingRef = useRef(false);
  const running = job && ['queued', 'running', 'waiting_for_tool', 'cancelling'].includes(job.state);
  const agent = state.bootstrap?.settings.agent;
  const brainReady = agentProfileReady(agent);

  const submitBrain = async (submission: BrainSubmission) => {
    if (!brainReady || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const result = await api.createBrainJob(submission.input, submission.intent);
      setUnknownBrain((current) => (
        current?.intent.idempotencyKey === submission.intent.idempotencyKey ? undefined : current
      ));
      appStore.upsertBrainJob({
        ...result.job,
        piece_id: result.job.piece_id ?? submission.context.pieceId,
        revision_id: result.job.revision_id ?? submission.context.revisionId,
        audio_sha: result.job.audio_sha ?? submission.context.audioSha,
        score: result.job.score !== undefined ? result.job.score : submission.context.score,
      });
      if (submission.composerValue !== undefined) {
        setMessage((current) => current === submission.composerValue ? '' : current);
      }
    } catch (error) {
      if (error instanceof MutationOutcomeUnknownError) {
        setUnknownBrain(submission);
        appStore.toast(
          'Brain job outcome is unknown. Reconcile the exact message and pinned revision with the same operation key.',
          'warn',
        );
      } else {
        setUnknownBrain((current) => (
          current?.intent.idempotencyKey === submission.intent.idempotencyKey ? undefined : current
        ));
        appStore.toast(humanError(error), 'error');
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const send = (text: string, clearComposer: boolean) => {
    const submittedText = text.trim();
    if (!submittedText || !brainReady || unknownBrain) return;
    const context = {
      pieceId: piece?.id,
      revisionId: revision?.id,
      audioSha: revision?.audio_sha,
      score: revision?.score,
    };
    void submitBrain({
      intent: createMutationIntent(),
      input: {
        message: submittedText,
        piece_id: context.pieceId,
        revision_id: context.revisionId,
        audio_sha: context.audioSha,
        score: context.score,
      },
      context,
      composerValue: clearComposer ? message : undefined,
    });
  };
  const cancel = async () => {
    if (!job) return;
    try {
      const result = await api.cancelBrainJob(job.id);
      appStore.upsertBrainJob(result.job);
    } catch (error) {
      appStore.toast(humanError(error), 'error');
    }
  };

  return (
    <aside class="brain-dock">
      <header class="brain-heading">
        <div class="brain-avatar"><span /><span /><span /></div>
        <div>
          <h2>Producer Brain</h2>
          <small>
            {agent?.active.model_id || 'No applied profile'}
            {' · '}
            {agent?.active.reasoning_effort || '—'}
          </small>
        </div>
        <div class="brain-heading__state">
          {running
            ? <StateBadge state={job.state} />
            : brainReady
              ? <Badge tone="green">ready</Badge>
              : <Badge tone="amber">apply agent</Badge>}
        </div>
      </header>

      {!brainReady && (
        <div class="brain-not-ready">
          <div>
            <strong>Brain is not active.</strong>
            <small>Discover, test and Apply one exact profile in Agent Settings first.</small>
          </div>
          <a
            href="/settings/agent"
            onClick={(event) => {
              if (
                event.button !== 0
                || event.metaKey
                || event.ctrlKey
                || event.shiftKey
                || event.altKey
              ) return;
              event.preventDefault();
              window.history.pushState({}, '', '/settings/agent');
              appStore.setRoute('settings-agent');
            }}
          >
            Open Settings →
          </a>
        </div>
      )}

      <div class="context-pin">
        <div>
          <span>Context pinned</span>
          <strong>{piece?.name || 'No piece'}</strong>
        </div>
        {revision && (
          <code>{revision.id.slice(0, 8)} · {revision.audio_sha.slice(0, 8)} · score {revision.score ?? '—'}</code>
        )}
      </div>

      <div class="brain-quick">
        {[
          'Diagnose what I am hearing',
          'Propose one reversible edit',
          'Explain this revision receipt',
        ].map((prompt) => (
          <button key={prompt} disabled={!brainReady || sending || Boolean(running) || Boolean(unknownBrain)} onClick={() => send(prompt, false)}>{prompt}</button>
        ))}
      </div>

      <BrainThread job={job} ready={brainReady} />

      {unknownBrain && (
        <OutcomeUnknownNotice
          title="Brain response unknown"
          body={`The exact message pinned to ${unknownBrain.context.revisionId?.slice(0, 8) || 'no revision'} may already own a durable Brain job.`}
          retryLabel="Reconcile Brain job"
          newIntentLabel="Abandon and start new"
          busy={sending}
          onRetry={() => void submitBrain(unknownBrain)}
          onStartNew={() => setUnknownBrain(undefined)}
        />
      )}

      <div class="brain-compose">
        <textarea
          rows={3}
          placeholder={!brainReady
            ? 'Apply an Agent profile in Settings first.'
            : piece
              ? `Ask about ${piece.name}…`
              : 'Ask the producer brain…'}
          value={message}
          disabled={!brainReady || sending || Boolean(running) || Boolean(unknownBrain)}
          onInput={(event) => setMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              send(message, true);
            }
          }}
        />
        <div>
          <small>⌘↵ send · context is immutable per job</small>
          {running
            ? <Button tone="danger" size="sm" onClick={cancel}>Cancel job</Button>
            : <Button tone="primary" size="sm" busy={sending} disabled={!brainReady || !message.trim() || Boolean(unknownBrain)} onClick={() => send(message, true)}>Send</Button>}
        </div>
      </div>
    </aside>
  );
}

export function StudioScreen(): JSX.Element {
  return (
    <div class="studio-layout">
      <StudioRail />
      <PieceWorkspace />
      <BrainDock />
    </div>
  );
}
