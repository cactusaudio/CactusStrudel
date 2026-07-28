#!/usr/bin/env node
// G1: real SessionGraph validator hook. Reads PostToolUse JSON on stdin,
// looks at `tool_input.file_path`, and runs the actual SessionGraphSchema
// (zod) against the touched JSON. Replaces the old jq-only top-level-keys
// check.
//
// Exit codes match Claude Code hook contract: 0 = allow, 2 = non-blocking
// error with stderr shown to Claude.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function main() {
  const stdin = await readStdin();
  let payload = {};
  try { payload = JSON.parse(stdin); } catch { /* */ }
  const filePath = payload?.tool_input?.file_path ?? '';
  if (!filePath) process.exit(0);

  const inSession = /\/sessions\/[^/]+\/iter_\d+\.json$/i.test(filePath);
  const inFixture = /\/tests\/fixtures\/session-graphs\/.+\.json$/i.test(filePath);
  const inAuditFixture = /\/tests\/fixtures\/regressions\/.+\/session-graph\.json$/i.test(filePath);
  if (!inSession && !inFixture && !inAuditFixture) process.exit(0);

  let text;
  try { text = await fs.readFile(filePath, 'utf8'); } catch { process.exit(0); }
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) {
    process.stderr.write(`SessionGraph validator: ${filePath}: malformed JSON: ${e.message}\n`);
    process.exit(2);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..');
  const irEntry = path.join(repoRoot, 'packages', 'ir', 'src', 'index.ts');
  const { SessionGraphSchema } = await import(pathToFileURL(irEntry).href);

  const result = SessionGraphSchema.safeParse(parsed);
  if (result.success) process.exit(0);
  const issues = result.error.issues.slice(0, 10).map((i) => `  ${i.path.join('.')}: ${i.message}`);
  process.stderr.write(
    `SessionGraph validator caught ${result.error.issues.length} schema issue(s) in ${filePath}:\n` +
    issues.join('\n') + '\n',
  );
  if (result.error.issues.length > 10) process.stderr.write(`... and ${result.error.issues.length - 10} more.\n`);
  process.exit(2);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });
}

main().catch((err) => {
  process.stderr.write(`validate-graph hook crashed: ${err?.message ?? String(err)}\n`);
  process.exit(0);
});
