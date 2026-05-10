// G1: smoke tests for the real hook validators. Spawn the actual node script
// with synthetic PostToolUse JSON on stdin and assert exit codes + stderr.

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const STRUDEL_HOOK = path.join(REPO_ROOT, 'scripts', 'hooks', 'validate-strudel-on-write.mjs');
const GRAPH_HOOK = path.join(REPO_ROOT, 'scripts', 'hooks', 'validate-graph-on-write.mjs');
const TMP = path.join(os.tmpdir(), 'cactus-hook-tests');

interface HookResult { code: number | null; stderr: string; stdout: string }

function runHook(script: string, payload: object): Promise<HookResult> {
  return new Promise((resolve) => {
    // Use tsx so the script can dynamically import the workspace's TS sources.
    const child = spawn('pnpm', ['exec', 'tsx', script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code, stderr, stdout }));
    child.stdin.end(JSON.stringify(payload));
  });
}

async function tmpFile(name: string, content: string): Promise<string> {
  await fs.mkdir(TMP, { recursive: true });
  const p = path.join(TMP, name);
  await fs.writeFile(p, content);
  return p;
}

describe('validate-strudel-on-write hook', () => {
  it('exits 0 for non-Strudel paths', async () => {
    const r = await runHook(STRUDEL_HOOK, { tool_input: { file_path: '/some/other/file.txt' } });
    expect(r.code).toBe(0);
  });

  it('exits 0 for valid Strudel code in a .strudel.js file', async () => {
    const file = await tmpFile('valid.strudel.js', `setcps(0.5)\nstack(s("bd*4"), s("hh*8").gain(0.7))`);
    const r = await runHook(STRUDEL_HOOK, { tool_input: { file_path: file } });
    expect(r.code).toBe(0);
  }, 30_000);

  it('exits 2 with stderr feedback for invalid Strudel code', async () => {
    const file = await tmpFile('bad.strudel.js', `s("bd*4").reverb(0.5)`); // reverb = hallucinated
    const r = await runHook(STRUDEL_HOOK, { tool_input: { file_path: file } });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/reverb/);
  }, 30_000);

  it('validates cookbook .jsonl line by line', async () => {
    // /cookbook/ path required for the regex match.
    const dir = path.join(TMP, 'cookbook', 'genre');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'role.jsonl');
    await fs.writeFile(file, [
      JSON.stringify({ id: '1', mini_notation: 'bd*4' }),
      JSON.stringify({ id: '2', mini_notation: '[bd ~ sn' }), // unbalanced
    ].join('\n'));
    const r = await runHook(STRUDEL_HOOK, { tool_input: { file_path: file } });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/UNCLOSED_OPEN|MISMATCHED_BRACKET/);
  }, 30_000);
});

describe('validate-graph-on-write hook', () => {
  it('exits 0 for non-graph paths', async () => {
    const r = await runHook(GRAPH_HOOK, { tool_input: { file_path: '/some/other/file.txt' } });
    expect(r.code).toBe(0);
  });

  it('exits 2 for malformed JSON in a session-graph fixture', async () => {
    const dir = path.join(TMP, 'tests', 'fixtures', 'session-graphs');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'broken.json');
    await fs.writeFile(file, '{ this is not json');
    const r = await runHook(GRAPH_HOOK, { tool_input: { file_path: file } });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/malformed JSON/);
  });

  it('exits 2 for a graph that fails SessionGraphSchema', async () => {
    const dir = path.join(TMP, 'tests', 'fixtures', 'session-graphs');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'bad-shape.json');
    // missing required fields
    await fs.writeFile(file, JSON.stringify({ schema_version: '1.0.0' }));
    const r = await runHook(GRAPH_HOOK, { tool_input: { file_path: file } });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/schema issue/);
  });
});
