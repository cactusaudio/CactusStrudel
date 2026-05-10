// G2: closed-loop producer. The default mode of `cactus produce`.
//
// Pipeline:
//   1. parseBrief                                       (throws if no genre)
//   2. buildSessionGraphFromBrief                       (always succeeds)
//   3. compile + validateStrudelCode                    (throws on issues)
//   4. render via @cactus/renderer                      (fatal unless bestEffort)
//   5. masterTrack (Phase 11) post-render mix           (fatal unless bestEffort)
//   6. analyzeWav                                       (fatal unless bestEffort)
//   7. runQualityGates                                  (always)
//   8. classifyFailure                                  (always)
//   9. critique                                         (always)
//  10. planRevisions → apply boundary-valid → re-render → re-analyze (loop)
//  11. writes artifact bundle:
//      session.json / compiled.strudel.js / master.wav / features.json /
//      quality-gates.json / failure-taxonomy.json / critique.json /
//      revision-plan.json / locality.json / produce-report.md

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  parseBrief, buildSessionGraphFromBrief, planRevisions,
} from '@cactus/agent-runtime';
import { compileSessionGraph } from '@cactus/strudel-compiler';
import { validateStrudelCode } from '@cactus/strudel-validator';
import {
  applyPatch, isAgentAllowedToWrite, validateSemanticInvariants, formatSemanticReport,
  type Patch, type SessionGraph, type AnalyzerFeatures, type CritiqueEntry,
} from '@cactus/ir';
import {
  runQualityGates, analyzeWav, computeSectionDiagnostics, generateSpectrogram,
  type QualityGatesReport,
} from '@cactus/analyzer';
import { critique } from '@cactus/critic';
import { loadGenre } from '@cactus/genres';
import { masterTrack } from '@cactus/mastering';
import { scoreRevisionLocality, type LocalityResult } from '@cactus/revision';
import { classifyFailure, type ClassifiedFailure } from '@cactus/audit';
import { appendLedgerEntry, buildLedgerEntryFromClosedLoop } from '@cactus/preference';

export interface ProduceClosedLoopOptions {
  brief: string;
  outDir?: string;
  seed?: number;
  bestEffort?: boolean;
  maxIterations?: number;
  severityFloor?: number;
  /** When true, also write the audit-style failures/<i>.json on every iteration. */
  emitAuditFailures?: boolean;
}

export interface ProduceClosedLoopResult {
  ok: boolean;
  sessionDir: string;
  iterations: number;
  stoppedReason: 'accepted' | 'plateau' | 'max_iterations' | 'no_patches' | 'failure';
  finalGraphPath: string;
  finalWavPath?: string;
  reportPath: string;
  hardFailures: string[];
  failureCategories: string[];
}

const DEFAULT_MAX_ITER = 4;
const DEFAULT_SEVERITY_FLOOR = 0.5;
const SAFE_GAIN_DB = 18;

export async function produceClosedLoop(input: ProduceClosedLoopOptions): Promise<ProduceClosedLoopResult> {
  const maxIter = input.maxIterations ?? DEFAULT_MAX_ITER;
  const severityFloor = input.severityFloor ?? DEFAULT_SEVERITY_FLOOR;
  const bestEffort = input.bestEffort ?? false;

  const brief = parseBrief(input.brief);
  if (!brief.primary_genre) {
    throw new Error(`closed-loop produce: parseBrief could not infer primary_genre. Add a genre keyword.`);
  }
  let graph = await buildSessionGraphFromBrief(
    brief,
    input.seed !== undefined ? { seed: input.seed } : {},
  );
  const sessionDir = input.outDir ?? path.resolve(process.cwd(), 'sessions', graph.session_id);
  await fs.mkdir(sessionDir, { recursive: true });
  const failuresDir = path.join(sessionDir, 'failures');
  if (input.emitAuditFailures) await fs.mkdir(failuresDir, { recursive: true });

  const genre = await loadGenre(brief.primary_genre).catch(() => undefined);
  const hardFailures: string[] = [];
  const iterationLog: Array<{
    iter: number;
    patches: Patch[];
    appliedOps: number;
    classification: ClassifiedFailure;
    qualityPass: boolean;
    weighted: number;
    locality?: LocalityResult;
  }> = [];

  let stoppedReason: ProduceClosedLoopResult['stoppedReason'] = 'max_iterations';
  let prevGraph: SessionGraph | null = null;
  let prevWeighted = -Infinity;

  // G4: pin the renderer warm for the whole closed loop so we pay the boot
  // tax once instead of once per iteration. Shutdown happens in the finally
  // below.
  const { warmup, shutdown } = await import('@cactus/renderer');
  await warmup();
  try {
  for (let iter = 0; iter <= maxIter; iter++) {
    const iterTag = `iter_${String(iter).padStart(4, '0')}`;
    const codePath = path.join(sessionDir, `${iterTag}.strudel.js`);
    const graphPath = path.join(sessionDir, `${iterTag}.json`);
    const wavPath = path.join(sessionDir, `${iterTag}.wav`);
    const featuresPath = path.join(sessionDir, `${iterTag}.features.json`);
    const gatesPath = path.join(sessionDir, `${iterTag}.quality-gates.json`);
    const taxonomyPath = path.join(sessionDir, `${iterTag}.failure-taxonomy.json`);
    const critiquePath = path.join(sessionDir, `${iterTag}.critique.json`);
    const planPath = path.join(sessionDir, `${iterTag}.revision-plan.json`);
    const localityPath = path.join(sessionDir, `${iterTag}.locality.json`);

    // G5: refuse to compile a graph that violates semantic invariants. This
    // catches bad patches BEFORE we waste a render on them.
    const sem = validateSemanticInvariants(graph);
    if (!sem.ok) {
      throw new Error(`closed-loop produce: ${iterTag} ${formatSemanticReport(sem)}`);
    }

    const compiled = compileSessionGraph(graph);
    const validation = validateStrudelCode(compiled.code);
    if (validation.issues.length > 0) {
      throw new Error(`closed-loop produce: validator failed on ${iterTag} with ${validation.issues.length} issue(s)`);
    }
    await fs.writeFile(graphPath, JSON.stringify(graph, null, 2));
    await fs.writeFile(codePath, compiled.code);

    // Render → master → analyze (fatal-by-default).
    let features: AnalyzerFeatures | undefined;
    let wavWritten = false;
    try {
      const { render } = await import('@cactus/renderer');
      const cps = (graph.brief.bpm ?? 120) / 240;
      const totalBars = Math.min(graph.song.total_bars, 16);
      await render({ code: compiled.code, durationCycles: totalBars, cps, outputPath: wavPath });
      wavWritten = true;
      if (genre) {
        const m = await masterTrack({
          inputWavPath: wavPath, outputWavPath: wavPath,
          targets: { lufs: genre.mix_targets.lufs, true_peak_max: genre.mix_targets.true_peak_max ?? -1 },
        });
        if (Math.abs(m.appliedGainDb) > SAFE_GAIN_DB) {
          hardFailures.push(`${iterTag}: master applied ${m.appliedGainDb.toFixed(1)} dB (>±${SAFE_GAIN_DB}) — structural mix issue`);
        }
      }
      features = await analyzeWav(wavPath);
      await fs.writeFile(featuresPath, JSON.stringify(features, null, 2));
    } catch (e) {
      const msg = `${iterTag} render/master/analyze failed: ${e instanceof Error ? e.message : String(e)}`;
      hardFailures.push(msg);
      if (!bestEffort) {
        stoppedReason = 'failure';
        await writeReport({ sessionDir, graph, iterationLog, hardFailures, stoppedReason });
        throw new Error(msg);
      }
    }

    // Quality gates + classification + critic (always).
    let gates: QualityGatesReport | undefined;
    let classification: ClassifiedFailure = { categories: [], evidence: {} };
    let crit: CritiqueEntry | undefined;
    if (features) {
      gates = await runQualityGates({
        wavPath, graph, features,
        ...(genre ? { genreTargets: {
          lufs: genre.mix_targets.lufs,
          true_peak_max: genre.mix_targets.true_peak_max,
          ...(genre.mix_targets.stereo_mono_low_compliance_min !== undefined
            ? { stereo_mono_low_compliance_min: genre.mix_targets.stereo_mono_low_compliance_min }
            : {}),
        } } : {}),
      });
      await fs.writeFile(gatesPath, JSON.stringify(gates, null, 2));
      classification = classifyFailure({
        gates, features, graph,
        validatorIssues: validation.issues.length,
      });
      await fs.writeFile(taxonomyPath, JSON.stringify(classification, null, 2));
      // G6: section diagnostics + spectrogram fed into the critic so it can
      // emit per-section + per-band targets with image evidence.
      let sectionDiagsLite: Array<{ section_id: string; section_name?: string; non_silent_ratio: number; rms_db?: number; band_rms?: Record<string, number>; active_layers?: number }> | undefined;
      let spectrogramPath: string | undefined;
      try {
        const sdReport = await computeSectionDiagnostics(wavPath, graph);
        sectionDiagsLite = sdReport.rendered_sections.map((s) => ({
          section_id: s.section_id,
          section_name: s.name,
          non_silent_ratio: s.non_silent_ratio,
          rms_db: s.rms_db,
          band_rms: s.band_rms,
          active_layers: s.active_layer_count,
        }));
        const specOut = path.join(sessionDir, `${iterTag}.spectrogram.png`);
        await generateSpectrogram(wavPath, { outputPath: specOut }).catch(() => undefined);
        spectrogramPath = specOut;
      } catch (e) {
        hardFailures.push(`${iterTag}: section/spectrogram analysis failed: ${e instanceof Error ? e.message : String(e)}`);
      }

      crit = await critique({
        graph, features, iteration: iter,
        ...(sectionDiagsLite ? { sectionDiagnostics: sectionDiagsLite } : {}),
        ...(spectrogramPath ? { spectrogramPath } : {}),
      });
      await fs.writeFile(critiquePath, JSON.stringify(crit, null, 2));

      if (input.emitAuditFailures && classification.categories.length > 0) {
        await fs.writeFile(
          path.join(failuresDir, `${iterTag}.json`),
          JSON.stringify({ iter, categories: classification.categories, evidence: classification.evidence, gates: gates.gates }, null, 2),
        );
      }
    }

    const weighted = crit ? avgScores(crit) : 0;
    const qualityPass = gates ? gates.overall_pass : false;

    // Locality vs previous iteration's graph (informational on first pass).
    let locality: LocalityResult | undefined;
    if (prevGraph) {
      locality = scoreRevisionLocality({
        before: prevGraph, after: graph,
        requested_paths: iterationLog.length > 0
          ? iterationLog[iterationLog.length - 1]!.patches.flatMap((p) => p.ops.map((o) => o.path))
          : [],
      });
      await fs.writeFile(localityPath, JSON.stringify(locality, null, 2));
    }
    prevGraph = JSON.parse(JSON.stringify(graph)) as SessionGraph;

    // Plan next revision based on critique. If qualityPass + no severe critic
    // target → accepted. If no patches → no_patches stop. If applied 0 ops →
    // plateau.
    let patches: Patch[] = [];
    let appliedOps = 0;

    const maxSeverity = crit ? Math.max(0, ...crit.targets.map((t) => t.severity)) : 0;
    if (qualityPass && (crit ? maxSeverity < severityFloor : false)) {
      iterationLog.push({ iter, patches, appliedOps, classification, qualityPass, weighted, ...(locality ? { locality } : {}) });
      stoppedReason = 'accepted';
      break;
    }

    if (crit) {
      patches = planRevisions({ graph, critique: crit, maxPatches: 5 });
      await fs.writeFile(planPath, JSON.stringify(patches, null, 2));
      for (const p of patches) {
        if (!p.ops.every((op) => isAgentAllowedToWrite(p.agent, op.path))) continue;
        try { graph = applyPatch(graph, p.ops); appliedOps += p.ops.length; }
        catch { /* skip un-applyable */ }
      }
    }

    iterationLog.push({ iter, patches, appliedOps, classification, qualityPass, weighted, ...(locality ? { locality } : {}) });

    // G6: failed-patch artifact. If we had patches in the previous iteration
    // and this iteration's weighted score regressed, surface which patches
    // didn't help so the next planner run (and the human) can see it.
    if (iter > 0 && iterationLog.length >= 1) {
      const prev = iterationLog[iterationLog.length - 1]!;
      if (prev.patches.length > 0 && weighted < prev.weighted - 0.005) {
        const failedPatchesPath = path.join(sessionDir, `${iterTag}.failed-patches.json`);
        await fs.writeFile(failedPatchesPath, JSON.stringify({
          previous_iteration: prev.iter,
          weighted_before: prev.weighted,
          weighted_after: weighted,
          delta: weighted - prev.weighted,
          patches_that_did_not_help: prev.patches.map((p) => ({
            patch_id: p.patch_id,
            agent: p.agent,
            intent: p.intent,
            ops: p.ops.map((o) => ({ op: o.op, path: o.path })),
          })),
        }, null, 2));
      }
    }

    if (patches.length === 0) {
      stoppedReason = 'no_patches';
      break;
    }
    if (appliedOps === 0) {
      stoppedReason = 'plateau';
      break;
    }
    if (iter === maxIter) {
      stoppedReason = 'max_iterations';
      break;
    }
    // Plateau check based on weighted score AFTER re-eval next loop iteration.
    if (iter > 0 && weighted - prevWeighted < 0.01) {
      // Allow one more iteration; declare plateau if no improvement after re-render.
    }
    prevWeighted = weighted;
  }

  const report = await writeReport({ sessionDir, graph, iterationLog, hardFailures, stoppedReason });

  // G7: append a learning-ledger entry summarizing what this session tried
  // and what came of it. Best-effort — never fail the session over a ledger
  // write error.
  try {
    const ledgerEntry = buildLedgerEntryFromClosedLoop({
      sessionId: graph.session_id,
      brief: input.brief,
      stoppedReason,
      iterations: iterationLog.length,
      hardFailures,
      iterationLog: iterationLog.map((it) => ({
        iter: it.iter,
        appliedOps: it.appliedOps,
        qualityPass: it.qualityPass,
        weighted: it.weighted,
        classification: { categories: it.classification.categories },
      })),
    });
    await appendLedgerEntry(ledgerEntry);
  } catch (e) {
    if (process.env.CACTUS_LEDGER_VERBOSE) {
      console.error(`[ledger] append failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    ok: hardFailures.length === 0 && (stoppedReason === 'accepted' || stoppedReason === 'plateau' || stoppedReason === 'max_iterations'),
    sessionDir,
    iterations: iterationLog.length,
    stoppedReason,
    finalGraphPath: path.join(sessionDir, `iter_${String(iterationLog.length - 1).padStart(4, '0')}.json`),
    finalWavPath: path.join(sessionDir, `iter_${String(iterationLog.length - 1).padStart(4, '0')}.wav`),
    reportPath: report,
    hardFailures,
    failureCategories: Array.from(new Set(iterationLog.flatMap((i) => i.classification.categories))),
  };
  } finally {
    await shutdown();
  }
}

function avgScores(c: CritiqueEntry): number {
  const v = Object.values(c.scores);
  return v.reduce((a, b) => a + b, 0) / v.length;
}

interface WriteReportInput {
  sessionDir: string;
  graph: SessionGraph;
  iterationLog: Array<{
    iter: number;
    patches: Patch[];
    appliedOps: number;
    classification: ClassifiedFailure;
    qualityPass: boolean;
    weighted: number;
    locality?: LocalityResult;
  }>;
  hardFailures: string[];
  stoppedReason: ProduceClosedLoopResult['stoppedReason'];
}

async function writeReport(input: WriteReportInput): Promise<string> {
  const reportPath = path.join(input.sessionDir, 'produce-report.md');
  const lines: string[] = [];
  lines.push(`# closed-loop produce — ${input.graph.session_id}`);
  lines.push('');
  lines.push(`- brief: ${input.graph.brief.text}`);
  lines.push(`- genre: ${input.graph.brief.primary_genre}`);
  lines.push(`- bpm: ${input.graph.brief.bpm}`);
  lines.push(`- iterations: ${input.iterationLog.length}`);
  lines.push(`- stopped: ${input.stoppedReason}`);
  lines.push(`- hard failures: ${input.hardFailures.length}`);
  for (const h of input.hardFailures) lines.push(`  - ${h}`);
  lines.push('');
  lines.push('## per-iteration');
  for (const it of input.iterationLog) {
    lines.push(`### iter ${it.iter}`);
    lines.push(`- quality_pass: ${it.qualityPass}`);
    lines.push(`- categories: ${it.classification.categories.join(', ') || '_none_'}`);
    lines.push(`- weighted_score: ${it.weighted.toFixed(3)}`);
    lines.push(`- patches_planned: ${it.patches.length}; ops_applied: ${it.appliedOps}`);
    if (it.locality) {
      lines.push(`- locality: unrelated_change_ratio=${it.locality.unrelated_change_ratio.toFixed(2)} drift_severity=${it.locality.drift_severity.toFixed(2)}`);
    }
    lines.push('');
  }
  lines.push('## artifacts');
  lines.push('- iter_NNNN.json (SessionGraph per iteration)');
  lines.push('- iter_NNNN.strudel.js (compiled code)');
  lines.push('- iter_NNNN.wav (rendered + mastered audio)');
  lines.push('- iter_NNNN.features.json (analyzer output)');
  lines.push('- iter_NNNN.quality-gates.json (gate verdicts incl. severity tiers)');
  lines.push('- iter_NNNN.failure-taxonomy.json (categorized failures)');
  lines.push('- iter_NNNN.critique.json (critic evidence + revision targets)');
  lines.push('- iter_NNNN.revision-plan.json (patches the planner emitted)');
  lines.push('- iter_NNNN.locality.json (revision drift metrics; iter≥1)');
  await fs.writeFile(reportPath, lines.join('\n') + '\n');
  return reportPath;
}
