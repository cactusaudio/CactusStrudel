#!/usr/bin/env node
import { Command } from 'commander';
import { produce } from '@cactus/agent-runtime';

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
  .requiredOption('-s, --session <id>')
  .requiredOption('-f, --feedback <text>')
  .action((_opts) => {
    throw new Error('revise not implemented yet (Phase 10)');
  });

program
  .command('stems')
  .description('Export stems for a session')
  .requiredOption('-s, --session <id>')
  .action((_opts) => {
    throw new Error('stems not implemented yet (Phase 11)');
  });

program
  .command('explain')
  .description('Show why the system made choices')
  .requiredOption('-s, --session <id>')
  .action((_opts) => {
    throw new Error('explain not implemented yet');
  });

program
  .command('taste')
  .description('Inspect or edit preference memory')
  .action(() => {
    throw new Error('taste not implemented yet (Phase 10)');
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
