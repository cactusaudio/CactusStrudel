import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import type { PieceRevision, Provenance } from '../contracts';
import { useAppState } from '../store';
import { researchCohortSignature } from '../state/invariants';
import {
  Badge,
  EmptyState,
  Panel,
  PanelHeader,
  provenanceEffortLabel,
} from '../components/ui';

interface Group {
  key: string;
  provenance: Provenance;
  values: number[];
  pieces: string[];
  mean: number;
  min: number;
  max: number;
}

function modelLabel(provenance: Provenance): string {
  return `${provenance.model_id || 'legacy_unknown'} · ${provenanceEffortLabel(provenance)} · ${provenance.orchestration || 'unknown orchestration'}`;
}

export function ResearchScreen(): JSX.Element {
  const state = useAppState();
  const groups = useMemo(() => {
    const revisions: Array<{ revision: PieceRevision; piece: string }> = [];
    (state.bootstrap?.pieces || []).forEach((piece) => {
      piece.revisions.forEach((revision) => {
        if (typeof revision.score === 'number' && Number.isFinite(revision.score)) {
          revisions.push({ revision, piece: piece.name });
        }
      });
    });
    const map = new Map<string, Group>();
    revisions.forEach(({ revision, piece }) => {
      const key = researchCohortSignature(revision.provenance);
      const group = map.get(key) || {
        key,
        provenance: revision.provenance,
        values: [],
        pieces: [],
        mean: 0,
        min: 0,
        max: 0,
      };
      group.values.push(revision.score as number);
      group.pieces.push(piece);
      map.set(key, group);
    });
    return Array.from(map.values())
      .map((group) => ({
        ...group,
        mean: group.values.reduce((sum, value) => sum + value, 0) / group.values.length,
        min: Math.min(...group.values),
        max: Math.max(...group.values),
      }))
      .sort((a, b) => b.mean - a.mean);
  }, [state.bootstrap?.pieces]);

  const totalRatings = groups.reduce((sum, group) => sum + group.values.length, 0);
  const maximum = Math.max(10, ...groups.map((group) => group.mean));

  return (
    <div class="research-page">
      <section class="page-heading">
        <div>
          <div class="eyebrow">Evidence, not taste automation</div>
          <h1>Research</h1>
          <p>Groups use exact route + model + effort + orchestration + kernel + validator provenance. The values are Bowei’s listening scores.</p>
        </div>
        <div class="page-heading__metrics">
          <div><strong>{totalRatings}</strong><span>human ratings</span></div>
          <div><strong>{groups.length}</strong><span>exact cohorts</span></div>
        </div>
      </section>

      <div class="research-notice">
        <Badge tone="gold">Interpretation boundary</Badge>
        <p>Small n stays small n. A structural test or a model name is not evidence that the music is good.</p>
      </div>

      {groups.length > 0 ? (
        <>
          <Panel class="research-chart">
            <PanelHeader
              eyebrow="Cohort comparison"
              title="Ear-score means"
              detail="Sorted by mean; range shows floor and ceiling."
            />
            <div class="cohort-bars">
              {groups.slice(0, 12).map((group, index) => (
                <div class="cohort-row" key={group.key}>
                  <div class="cohort-rank">{String(index + 1).padStart(2, '0')}</div>
                  <div class="cohort-label">
                    <strong>{modelLabel(group.provenance)}</strong>
                    <small>
                      k:{(group.provenance.kernel_hash || 'unknown').slice(0, 8)}
                      {' · '}
                      {group.provenance.validator_mode || 'unknown validator'}
                      {' · '}
                      {group.provenance.repair_applied === true
                        ? 'repaired'
                        : group.provenance.repair_applied === false
                          ? 'first shot'
                          : 'repair unknown'}
                    </small>
                  </div>
                  <div class="cohort-bar">
                    <span style={{ width: `${(group.mean / maximum) * 100}%` }} />
                    <i style={{ left: `${(group.min / maximum) * 100}%`, width: `${((group.max - group.min) / maximum) * 100}%` }} />
                  </div>
                  <div class="cohort-value">{group.mean.toFixed(2)}</div>
                  <Badge tone={group.values.length >= 5 ? 'green' : group.values.length >= 3 ? 'amber' : 'neutral'}>
                    n={group.values.length}
                  </Badge>
                </div>
              ))}
            </div>
          </Panel>

          <Panel class="research-ledger">
            <PanelHeader title="Exact provenance ledger" detail="No static slot labels are treated as models." />
            <div class="research-table__head">
              <span>Model / route</span><span>Effort</span><span>Mode</span><span>Kernel</span>
              <span>Mean</span><span>Range</span><span>n</span>
            </div>
            {groups.map((group) => (
              <div class="research-line" key={group.key}>
                <span><strong>{group.provenance.model_id || 'legacy_unknown'}</strong><small>{group.provenance.route || 'unknown route'}</small></span>
                <span>{provenanceEffortLabel(group.provenance)}</span>
                <span>{group.provenance.orchestration || 'unknown'}</span>
                <code>{(group.provenance.kernel_hash || 'unknown').slice(0, 10)}</code>
                <strong>{group.mean.toFixed(2)}</strong>
                <span>{group.min.toFixed(1)}–{group.max.toFixed(1)}</span>
                <Badge>{group.values.length}</Badge>
              </div>
            ))}
          </Panel>
        </>
      ) : (
        <Panel>
          <EmptyState
            title="No comparable listening evidence yet"
            body="Score exact audio revisions in Studio. Cohorts appear without inventing provenance or quality gates."
          />
        </Panel>
      )}
    </div>
  );
}
