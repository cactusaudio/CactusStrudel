import { promises as fs } from 'node:fs';
import path from 'node:path';
import { compileSessionGraph } from '@cactus/strudel-compiler';
import { validateStrudelCode } from '@cactus/strudel-validator';
import {
  loadGenre,
} from '@cactus/genres';
import {
  analyzeWav,
  runQualityGates,
  computeSectionDiagnostics,
  type QualityGatesReport,
  type SectionDiagnosticsReport,
} from '@cactus/analyzer';
import { critique } from '@cactus/critic';
import { createBackend, type BackendName, type ProducerBackendResult, type ClaudeShadowOptions } from '@cactus/orchestrator';
import { masterNormalize, guardTruePeak } from '@cactus/mix';
import { masterTrack } from '@cactus/mastering';
import type { AnalyzerFeatures, CritiqueEntry, SessionGraph } from '@cactus/ir';
import { loadSuite, expandPrompts, type ExpandedPrompt } from './prompt-suite.js';
import {
  scoreGenreConfusion, aggregateConfusion, renderConfusionMarkdown,
  type GenreConfusionReport,
} from './genre-confusion.js';
import { applyGenreDiscriminators } from './genre-discriminators.js';
import { classifyFailure, type FailureCategory, type ClassifiedFailure } from './failure-taxonomy.js';
import {
  decideWinner, summarize as summarizeCC,
  type BackendRunSummary, type ChampionChallengerVerdict, type ChampionChallengerSummary,
} from './champion-challenger.js';
import { writeDiagnosticReport } from './diagnostic-report.js';

export interface RunAuditOptions {
  /** Suite name (loaded from tests/fixtures/audits/<name>/) or 'smoke' for the single-prompt suite. */
  suite: string;
  /** Number of seeds per prompt. */
  seeds?: number;
  /** Output directory for the audit bundle. */
  outDir: string;
  /** If true, skip rendering audio (run only analyzer-aware code paths that work without WAV). */
  skipRender?: boolean;
  /** Challenger backends to run alongside the champion (rules is always run). */
  challengers?: BackendName[];
  /** Optional Claude dispatcher passed to non-rules backends. */
  claudeOptions?: ClaudeShadowOptions;
  /** Override for tests. */
  rootDir?: string;
  /** Apply post-render LUFS normalization + true-peak guard before analyzing. */
  postRenderMix?: boolean;
  /** Emit per-render section diagnostics (JSON + MD) under diagnostics/. */
  diagnostics?: boolean;
}

export interface RunAuditResult {
  outDir: string;
  prompts_total: number;
  champion_pass: number;
  champion_fail: number;
  champion_failures_by_category: Record<FailureCategory, number>;
  champion_challenger?: ChampionChallengerSummary;
}

const DEFAULT_SEEDS = 3;

export async function runAudit(options: RunAuditOptions): Promise<RunAuditResult> {
  const seeds = options.seeds ?? DEFAULT_SEEDS;
  const suites = await loadSuite(options.suite, options.rootDir ? { rootDir: options.rootDir } : {});
  const expanded = expandPrompts(suites, seeds);
  await fs.mkdir(options.outDir, { recursive: true });
  const failuresDir = path.join(options.outDir, 'failures');
  await fs.mkdir(failuresDir, { recursive: true });
  const rendersDir = path.join(options.outDir, 'renders');
  if (!options.skipRender) await fs.mkdir(rendersDir, { recursive: true });

  const champion = createBackend('rules');
  const challengers = (options.challengers ?? []).map((n) => ({ name: n, backend: createBackend(n, options.claudeOptions ?? {}) }));

  const championConfusionReports: GenreConfusionReport[] = [];
  const championFailures: Array<{ prompt: ExpandedPrompt; classified: ClassifiedFailure; gates?: QualityGatesReport; critique?: CritiqueEntry; confusion?: GenreConfusionReport }> = [];
  const championPerPrompt: Array<{ prompt: ExpandedPrompt; pass: boolean; categories: FailureCategory[] }> = [];
  const verdicts: ChampionChallengerVerdict[] = [];

  for (const prompt of expanded) {
    const champRun = await runOneBackend(prompt, champion, options, rendersDir);
    if (champRun.confusion) championConfusionReports.push(champRun.confusion);
    const failClass = classifyFailure({
      gates: champRun.gates ?? undefined,
      confusion: champRun.confusion ?? undefined,
      validatorIssues: champRun.result.validator_issues,
      features: champRun.features ?? undefined,
      graph: champRun.result.graph,
    });
    const overallPass =
      champRun.result.validator_issues === 0 &&
      (champRun.gates?.overall_pass ?? true) &&
      (champRun.confusion?.intended_top1 ?? true) &&
      champRun.hard_failures.length === 0;
    championPerPrompt.push({ prompt, pass: overallPass, categories: failClass.categories });
    if (!overallPass || failClass.categories.length > 0) {
      championFailures.push({
        prompt, classified: failClass,
        ...(champRun.gates ? { gates: champRun.gates } : {}),
        ...(champRun.critique ? { critique: champRun.critique } : {}),
        ...(champRun.confusion ? { confusion: champRun.confusion } : {}),
      });
      const failPath = path.join(failuresDir, `${prompt.id}__seed${prompt.seed}.json`);
      await fs.writeFile(failPath, JSON.stringify({
        prompt, categories: failClass.categories, evidence: failClass.evidence,
        gates: champRun.gates?.gates,
        confusion: champRun.confusion ? { top1: champRun.confusion.top1, top3: champRun.confusion.top3, intended_top1: champRun.confusion.intended_top1 } : null,
        validator_issues: champRun.result.validator_issues,
        hard_failures: champRun.hard_failures,
      }, null, 2));
    }
    for (const challenger of challengers) {
      let challRun: BackendRunSummary | undefined;
      try {
        challRun = await runOneBackend(prompt, challenger.backend, options, rendersDir);
      } catch (e) {
        challRun = {
          result: { backend: challenger.name, graph: champRun.result.graph, code: '', validator_issues: -1, warnings: [] },
          rendered: false, hard_failures: [`${challenger.name} threw: ${(e as Error).message}`],
        };
      }
      verdicts.push(decideWinner({
        prompt_id: prompt.id, seed: prompt.seed,
        champion: champRun, challenger: challRun,
      }));
    }
  }

  const confusionMatrix = aggregateConfusion(championConfusionReports);
  const failureCategoryCounts = countCategories(championPerPrompt);
  const ccSummary = challengers.length > 0 ? summarizeCC(verdicts) : undefined;
  const totalChampionPass = championPerPrompt.filter((p) => p.pass).length;

  // Emit four canonical artifacts.
  await fs.writeFile(
    path.join(options.outDir, 'audit-summary.json'),
    JSON.stringify({
      suite: options.suite,
      seeds,
      prompts_total: expanded.length,
      champion_pass: totalChampionPass,
      champion_fail: expanded.length - totalChampionPass,
      champion_failures_by_category: failureCategoryCounts,
      challengers: challengers.map((c) => c.name),
      champion_challenger: ccSummary,
    }, null, 2),
  );
  await fs.writeFile(
    path.join(options.outDir, 'genre-confusion.json'),
    JSON.stringify(confusionMatrix, null, 2),
  );
  await fs.writeFile(
    path.join(options.outDir, 'champion-challenger.json'),
    JSON.stringify(ccSummary ?? { not_run: true }, null, 2),
  );
  await fs.writeFile(
    path.join(options.outDir, 'audit-report.md'),
    renderAuditMarkdown({
      suite: options.suite,
      seeds,
      expanded,
      championPerPrompt,
      failureCategoryCounts,
      confusionMatrix,
      championFailures,
      ccSummary,
    }),
  );

  return {
    outDir: options.outDir,
    prompts_total: expanded.length,
    champion_pass: totalChampionPass,
    champion_fail: expanded.length - totalChampionPass,
    champion_failures_by_category: failureCategoryCounts,
    ...(ccSummary ? { champion_challenger: ccSummary } : {}),
  };
}

interface BackendRunInternals extends BackendRunSummary {
  features?: AnalyzerFeatures | undefined;
}

async function runOneBackend(
  prompt: ExpandedPrompt,
  backend: ReturnType<typeof createBackend>,
  options: RunAuditOptions,
  rendersDir: string,
): Promise<BackendRunInternals> {
  const hard_failures: string[] = [];
  let result: ProducerBackendResult;
  try {
    result = await backend.produce({ brief: prompt.text, seed: prompt.seed });
  } catch (e) {
    return {
      result: { backend: backend.name, graph: blankGraph(prompt.text), code: '', validator_issues: -1, warnings: [(e as Error).message] },
      rendered: false, hard_failures: [`backend ${backend.name} produce error: ${(e as Error).message}`],
    };
  }

  // Recompile to make sure validator stays clean post-backend (covers patch-application paths).
  const recompiled = compileSessionGraph(result.graph);
  const reValidation = validateStrudelCode(recompiled.code);
  const totalValidatorIssues = reValidation.issues.length;
  if (totalValidatorIssues > 0) hard_failures.push(`validator: ${totalValidatorIssues} issues`);

  // Genre confusion (only meaningful with features). When skipRender=true we still
  // compute via static heuristics (BPM proxy from brief).
  let confusion: GenreConfusionReport | undefined;
  let features: AnalyzerFeatures | undefined;
  let gates: QualityGatesReport | undefined;
  let critiqueEntry: CritiqueEntry | undefined;
  let wavPath: string | undefined;
  let rendered = false;

  if (!options.skipRender) {
    const out = path.join(rendersDir, `${prompt.id}__seed${prompt.seed}__${backend.name}.wav`);
    try {
      const { render } = await import('@cactus/renderer');
      const cps = (result.graph.brief.bpm ?? 120) / 240;
      // Cap to keep audit tractable: at most 16 cycles per render.
      const totalBars = Math.min(result.graph.song.total_bars, 16);
      await render({ code: recompiled.code, durationCycles: totalBars, cps, outputPath: out });
      wavPath = out;
      rendered = true;
    } catch (e) {
      hard_failures.push(`render error: ${(e as Error).message}`);
    }
    if (wavPath) {
      try {
        const genre = await loadGenre(prompt.intent_genre).catch(() => undefined);
        // Phase 15: post-render deterministic mix pass — single call to
        // masterTrack (Phase 11) handles BOTH LUFS normalization AND tanh
        // soft-clip true-peak limiting, so the two stages don't self-cancel
        // the way calling normalize+peak-guard separately did.
        if (options.postRenderMix && genre) {
          const m = await masterTrack({
            inputWavPath: wavPath,
            outputWavPath: wavPath,
            targets: {
              lufs: genre.mix_targets.lufs,
              true_peak_max: genre.mix_targets.true_peak_max ?? -1,
            },
          });
          if (Math.abs(m.appliedGainDb) > 18) {
            hard_failures.push(`master gain ${m.appliedGainDb.toFixed(1)} dB exceeds ±18 dB safe range — structural mix issue`);
          }
          // Touch the un-used Phase 15 helpers so eslint/typecheck don't trip;
          // they remain part of the @cactus/mix public API for unit tests.
          void masterNormalize; void guardTruePeak;
        }
        features = await analyzeWav(wavPath);
        const gateInput = {
          wavPath,
          graph: result.graph,
          features,
          ...(genre ? { genreTargets: {
            lufs: genre.mix_targets.lufs,
            true_peak_max: genre.mix_targets.true_peak_max,
            ...(genre.mix_targets.stereo_mono_low_compliance_min !== undefined ? { stereo_mono_low_compliance_min: genre.mix_targets.stereo_mono_low_compliance_min } : {}),
            onset_density_high_floor: onsetFloorForGenre(prompt.intent_genre),
          } } : {}),
        };
        gates = await runQualityGates(gateInput);
        confusion = await scoreGenreConfusion({ intended_genre: prompt.intent_genre, graph: result.graph, features });
        // Phase 15: discriminator-aware re-rank on top of pure rubric distance.
        confusion = applyGenreDiscriminators(confusion, features, result.graph);
        critiqueEntry = await critique({ graph: result.graph, features });
        if (options.diagnostics) {
          const sections = await computeSectionDiagnostics(wavPath, result.graph);
          await writeDiagnosticReport({
            prompt,
            sections,
            outDir: path.join(path.dirname(rendersDir), 'diagnostics'),
          });
        }
      } catch (e) {
        hard_failures.push(`analyze error: ${(e as Error).message}`);
      }
    }
  } else {
    // Static-only path: synthesize features from brief BPM target so genre confusion still functions.
    features = staticFeaturesFromGraph(result.graph);
    confusion = await scoreGenreConfusion({ intended_genre: prompt.intent_genre, graph: result.graph, features });
    critiqueEntry = await critique({ graph: result.graph, features });
  }

  return {
    result: { ...result, validator_issues: totalValidatorIssues },
    rendered,
    ...(wavPath !== undefined ? { wavPath } : {}),
    ...(gates !== undefined ? { gates } : {}),
    ...(critiqueEntry !== undefined ? { critique: critiqueEntry } : {}),
    ...(confusion !== undefined ? { confusion } : {}),
    hard_failures,
    ...(features !== undefined ? { features } : {}),
  };
}

function staticFeaturesFromGraph(graph: SessionGraph): AnalyzerFeatures {
  const bpm = graph.brief.bpm ?? 120;
  return {
    rhythmic: { bpm, bpm_confidence: 0.7, grid_regularity: 0.85, syncopation_proxy: 0.1, onset_density: { low: 2, mid: 2, high: 2 } },
    loudness: { lufs_integrated: graph.mix_graph.master.lufs_target, lufs_short_max: graph.mix_graph.master.lufs_target + 3, true_peak_db: -1.5 },
    stereo: { width_low: 0.05, width_mid: 0.4, width_high: 0.6, mono_low_compliance: 0.95 },
    spectral: { centroid: 1500, rolloff: 5000, flatness: 0.12, flux: 0.5, mfcc_mean: [], mfcc_std: [], band_rms: { sub: 0.05, low: 0.05, low_mid: 0.04, mid: 0.06, high_mid: 0.05, high: 0.04, air: 0.02 } },
  };
}

function onsetFloorForGenre(slug: string): number {
  switch (slug) {
    case 'ambient': return 0;
    case 'dub_techno': return 1;
    case 'house':
    case 'techno': return 2;
    case 'dnb': return 3;
    case 'idm': return 1.5;
    default: return 1;
  }
}

function blankGraph(text: string): SessionGraph {
  return {
    schema_version: '1.0.0',
    session_id: '00000000-0000-4000-8000-000000000000',
    created_at: new Date().toISOString(),
    brief: { text, mood: [], references: [], modifiers: [], constraints: {} },
    song: { cycles_per_bar: 1, total_bars: 1, sections: [{ id: 's', name: 'main', start_bar: 0, end_bar: 1, energy: 0.5, function: 'main' }], energy_curve: [0.5], layer_activation: {} },
    layers: [], pattern_bank: { patterns: {} }, sound_palette: { layers: {} },
    mix_graph: { orbits: {}, master: { gain: 1, lufs_target: -10, true_peak_max: -1 }, sidechain: [], bus_sends: [] },
    render_graph: [], critique_graph: [],
    preference_graph: { decisions: [], weights: { genre_fit: 0.18, groove: 0.16, arrangement_arc: 0.13, sound_design: 0.1, mix_translation: 0.12, memorability_hook: 0.08, originality: 0.06, user_taste_fit: 0.05, technical_validity: 0.12 }, motif_likes: [], sound_likes: [], arrangement_likes: [] },
    iteration_log: [],
  };
}

function countCategories(items: Array<{ categories: FailureCategory[] }>): Record<FailureCategory, number> {
  const out: Record<string, number> = {};
  for (const i of items) {
    for (const c of i.categories) {
      out[c] = (out[c] ?? 0) + 1;
    }
  }
  return out as Record<FailureCategory, number>;
}

interface RenderMarkdownInput {
  suite: string;
  seeds: number;
  expanded: ExpandedPrompt[];
  championPerPrompt: Array<{ prompt: ExpandedPrompt; pass: boolean; categories: FailureCategory[] }>;
  failureCategoryCounts: Record<FailureCategory, number>;
  confusionMatrix: ReturnType<typeof aggregateConfusion>;
  championFailures: Array<{ prompt: ExpandedPrompt; classified: ClassifiedFailure }>;
  ccSummary?: ChampionChallengerSummary;
}

function renderAuditMarkdown(input: RenderMarkdownInput): string {
  const lines: string[] = [];
  lines.push(`# audit report — suite: ${input.suite}`);
  lines.push('');
  const total = input.championPerPrompt.length;
  const pass = input.championPerPrompt.filter((p) => p.pass).length;
  lines.push(`- prompts (with seeds): ${total}`);
  lines.push(`- champion (rules) pass: ${pass} / ${total} (${((pass / Math.max(1, total)) * 100).toFixed(1)}%)`);
  lines.push(`- champion fail: ${total - pass}`);
  lines.push('');
  lines.push('## failure taxonomy (champion)');
  if (Object.keys(input.failureCategoryCounts).length === 0) {
    lines.push('_no failures classified — every champion render passed all gates and intended-genre top-1._');
  } else {
    const sorted = Object.entries(input.failureCategoryCounts).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sorted) lines.push(`- ${cat}: ${count}`);
  }
  lines.push('');
  lines.push(renderConfusionMarkdown(input.confusionMatrix));
  lines.push('## actionable failures (top 20)');
  const actionable = input.championFailures.slice(0, 20);
  if (actionable.length === 0) {
    lines.push('_no actionable failures._');
  } else {
    for (const f of actionable) {
      lines.push(`### ${f.prompt.id} seed=${f.prompt.seed}`);
      lines.push(`- brief: ${f.prompt.text}`);
      lines.push(`- intent: ${f.prompt.intent_genre} (${f.prompt.intent_class})`);
      lines.push(`- categories: ${f.classified.categories.join(', ')}`);
      const ev = f.classified.evidence;
      const evStr = Object.entries(ev).slice(0, 5).map(([k, v]) => `  - ${k}: ${JSON.stringify(v)}`).join('\n');
      if (evStr) lines.push(evStr);
      lines.push('');
    }
  }
  if (input.ccSummary) {
    lines.push('## champion vs challenger');
    lines.push(`- challenger wins: ${input.ccSummary.challenger_wins}`);
    lines.push(`- champion wins:   ${input.ccSummary.champion_wins}`);
    lines.push(`- ties:            ${input.ccSummary.ties}`);
    lines.push(`- not run:         ${input.ccSummary.not_run}`);
  }
  return lines.join('\n') + '\n';
}
