#!/usr/bin/env node
import { Command } from 'commander';
import { createSessionGraph } from '@cactus/ir';

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
  .action(async (opts: { brief: string; count: string }) => {
    const graph = createSessionGraph({ brief: { text: opts.brief } });
    console.log(JSON.stringify({ ok: true, session: graph.session_id, mode: 'sketch', count: opts.count }, null, 2));
  });

program
  .command('produce')
  .description('Expand to a full track')
  .requiredOption('-b, --brief <text>', 'free-text brief')
  .action(async (opts: { brief: string }) => {
    const graph = createSessionGraph({ brief: { text: opts.brief } });
    console.log(JSON.stringify({ ok: true, session: graph.session_id, mode: 'produce' }, null, 2));
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
