#!/usr/bin/env node
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import {
  produce,
  parseBrief,
  closedLoopRevise,
  buildSessionGraphFromBrief,
} from '@cactus/agent-runtime';
import { SessionGraphSchema } from '@cactus/ir';
import { compileSessionGraph } from '@cactus/strudel-compiler';
import { critique } from '@cactus/critic';
import { parseFeedback, applyFeedback, recordDecision } from '@cactus/preference';
import { runAudit } from '@cactus/audit';
import { createBackend, type BackendName } from '@cactus/orchestrator';

const program = new Command();
program
  .name('cactus')
  .description('Autonomous Strudel-centered music producer')
  .version('0.0.1');

program
  .command('sketch')
  .description('Generate N candidate sketches and rank them')
  .requiredOption('-b, --brief <text>', 'free-text brief')
  .option('-n, --count <n>', 'number of candidates', '5')
  .option('--no-render', 'skip rendering audio')
  .action(async (opts: { brief: string; count: string; render: boolean }) => {
    const n = Math.max(1, parseInt(opts.count, 10) || 1);
    const results = [];
    for (let i = 0; i < n; i++) {
      const r = await produce(opts.brief, { skipRender: !opts.render, seed: i + 1 });
      results.push({
        session: r.graph.session_id,
        seed: i + 1,
        sessionDir: r.sessionDir,
        wavPath: r.wavPath,
        validatorIssues: r.validatorIssues,
      });
    }
    console.log(JSON.stringify({ ok: true, mode: 'sketch', count: n, results }, null, 2));
  });

program
  .command('produce')
  .description('Generate a track from a brief. Default mode is closed-loop (gated, mixed, revised).')
  .requiredOption('-b, --brief <text>', 'free-text brief')
  .option('--mode <name>', 'draft | closed-loop | audit (default: closed-loop)', 'closed-loop')
  .option('--no-render', 'skip rendering audio (graph + code only) — implies --mode draft + --best-effort')
  .option('--best-effort', 'do not throw on render/analyze failures (still reports them)')
  .option('--max-iterations <n>', 'closed-loop revision cap', '4')
  .option('--severity-floor <f>', 'closed-loop severity floor for accept', '0.5')
  .option('--seed <n>', 'PRNG seed for deterministic graph generation')
  .option('--backend <name>', 'rules | claude-shadow | hybrid (default: rules)', 'rules')
  .action(async (opts: { brief: string; mode: string; render: boolean; bestEffort?: boolean; maxIterations: string; severityFloor: string; seed?: string; backend: string }) => {
    const seed = opts.seed !== undefined ? parseInt(opts.seed, 10) : undefined;
    const backend = (opts.backend as BackendName) ?? 'rules';
    const mode = opts.render === false ? 'draft' : (opts.mode ?? 'closed-loop');
    const bestEffort = opts.bestEffort === true || opts.render === false;

    if (backend === 'rules' && mode === 'closed-loop') {
      const { produceClosedLoop } = await import('./produce-closed-loop.js');
      const r = await produceClosedLoop({
        brief: opts.brief,
        ...(seed !== undefined ? { seed } : {}),
        maxIterations: Math.max(0, parseInt(opts.maxIterations, 10) || 4),
        severityFloor: parseFloat(opts.severityFloor) || 0.5,
        bestEffort,
        emitAuditFailures: false,
      });
      console.log(JSON.stringify({
        ok: r.ok, mode: 'produce', sub_mode: 'closed-loop', backend: 'rules',
        sessionDir: r.sessionDir, iterations: r.iterations, stoppedReason: r.stoppedReason,
        finalWavPath: r.finalWavPath, reportPath: r.reportPath,
        hardFailures: r.hardFailures, failureCategories: r.failureCategories,
      }, null, 2));
      return;
    }
    if (backend === 'rules' && mode === 'audit') {
      const { produceClosedLoop } = await import('./produce-closed-loop.js');
      const r = await produceClosedLoop({
        brief: opts.brief,
        ...(seed !== undefined ? { seed } : {}),
        maxIterations: Math.max(0, parseInt(opts.maxIterations, 10) || 4),
        severityFloor: parseFloat(opts.severityFloor) || 0.5,
        bestEffort,
        emitAuditFailures: true,
      });
      console.log(JSON.stringify({
        ok: r.ok, mode: 'produce', sub_mode: 'audit', backend: 'rules',
        sessionDir: r.sessionDir, iterations: r.iterations, stoppedReason: r.stoppedReason,
        finalWavPath: r.finalWavPath, reportPath: r.reportPath,
        hardFailures: r.hardFailures, failureCategories: r.failureCategories,
      }, null, 2));
      return;
    }
    if (backend === 'rules') {
      // mode === 'draft'
      const r = await produce(opts.brief, {
        skipRender: opts.render === false,
        ...(seed !== undefined ? { seed } : {}),
        bestEffort,
      });
      console.log(JSON.stringify({
        ok: r.failures.length === 0, mode: 'produce', sub_mode: 'draft', backend: 'rules',
        session: r.graph.session_id, sessionDir: r.sessionDir,
        wavPath: r.wavPath, featuresPath: r.featuresPath, reportPath: r.reportPath,
        validatorIssues: r.validatorIssues, failures: r.failures,
      }, null, 2));
      return;
    }
    // Non-rules backend: execute via the backend abstraction; no session bundle yet.
    const b = createBackend(backend);
    const result = await b.produce({ brief: opts.brief, ...(seed !== undefined ? { seed } : {}) });
    console.log(JSON.stringify({
      ok: true, mode: 'produce', backend,
      session: result.graph.session_id,
      validator_issues: result.validator_issues,
      warnings: result.warnings,
      compiled_code_length: result.code.length,
      note: 'Non-rules backend output is not (yet) bundled; promote via audit comparison.',
    }, null, 2));
  });

program
  .command('audit')
  .description('Run an adversarial audit suite against the deterministic champion (and optional challengers)')
  .requiredOption('--suite <name>', "suite name: 'smoke', 'genre-core', or any directory under tests/fixtures/audits/")
  .option('--seeds <n>', 'seeds per prompt', '3')
  .option('--out <dir>', 'output directory (default: sessions/audits/<timestamp>)')
  .option('--no-render', 'skip rendering (analyzer-only static path)')
  .option('--challenger <name>', 'add challenger backend (claude-shadow | hybrid)', collect, [])
  .action(async (opts: { suite: string; seeds: string; out?: string; render: boolean; challenger: string[] }) => {
    const seeds = Math.max(1, parseInt(opts.seeds, 10) || 1);
    const outDir = opts.out ?? path.resolve('sessions', 'audits', new Date().toISOString().replace(/[:.]/g, '-'));
    const r = await runAudit({
      suite: opts.suite,
      seeds,
      outDir,
      skipRender: !opts.render,
      challengers: (opts.challenger as BackendName[]) ?? [],
    });
    console.log(JSON.stringify({
      ok: true,
      mode: 'audit',
      suite: opts.suite,
      seeds,
      outDir: r.outDir,
      prompts_total: r.prompts_total,
      champion_pass: r.champion_pass,
      champion_fail: r.champion_fail,
      champion_failures_by_category: r.champion_failures_by_category,
      report: path.join(r.outDir, 'audit-report.md'),
      summary: path.join(r.outDir, 'audit-summary.json'),
    }, null, 2));
  });

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

program
  .command('audit:repair')
  .description('Champion repair audit: smoke suite, real WAV, rules backend only, diagnostics on. Default loop for baseline improvement work.')
  .option('--out <dir>', 'output directory (default: sessions/audits/repair-<timestamp>)')
  .option('--seeds <n>', 'seeds per prompt', '1')
  .option('--no-mix', 'skip post-render mix pass (for diff comparisons against pre-Phase-15 audio)')
  .action(async (opts: { out?: string; seeds: string; mix: boolean }) => {
    const seeds = Math.max(1, parseInt(opts.seeds, 10) || 1);
    const outDir = opts.out ?? path.resolve('sessions', 'audits', `repair-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    const r = await runAudit({
      suite: 'smoke',
      seeds,
      outDir,
      skipRender: false,
      postRenderMix: opts.mix,
      diagnostics: true,
      challengers: [],
    });
    const failureSummary = Object.keys(r.champion_failures_by_category).length === 0
      ? 'no failures classified'
      : Object.entries(r.champion_failures_by_category).map(([cat, n]) => `${cat}=${n}`).join(', ');
    console.log(JSON.stringify({
      ok: true,
      mode: 'audit:repair',
      seeds,
      outDir: r.outDir,
      prompts_total: r.prompts_total,
      champion_pass: r.champion_pass,
      champion_fail: r.champion_fail,
      failures: failureSummary,
      report: path.join(r.outDir, 'audit-report.md'),
      diagnostics_dir: path.join(r.outDir, 'diagnostics'),
    }, null, 2));
  });

program
  .command('revise')
  .description('G3: apply natural-language feedback (en/zh/mixed) — parses feedback, plans + applies patches, re-renders, scores locality, writes revision report')
  .requiredOption('-s, --session <id>', 'session id (uuid) to revise')
  .requiredOption('-f, --feedback <text>', 'natural-language feedback (English / Chinese / mixed)')
  .option('--no-render', 'skip rendering the revised iteration (graph + plan + locality only)')
  .option('--fatal', 'render/analyze failure aborts the revise (default: best-effort)')
  .option('--root <dir>', 'sessions directory root', './sessions')
  .action(async (opts: { session: string; feedback: string; render: boolean; fatal?: boolean; root: string }) => {
    const sessionDir = path.resolve(opts.root, opts.session);
    const { revise } = await import('./revise.js');
    const r = await revise({
      sessionDir,
      feedback: opts.feedback,
      bestEffort: opts.fatal !== true,
      skipRender: opts.render === false,
    });
    console.log(JSON.stringify({
      ok: r.ok, mode: 'revise', session: r.sessionId,
      prev_iter: r.prevIter, next_iter: r.nextIter,
      patches_planned: r.patchesPlanned, patches_applied: r.patchesApplied,
      drift_severity: r.drift_severity, invariant_violations: r.invariant_violations,
      rendered_wav: r.renderedWav, report: r.reportPath,
      hard_failures: r.hardFailures,
    }, null, 2));
  });

// Legacy revise (kept for back-compat) — preserved below as a hidden alternative
// command path is not added; the revise above replaces it. The local-only iteration
// listing helper stays for `cactus stems` / `cactus explain` / `cactus taste`.
program
  .command('revise-legacy', { hidden: true })
  .description('legacy weight-only revise (preserved for back-compat)')
  .requiredOption('-s, --session <id>')
  .requiredOption('-f, --feedback <text>')
  .option('--no-render')
  .option('--root <dir>', 'sessions directory root', './sessions')
  .action(async (opts: { session: string; feedback: string; render: boolean; root: string }) => {
    const sessionDir = path.resolve(opts.root, opts.session);
    const iters = await listIters(sessionDir);
    if (iters.length === 0) {
      throw new Error(`no iterations found in ${sessionDir}`);
    }
    const lastIter = iters[iters.length - 1]!;
    const lastFile = path.join(sessionDir, `iter_${String(lastIter).padStart(4, '0')}.json`);
    const graph = SessionGraphSchema.parse(JSON.parse(await fs.readFile(lastFile, 'utf8')));

    const parsed = parseFeedback(opts.feedback);
    const newWeights = applyFeedback(graph.preference_graph.weights, parsed);
    graph.preference_graph.weights = newWeights;
    graph.preference_graph = recordDecision(graph.preference_graph, {
      decision_id: uuid(),
      timestamp: new Date().toISOString(),
      kind: 'feedback',
      feedback_text: opts.feedback,
      inferred_attributes: parsed.attribute_preferences,
    });

    // Apply the parsed revision hints directly via closedLoopRevise's evaluate path:
    // we call critique with a synthetic features object that triggers the user's hint
    // categories. For Phase 10 simplicity, just record the feedback + adjust weights.
    const nextIter = lastIter + 1;
    const nextFile = path.join(sessionDir, `iter_${String(nextIter).padStart(4, '0')}.json`);
    await fs.writeFile(nextFile, JSON.stringify(graph, null, 2));

    // Re-compile.
    const compiled = compileSessionGraph(graph);
    const codeFile = path.join(sessionDir, `iter_${String(nextIter).padStart(4, '0')}.strudel.js`);
    await fs.writeFile(codeFile, compiled.code);

    console.log(JSON.stringify({
      ok: true,
      mode: 'revise',
      session: graph.session_id,
      iteration: nextIter,
      parsed_feedback: parsed,
      new_weights: newWeights,
      sessionDir,
    }, null, 2));
  });

program
  .command('stems')
  .description('Export per-orbit stems for a session')
  .requiredOption('-s, --session <id>')
  .option('--root <dir>', 'sessions directory root', './sessions')
  .action(async (opts: { session: string; root: string }) => {
    const sessionDir = path.resolve(opts.root, opts.session);
    const iters = await listIters(sessionDir);
    if (iters.length === 0) throw new Error(`no iterations found in ${sessionDir}`);
    const lastIter = iters[iters.length - 1]!;
    const file = path.join(sessionDir, `iter_${String(lastIter).padStart(4, '0')}.json`);
    const graph = SessionGraphSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));

    const { renderStemsByOrbit } = await import('@cactus/mastering');
    const { render } = await import('@cactus/renderer');
    const stemsDir = path.join(sessionDir, 'stems');
    const r = await renderStemsByOrbit({
      graph,
      outputDir: stemsDir,
      renderFn: async (i) => render(i),
    });
    console.log(JSON.stringify({
      ok: true,
      mode: 'stems',
      session: graph.session_id,
      stemsDir,
      stems: r.stems,
    }, null, 2));
  });

program
  .command('explain')
  .description('Show why the system made choices in a session')
  .requiredOption('-s, --session <id>')
  .option('--root <dir>', 'sessions directory root', './sessions')
  .action(async (opts: { session: string; root: string }) => {
    const sessionDir = path.resolve(opts.root, opts.session);
    const iters = await listIters(sessionDir);
    if (iters.length === 0) throw new Error(`no iterations found in ${sessionDir}`);
    for (const i of iters) {
      const file = path.join(sessionDir, `iter_${String(i).padStart(4, '0')}.json`);
      const graph = SessionGraphSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
      console.log(`# iter ${i}`);
      console.log(`brief: ${graph.brief.text}`);
      console.log(`genre: ${graph.brief.primary_genre}`);
      console.log(`bpm: ${graph.brief.bpm}`);
      console.log(`layers: ${graph.layers.map((l) => l.id).join(', ')}`);
      console.log(`patches: ${graph.iteration_log.flatMap((it) => it.patches.map((p) => p.intent)).join('\n  - ')}`);
      console.log('');
    }
  });

program
  .command('taste')
  .description('Inspect preference memory across all sessions')
  .option('--root <dir>', 'sessions directory root', './sessions')
  .action(async (opts: { root: string }) => {
    const root = path.resolve(opts.root);
    let sessions: string[] = [];
    try { sessions = await fs.readdir(root); } catch { /* no sessions yet */ }
    const decisions: Array<{ session: string; decision: unknown }> = [];
    for (const s of sessions) {
      try {
        const iters = await listIters(path.join(root, s));
        if (iters.length === 0) continue;
        const lastIter = iters[iters.length - 1]!;
        const file = path.join(root, s, `iter_${String(lastIter).padStart(4, '0')}.json`);
        const graph = SessionGraphSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
        for (const d of graph.preference_graph.decisions) {
          decisions.push({ session: s, decision: d });
        }
      } catch {
        /* skip malformed sessions */
      }
    }
    console.log(JSON.stringify({ ok: true, mode: 'taste', total_decisions: decisions.length, decisions }, null, 2));
  });

async function listIters(dir: string): Promise<number[]> {
  let entries: string[] = [];
  try { entries = await fs.readdir(dir); } catch { return []; }
  return entries
    .filter((n) => /^iter_\d{4}\.json$/.test(n))
    .map((n) => Number(n.slice(5, 9)))
    .sort((a, b) => a - b);
}

program.parseAsync(process.argv).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
