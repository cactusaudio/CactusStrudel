#!/usr/bin/env node
// G1: real Strudel validator hook. Reads PostToolUse JSON on stdin, looks at
// `tool_input.file_path`, and runs the actual @cactus/strudel-validator
// against the touched file. For `.jsonl` cookbook files it parses each line
// and validates the `mini_notation` / `raw` fields.
//
// Exit codes follow the Claude Code hook contract:
//   0  = allow (no feedback)
//   2  = non-blocking error; stderr is shown to Claude as feedback
//   other = silent error (only debug log)

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function main() {
  const stdin = await readStdin();
  let payload = {};
  try { payload = JSON.parse(stdin); } catch { /* tolerate non-JSON probes */ }
  const filePath = payload?.tool_input?.file_path ?? '';
  if (!filePath) process.exit(0);

  // Only validate Strudel-shaped files we know how to read.
  const isStrudelJs = /\.strudel\.js$/i.test(filePath);
  const isCookbookJsonl = /\/cookbook\/.+\.jsonl$/i.test(filePath);
  const isFixtureSnippet = /\/tests\/fixtures\/strudel-snippets\//i.test(filePath);
  if (!isStrudelJs && !isCookbookJsonl && !isFixtureSnippet) process.exit(0);

  let text;
  try { text = await fs.readFile(filePath, 'utf8'); } catch { process.exit(0); }

  // Lazy-load the validator from the workspace via dynamic file URL so this
  // script works with tsx-resolution rules from any cwd.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..');
  const validatorEntry = path.join(repoRoot, 'packages', 'strudel-validator', 'src', 'index.ts');
  const { validateStrudelCode, validateMiniNotation } = await import(pathToFileURL(validatorEntry).href);

  const issues = [];
  if (isStrudelJs) {
    const r = validateStrudelCode(text);
    for (const i of r.issues) issues.push(`${filePath}: [${i.code}] ${i.message}${i.hint ? ' — ' + i.hint : ''}`);
  } else {
    // .jsonl: validate each line's mini_notation + raw.
    const lines = text.split('\n').map((l, i) => ({ line: i + 1, text: l.trim() })).filter((l) => l.text);
    for (const { line, text: t } of lines) {
      let entry;
      try { entry = JSON.parse(t); } catch { issues.push(`${filePath}:${line}: malformed JSON`); continue; }
      if (entry.mini_notation) {
        const r = validateMiniNotation(entry.mini_notation);
        for (const i of r.issues) issues.push(`${filePath}:${line}: mini-notation [${i.code}] ${i.message}`);
      }
      if (entry.raw) {
        const r = validateStrudelCode(entry.raw);
        for (const i of r.issues) issues.push(`${filePath}:${line}: raw-code [${i.code}] ${i.message}${i.hint ? ' — ' + i.hint : ''}`);
      }
    }
  }

  if (issues.length === 0) process.exit(0);
  // Inject feedback to Claude via stderr + exit 2 (non-blocking but visible).
  process.stderr.write(`Strudel validator caught ${issues.length} issue(s):\n` + issues.slice(0, 20).join('\n') + '\n');
  if (issues.length > 20) process.stderr.write(`... and ${issues.length - 20} more.\n`);
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
  process.stderr.write(`validate-strudel hook crashed: ${err?.message ?? String(err)}\n`);
  process.exit(0); // do not block on hook crash; Claude Code's debug log will show it
});
