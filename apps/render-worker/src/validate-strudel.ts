import { readFileSync } from 'node:fs';
import { validateStrudelCode } from '@cactus/strudel-validator';

const args = process.argv.slice(2);
const json = args.includes('--json');
const stdin = args.includes('--stdin');
const file = args.find((arg) => !arg.startsWith('--'));

if (!stdin && !file) {
  const message = 'usage: validate-strudel.ts [--json] (--stdin | <path.js>)';
  if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(message);
  process.exit(64);
}

let code = '';
try {
  code = stdin ? readFileSync(0, 'utf8') : readFileSync(file!, 'utf8');
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(`[validate-strudel] read failed: ${message}`);
  process.exit(66);
}

const result = validateStrudelCode(code);

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (!result.ok) {
  for (const issue of result.issues) {
    const span = issue.span ? ` @${issue.span.start}-${issue.span.end}` : '';
    console.error(`[${issue.code}]${span} ${issue.message}`);
    if (issue.hint) console.error(`  hint: ${issue.hint}`);
  }
}

process.exit(result.ok ? 0 : 2);
