// G3: real revise loop. Loads the latest iteration of an existing session,
// parses user feedback (English / Chinese / mixed) into synthetic critique
// targets, plans + applies revision patches, re-renders and re-analyzes the
// revised graph, scores revision locality, and writes a revision report.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import {
  applyPatch, isAgentAllowedToWrite,
  SessionGraphSchema,
  type CritiqueEntry, type Patch, type SessionGraph,
} from '@cactus/ir';
import { compileSessionGraph } from '@cactus/strudel-compiler';
import { validateStrudelCode } from '@cactus/strudel-validator';
import { planRevisions } from '@cactus/agent-runtime';
import { parseFeedback, applyFeedback, recordDecision } from '@cactus/preference';
import { runQualityGates, analyzeWav } from '@cactus/analyzer';
import { critique } from '@cactus/critic';
import { loadGenre } from '@cactus/genres';
import { masterTrack } from '@cactus/mastering';
import { scoreRevisionLocality } from '@cactus/revision';

export interface ReviseInput {
  sessionDir: string;
  feedback: string;
  bestEffort?: boolean;
  /** When true, skip render+master+analyze+critique entirely. */
  skipRender?: boolean;
}

export interface ReviseResult {
  ok: boolean;
  sessionId: string;
  prevIter: number;
  nextIter: number;
  patchesPlanned: number;
  patchesApplied: number;
  renderedWav: string | undefined;
  reportPath: string;
  drift_severity: number;
  invariant_violations: number;
  hardFailures: string[];
}

export async function revise(input: ReviseInput): Promise<ReviseResult> {
  const iters = await listIters(input.sessionDir);
  if (iters.length === 0) throw new Error(`revise: no iterations found in ${input.sessionDir}`);
  const prevIter = iters[iters.length - 1]!;
  const prevTag = `iter_${String(prevIter).padStart(4, '0')}`;
  const prevGraphPath = path.join(input.sessionDir, `${prevTag}.json`);
  const prevGraph = SessionGraphSchema.parse(JSON.parse(await fs.readFile(prevGraphPath, 'utf8')));
  let graph: SessionGraph = JSON.parse(JSON.stringify(prevGraph)) as SessionGraph;

  const parsed = parseFeedback(input.feedback);

  // Update preference weights + log feedback decision before patching anything.
  graph.preference_graph.weights = applyFeedback(graph.preference_graph.weights, parsed);
  graph.preference_graph = recordDecision(graph.preference_graph, {
    decision_id: uuid(),
    timestamp: new Date().toISOString(),
    kind: 'feedback',
    feedback_text: input.feedback,
    inferred_attributes: parsed.attribute_preferences,
  });

  // Build a synthetic CritiqueEntry from the feedback parser's planner-ready
  // targets. The planner consumes the same shape it gets from the real critic.
  const syntheticCritique: CritiqueEntry = {
    iteration: prevIter,
    scores: prevGraph.preference_graph.weights, // placeholder; weights act as scores anchor
    targets: parsed.synthetic_targets.map((t) => ({
      target_id: t.target_id,
      severity: t.severity,
      agent: t.agent,
      graph_paths: t.graph_paths,
      problem: t.problem,
      evidence: { ...t.evidence, ...(t.intended_movement as Record<string, unknown>) },
      revision_instruction: t.revision_instruction,
    })),
    notes: `feedback (${parsed.language}): ${input.feedback}`,
  };

  const patchesPlanned = planRevisions({ graph, critique: syntheticCritique, maxPatches: 8 });

  // Apply boundary-valid patches; track requested paths for locality.
  const requestedPaths: string[] = [];
  let patchesApplied = 0;
  for (const p of patchesPlanned) {
    if (!p.ops.every((op) => isAgentAllowedToWrite(p.agent, op.path))) continue;
    try {
      graph = applyPatch(graph, p.ops);
      patchesApplied++;
      for (const op of p.ops) requestedPaths.push(op.path);
    } catch {
      /* skip un-applyable */
    }
  }

  const nextIter = prevIter + 1;
  const nextTag = `iter_${String(nextIter).padStart(4, '0')}`;
  const nextGraphPath = path.join(input.sessionDir, `${nextTag}.json`);
  const nextCodePath = path.join(input.sessionDir, `${nextTag}.strudel.js`);
  const nextWavPath = path.join(input.sessionDir, `${nextTag}.wav`);
  const nextFeaturesPath = path.join(input.sessionDir, `${nextTag}.features.json`);
  const nextCritiquePath = path.join(input.sessionDir, `${nextTag}.critique.json`);
  const nextPlanPath = path.join(input.sessionDir, `${nextTag}.revision-plan.json`);
  const nextLocalityPath = path.join(input.sessionDir, `${nextTag}.locality.json`);
  const reportPath = path.join(input.sessionDir, `${nextTag}.revision-report.md`);

  // Always write graph + plan + recompile; render/analyze are best-effort here
  // by default because revise is lower-priority than produce; pass bestEffort=false
  // if you want fatal-on-render failures.
  await fs.writeFile(nextGraphPath, JSON.stringify(graph, null, 2));
  await fs.writeFile(nextPlanPath, JSON.stringify({ planned: patchesPlanned, applied: patchesApplied, requested_paths: requestedPaths, parsed_feedback: parsed }, null, 2));

  const compiled = compileSessionGraph(graph);
  const validation = validateStrudelCode(compiled.code);
  if (validation.issues.length > 0) {
    throw new Error(`revise: revised graph compiles to ${validation.issues.length} validator issue(s)`);
  }
  await fs.writeFile(nextCodePath, compiled.code);

  const hardFailures: string[] = [];
  let renderedWav: string | undefined;
  let critEntry: CritiqueEntry | undefined;

  const bestEffort = input.bestEffort ?? true;
  const skipRender = input.skipRender === true;
  try {
    if (skipRender) throw new Error('skipRender:true');
    const { render } = await import('@cactus/renderer');
    const cps = (graph.brief.bpm ?? 120) / 240;
    const totalBars = Math.min(graph.song.total_bars, 16);
    await render({ code: compiled.code, durationCycles: totalBars, cps, outputPath: nextWavPath });
    renderedWav = nextWavPath;
    const genre = await loadGenre(graph.brief.primary_genre ?? 'techno').catch(() => undefined);
    if (genre) {
      const m = await masterTrack({
        inputWavPath: nextWavPath, outputWavPath: nextWavPath,
        targets: { lufs: genre.mix_targets.lufs, true_peak_max: genre.mix_targets.true_peak_max ?? -1 },
      });
      if (Math.abs(m.appliedGainDb) > 18) {
        hardFailures.push(`master applied ${m.appliedGainDb.toFixed(1)} dB`);
      }
    }
    const features = await analyzeWav(nextWavPath);
    await fs.writeFile(nextFeaturesPath, JSON.stringify(features, null, 2));
    if (genre) {
      await runQualityGates({
        wavPath: nextWavPath, graph, features,
        genreTargets: { lufs: genre.mix_targets.lufs, true_peak_max: genre.mix_targets.true_peak_max },
      });
    }
    critEntry = await critique({ graph, features, iteration: nextIter });
    await fs.writeFile(nextCritiquePath, JSON.stringify(critEntry, null, 2));
  } catch (e) {
    const msg = e instanceof Error && e.message === 'skipRender:true'
      ? 'render skipped (--no-render)'
      : `revise render/analyze failed: ${e instanceof Error ? e.message : String(e)}`;
    if (!skipRender) hardFailures.push(msg);
    if (!bestEffort && !skipRender) throw new Error(msg);
  }

  // Locality: how surgical was the revision? Requested paths come from the
  // patches we actually applied; invariants from the parser.
  const locality = scoreRevisionLocality({
    before: prevGraph,
    after: graph,
    requested_paths: requestedPaths,
    invariants: parsed.invariants,
    // Housekeeping writes done unconditionally by revise() — exclude from
    // locality so drift_severity reflects musical surgicalness, not feedback
    // bookkeeping.
    ignored_path_prefixes: ['/preference_graph', '/current_iteration'],
  });
  await fs.writeFile(nextLocalityPath, JSON.stringify(locality, null, 2));

  await fs.writeFile(reportPath, renderRevisionReport({
    sessionId: graph.session_id,
    feedback: input.feedback,
    parsed,
    prevIter, nextIter,
    patchesPlanned,
    patchesApplied,
    locality,
    hardFailures,
    rendered: !!renderedWav,
  }));

  return {
    ok: hardFailures.length === 0,
    sessionId: graph.session_id,
    prevIter, nextIter,
    patchesPlanned: patchesPlanned.length,
    patchesApplied,
    renderedWav,
    reportPath,
    drift_severity: locality.drift_severity,
    invariant_violations: locality.invariant_violations.length,
    hardFailures,
  };
}

async function listIters(dir: string): Promise<number[]> {
  let entries: string[] = [];
  try { entries = await fs.readdir(dir); } catch { return []; }
  return entries
    .filter((n) => /^iter_\d{4}\.json$/.test(n))
    .map((n) => Number(n.slice(5, 9)))
    .sort((a, b) => a - b);
}

interface RenderRevisionReportInput {
  sessionId: string;
  feedback: string;
  parsed: ReturnType<typeof parseFeedback>;
  prevIter: number;
  nextIter: number;
  patchesPlanned: Patch[];
  patchesApplied: number;
  locality: ReturnType<typeof scoreRevisionLocality>;
  hardFailures: string[];
  rendered: boolean;
}

function renderRevisionReport(i: RenderRevisionReportInput): string {
  const lines: string[] = [];
  lines.push(`# revision — ${i.sessionId} iter ${i.prevIter} → ${i.nextIter}`);
  lines.push('');
  lines.push(`**feedback**: ${i.feedback}`);
  lines.push(`- detected language: ${i.parsed.language}`);
  lines.push(`- synthetic targets: ${i.parsed.synthetic_targets.length}`);
  lines.push(`- invariants asserted: ${i.parsed.invariants.length}`);
  lines.push(`- patches planned: ${i.patchesPlanned.length}; applied: ${i.patchesApplied}`);
  lines.push(`- rendered: ${i.rendered}`);
  if (i.hardFailures.length > 0) {
    lines.push(`- hard failures: ${i.hardFailures.length}`);
    for (const h of i.hardFailures) lines.push(`  - ${h}`);
  }
  lines.push('');

  lines.push('## locality');
  lines.push(`- changed paths: ${i.locality.changed_paths.length}`);
  lines.push(`- requested_change_count: ${i.locality.target_changed_count}`);
  lines.push(`- unrelated_change_count: ${i.locality.unrelated_changed_count}`);
  lines.push(`- unrelated_change_ratio: ${i.locality.unrelated_change_ratio.toFixed(3)}`);
  lines.push(`- drift_severity: ${i.locality.drift_severity.toFixed(3)}`);
  if (i.locality.invariant_violations.length > 0) {
    lines.push(`- invariant violations:`);
    for (const v of i.locality.invariant_violations) {
      lines.push(`  - ${v.path}: ${v.description}`);
      lines.push(`    before: ${JSON.stringify(v.before)}`);
      lines.push(`    after:  ${JSON.stringify(v.after)}`);
    }
  }
  lines.push('');

  lines.push('## planned patches');
  for (const p of i.patchesPlanned) {
    lines.push(`### [${p.agent}] ${p.intent}`);
    for (const op of p.ops) lines.push(`- ${op.op} ${op.path}${'value' in op && op.value !== undefined ? ` = ${truncJson(op.value)}` : ''}`);
  }
  lines.push('');

  lines.push('## parsed feedback (full)');
  lines.push('```json');
  lines.push(JSON.stringify(i.parsed, null, 2));
  lines.push('```');
  return lines.join('\n') + '\n';
}

function truncJson(v: unknown): string {
  const s = JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}
