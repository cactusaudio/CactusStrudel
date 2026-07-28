#!/usr/bin/env node
// G11A visual QA: boot the dev server, take screenshots of each screen,
// dump them under apps/studio-ui/screenshots/.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const PORT = Number.parseInt(process.env.STUDIO_UI_PORT || '5174', 10);
const BASE_URL = process.env.STUDIO_UI_URL || `http://localhost:${PORT}`;

async function waitFor(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return; }
    catch { /* keep waiting */ }
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`server at ${url} did not start within ${timeoutMs}ms`);
}

async function pickFirstSessionId() {
  const r = await fetch(`${BASE_URL}/api/sessions`);
  const j = await r.json();
  const sess = j.entries.find((e) => e.type === 'dir' && /^[0-9a-f-]{36}$/.test(e.name));
  return sess?.name;
}

async function pickSessionWithGates() {
  const r = await fetch(`${BASE_URL}/api/sessions`);
  const j = await r.json();
  for (const e of j.entries) {
    if (e.type !== 'dir' || !/^[0-9a-f-]{36}$/.test(e.name)) continue;
    const inv = await fetch(`${BASE_URL}/api/sessions/${e.name}`);
    const ij = await inv.json();
    const hasGates = ij.entries?.some((x) => x.name.endsWith('.quality-gates.json'));
    if (hasGates) return e.name;
  }
  return null;
}

async function pickSessionWithTrace() {
  const r = await fetch(`${BASE_URL}/api/sessions`);
  const j = await r.json();
  for (const e of j.entries) {
    if (e.type !== 'dir' || !/^[0-9a-f-]{36}$/.test(e.name)) continue;
    const inv = await fetch(`${BASE_URL}/api/sessions/${e.name}`);
    const ij = await inv.json();
    const trace = ij.entries?.find((x) => x.name === 'cookbook-trace.json');
    if (!trace) continue;
    // Prefer enabled-mode trace (size>500 — minimal traces are tiny).
    if (trace.size && trace.size > 500) return e.name;
  }
  return null;
}

async function shoot() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('table.dense, .missing-evidence', { timeout: 5000 }).catch(() => undefined);
  await page.screenshot({ path: path.join(HERE, '01-sessions-list.png'), fullPage: true });

  const traceSession = await pickSessionWithTrace();
  if (traceSession) {
    await page.goto(`${BASE_URL}/#session/${traceSession}/overview`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.metric-strip', { timeout: 5000 }).catch(() => undefined);
    await page.screenshot({ path: path.join(HERE, '02-session-overview.png'), fullPage: true });

    await page.goto(`${BASE_URL}/#session/${traceSession}/trace`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.metric-strip, .missing-evidence', { timeout: 5000 }).catch(() => undefined);
    await page.screenshot({ path: path.join(HERE, '03-cookbook-trace.png'), fullPage: true });

    await page.goto(`${BASE_URL}/#session/${traceSession}/gates`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.metric-strip, .missing-evidence', { timeout: 5000 }).catch(() => undefined);
    await page.screenshot({ path: path.join(HERE, '04-quality-gates-missing.png'), fullPage: true });
  }

  await page.goto(`${BASE_URL}/#impact`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.metric-strip, .missing-evidence', { timeout: 5000 }).catch(() => undefined);
  await page.screenshot({ path: path.join(HERE, '05-impact-audit.png'), fullPage: true });

  await page.goto(`${BASE_URL}/#ledger`, { waitUntil: 'networkidle' });
  await page.waitForSelector('table.dense, .missing-evidence', { timeout: 5000 }).catch(() => undefined);
  await page.screenshot({ path: path.join(HERE, '06-ledger.png'), fullPage: true });

  await browser.close();
  console.log('screenshots written to', HERE);
}

async function main() {
  await fs.mkdir(HERE, { recursive: true });
  const server = spawn('pnpm', ['--filter', '@cactus/studio-ui', 'dev'], {
    cwd: REPO_ROOT, stdio: 'pipe',
  });
  server.stdout.on('data', () => undefined);
  server.stderr.on('data', () => undefined);
  try {
    await waitFor(`${BASE_URL}/`);
    await shoot();
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
