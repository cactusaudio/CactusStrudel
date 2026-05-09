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
  .description('Generate a full track from a brief')
  .requiredOption('-b, --brief <text>', 'free-text brief')
  .option('--no-render', 'skip rendering audio (graph + code only)')
  .option('--seed <n>', 'PRNG seed for deterministic graph generation')
  .action(async (opts: { brief: string; render: boolean; seed?: string }) => {
    const seed = opts.seed !== undefined ? parseInt(opts.seed, 10) : undefined;
    const r = await produce(opts.brief, {
      skipRender: !opts.render,
      ...(seed !== undefined ? { seed } : {}),
    });
    console.log(JSON.stringify({
      ok: true,
      mode: 'produce',
      session: r.graph.session_id,
      sessionDir: r.sessionDir,
      wavPath: r.wavPath,
      featuresPath: r.featuresPath,
      reportPath: r.reportPath,
      validatorIssues: r.validatorIssues,
    }, null, 2));
  });

program
  .command('revise')
  .description('Apply natural-language feedback to an existing session')
  .requiredOption('-s, --session <id>', 'session id (uuid) to revise')
  .requiredOption('-f, --feedback <text>', 'natural-language feedback')
  .option('--no-render', 'skip rendering audio for the revised iteration')
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
