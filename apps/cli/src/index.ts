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

program
  .command('bundle')
  .description('G10: package the latest iteration into bundle-iter_NNNN/ + manifest (+ optional bundle-iter_NNNN.zip)')
  .requiredOption('-s, --session <id>', 'session id (uuid)')
  .option('--iter <n>', 'iteration to bundle (default: latest)')
  .option('--no-zip', 'skip the .zip step (always writes the bundle directory)')
  .option('--root <dir>', 'sessions directory root', './sessions')
  .action(async (opts: { session: string; iter?: string; zip: boolean; root: string }) => {
    const sessionDir = path.resolve(opts.root, opts.session);
    const { bundleSession } = await import('./bundle.js');
    const r = await bundleSession({
      sessionDir,
      ...(opts.iter !== undefined ? { iteration: Number(opts.iter) } : {}),
      makeZip: opts.zip,
    });
    console.log(JSON.stringify({
      ok: true, mode: 'bundle', session: opts.session, iteration: r.iteration,
      bundle_dir: r.bundleDir, zip: r.zipPath ?? null,
      file_count: r.files.length,
      bytes_total: r.files.reduce((acc, f) => acc + f.bytes, 0),
      manifest: r.manifestPath, warnings: r.warnings,
    }, null, 2));
  });

// G9 §2: cookbook subcommands. The validate command is the gate that the
// final acceptance lists; audit prints per-genre/role counts + diversity.
const cookbook = program
  .command('cookbook')
  .description('G9: cookbook lifecycle — validate, audit, diversity report');

cookbook
  .command('validate')
  .description('G9: validate every cookbook entry against the v2 schema + strudel syntax + duplicate-id + near-duplicate checks')
  .option('--genre <slug>', 'limit to one genre')
  .option('--role <name>', 'limit to one role within --genre')
  .option('--json', 'emit machine-readable JSON')
  .action(async (opts: { genre?: string; role?: string; json?: boolean }) => {
    const { validateCookbook, formatValidationReport } = await import('@cactus/cookbook');
    const validateOpts: { genre?: string; role?: string } = {};
    if (opts.genre !== undefined) validateOpts.genre = opts.genre;
    if (opts.role !== undefined) validateOpts.role = opts.role;
    const r = await validateCookbook(validateOpts);
    if (opts.json) console.log(JSON.stringify(r, null, 2));
    else console.log(formatValidationReport(r));
    if (!r.ok) process.exit(1);
  });

// G9 §8: cookbook-impact A/B audit. Compares mode='minimal' vs mode='enabled'
// across the existing prompt-suite plumbing and emits a verdict.
program
  .command('audit:cookbook-impact')
  .description('G9/G9B: A/B compare cookbook modes. Suites: smoke (skipRender) | smoke-real | micro-real')
  .option('--suite <name>', 'prompt suite (smoke | smoke-real | micro-real)', 'smoke')
  .option('--seeds <n>', 'seeds per prompt', '1')
  .option('--genres <list>', 'comma-separated genre filter (smoke-real / micro-real only)')
  .option('--out <dir>', 'output dir', './audits/cookbook-impact')
  .action(async (opts: { suite: string; seeds: string; out: string; genres?: string }) => {
    if (opts.suite === 'smoke-real' || opts.suite === 'micro-real') {
      const { runRealRenderImpactAudit } = await import('./cookbook-impact-real.js');
      const r = await runRealRenderImpactAudit({
        suite: opts.suite,
        seeds: parseInt(opts.seeds, 10),
        ...(opts.genres ? { genres: opts.genres.split(',').map((s) => s.trim()) } : {}),
      });
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    const { runAudit, decideVerdict } = await import('@cactus/audit');
    const { loadCookbookEntries, diversityReport } = await import('@cactus/cookbook');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.resolve(opts.out, ts);
    await fs.mkdir(outDir, { recursive: true });

    const seeds = parseInt(opts.seeds, 10);
    const modes: Array<'minimal' | 'enabled'> = ['minimal', 'enabled'];
    const summaries: Array<{
      mode: typeof modes[number];
      prompts_total: number; rendered: number;
      render_failures: number; analyzer_failures: number;
      gate_pass: number; gate_fail: number;
      diversity_mean_overlap?: number; critic_issue_count: number;
    }> = [];

    for (const mode of modes) {
      process.env.CACTUS_COOKBOOK_MODE = mode;
      const modeDir = path.join(outDir, mode);
      await fs.mkdir(modeDir, { recursive: true });
      const r = await runAudit({
        suite: opts.suite, seeds, outDir: modeDir,
        skipRender: true, // keep impact-audit tractable; mode comparison runs against gates from analysis-shaped data
        challengers: [],
      });
      summaries.push({
        mode,
        prompts_total: r.prompts_total,
        rendered: 0,
        render_failures: 0,
        analyzer_failures: 0,
        gate_pass: r.champion_pass,
        gate_fail: r.champion_fail,
        critic_issue_count: 0,
      });
    }
    delete process.env.CACTUS_COOKBOOK_MODE;

    // Diversity: load the cookbook itself and report homogeneity.
    const loaded = await loadCookbookEntries();
    const div = diversityReport(loaded.entries);
    const enabled = summaries.find((s) => s.mode === 'enabled');
    if (enabled) {
      // Use the cookbook's mean homogeneity as a proxy for "what the
      // enabled variant offers". A higher value = entries are more
      // similar to each other (less diverse).
      const meanOverlap = div.per_bucket_homogeneity.length === 0
        ? 0
        : div.per_bucket_homogeneity.reduce((a, b) => a + b.mean_overlap, 0) / div.per_bucket_homogeneity.length;
      enabled.diversity_mean_overlap = meanOverlap;
    }

    const verdict = decideVerdict(summaries.map((s) => ({
      mode: s.mode,
      prompts_total: s.prompts_total,
      rendered: s.rendered,
      render_failures: s.render_failures,
      analyzer_failures: s.analyzer_failures,
      gate_pass: s.gate_pass,
      gate_fail: s.gate_fail,
      critic_issue_count: s.critic_issue_count,
      ...(s.diversity_mean_overlap !== undefined ? { diversity_mean_overlap: s.diversity_mean_overlap } : {}),
    })));

    const report = {
      ok: true,
      mode: 'cookbook-impact',
      ts: new Date().toISOString(),
      suite: opts.suite,
      seeds,
      modes,
      per_mode: summaries,
      cookbook_diversity: {
        total_entries: div.total_entries,
        bucket_homogeneity: div.per_bucket_homogeneity,
        near_duplicate_pairs: div.near_duplicate_pairs.length,
      },
      verdict: verdict.verdict,
      notes: verdict.notes,
      out_dir: outDir,
    };
    await fs.writeFile(path.join(outDir, 'cookbook-impact-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  });

cookbook
  .command('render-audit')
  .description('G9B §2: render every audible cookbook entry, analyze, classify')
  .option('--genre <slug>')
  .option('--role <name>')
  .option('--changed', 'only audit entries with status unvalidated/diagnostic/experimental')
  .option('--out <dir>')
  .option('--dry-run', 'classify by schema/syntax only, do not boot renderer')
  .action(async (opts: { genre?: string; role?: string; changed?: boolean; out?: string; dryRun?: boolean }) => {
    const { runCookbookRenderAudit, writeCookbookRenderAuditReport } = await import('./cookbook-render-audit.js');
    const r = await runCookbookRenderAudit({
      ...(opts.genre ? { genre: opts.genre } : {}),
      ...(opts.role ? { role: opts.role } : {}),
      ...(opts.changed ? { changedOnly: true } : {}),
      ...(opts.out ? { outDir: opts.out } : {}),
      ...(opts.dryRun ? { dryRun: true } : {}),
    });
    await writeCookbookRenderAuditReport(r);
    console.log(JSON.stringify({
      ok: r.by_classification.rejected_silent === 0
          && r.by_classification.rejected_render_error === 0
          && r.by_classification.rejected_validation_error === 0,
      mode: 'cookbook-render-audit',
      out_dir: r.out_dir,
      total: r.total,
      by_classification: r.by_classification,
    }, null, 2));
  });

cookbook
  .command('ledger-check')
  .description('G9B §8: validate every promoted prior in learning_ledger/cookbook/promoted_priors/ has full evidence')
  .option('--root <dir>', 'repo root (where learning_ledger/ lives); defaults to walking up from cwd')
  .action(async (opts: { root?: string }) => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    let root = opts.root ?? process.cwd();
    if (!opts.root) {
      // Walk up from cwd until we find a learning_ledger/ dir; this makes
      // the command work whether you invoke from repo root or apps/cli/.
      let cur = process.cwd();
      for (let i = 0; i < 5; i++) {
        try {
          const stat = await fs.stat(path.join(cur, 'learning_ledger'));
          if (stat.isDirectory()) { root = cur; break; }
        } catch { /* keep walking */ }
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
    }
    const dir = path.resolve(root, 'learning_ledger', 'cookbook', 'promoted_priors');
    let entries: string[] = [];
    try { entries = await fs.readdir(dir); } catch { entries = []; }
    const REQUIRED = [
      'source trigger', 'proposed prior', 'expected benefit', 'possible harm',
      'validation evidence', 'promotion decision', 'rollback path',
    ];
    const issues: Array<{ file: string; missing: string[] }> = [];
    for (const f of entries) {
      if (!f.endsWith('.md')) continue;
      const text = await fs.readFile(path.join(dir, f), 'utf8').catch(() => '');
      const missing = REQUIRED.filter((sec) => !text.toLowerCase().includes(sec.toLowerCase()));
      if (missing.length > 0) issues.push({ file: f, missing });
    }
    const report = {
      ok: issues.length === 0,
      mode: 'cookbook-ledger-check',
      promoted_priors_dir: dir,
      promoted_files: entries.filter((f) => f.endsWith('.md')),
      issues,
    };
    console.log(JSON.stringify(report, null, 2));
    if (issues.length > 0) process.exit(1);
  });

cookbook
  .command('audit')
  .description('G9: print per-genre/role counts, mean homogeneity, and near-duplicate pairs')
  .option('--genre <slug>', 'limit to one genre')
  .option('--role <name>', 'limit to one role')
  .option('--all', 'include all genres + roles (default)')
  .action(async (opts: { genre?: string; role?: string }) => {
    const { loadCookbookEntries, diversityReport } = await import('@cactus/cookbook');
    const loaded = await loadCookbookEntries();
    const filtered = loaded.entries.filter((e) =>
      (!opts.genre || e.genre === opts.genre) &&
      (!opts.role || e.role === opts.role),
    );
    const div = diversityReport(filtered);
    console.log(JSON.stringify({
      ok: loaded.issues.length === 0,
      mode: 'cookbook-audit',
      ...(opts.genre ? { filter_genre: opts.genre } : {}),
      ...(opts.role ? { filter_role: opts.role } : {}),
      total_entries: div.total_entries,
      per_genre_role: div.per_genre_role_counts,
      bucket_homogeneity: div.per_bucket_homogeneity,
      near_duplicate_pairs: div.near_duplicate_pairs,
      load_issues: loaded.issues,
    }, null, 2));
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
