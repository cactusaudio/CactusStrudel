// G10: cactus bundle — packages a session's latest iteration into a portable
// bundle/ directory with a manifest, then optionally zips it via the system
// `zip` binary. Manifest carries hashes + provenance so reviewers can verify
// they're looking at the same artifacts the run produced.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export interface BundleInput {
  sessionDir: string;
  /** Optional iteration number; defaults to latest. */
  iteration?: number;
  /**
   * If true, run `zip -r bundle.zip bundle/` after writing the directory.
   * Default true. If `zip` is not on PATH, this becomes a no-op + warning.
   */
  makeZip?: boolean;
}

export interface BundleResult {
  bundleDir: string;
  zipPath?: string;
  manifestPath: string;
  files: Array<{ rel: string; bytes: number; sha256: string }>;
  iteration: number;
  warnings: string[];
}

const CANONICAL_FILES: Array<{ tag: string; ext: string; required: boolean }> = [
  { tag: 'graph', ext: '.json', required: true },
  { tag: 'code', ext: '.strudel.js', required: true },
  { tag: 'wav', ext: '.wav', required: false },
  { tag: 'features', ext: '.features.json', required: false },
  { tag: 'gates', ext: '.quality-gates.json', required: false },
  { tag: 'critique', ext: '.critique.json', required: false },
  { tag: 'failure-taxonomy', ext: '.failure-taxonomy.json', required: false },
  { tag: 'plan', ext: '.revision-plan.json', required: false },
  { tag: 'locality', ext: '.locality.json', required: false },
  { tag: 'failed-patches', ext: '.failed-patches.json', required: false },
  { tag: 'spectrogram', ext: '.spectrogram.png', required: false },
];

export async function bundleSession(input: BundleInput): Promise<BundleResult> {
  const warnings: string[] = [];
  const iters = await listIters(input.sessionDir);
  if (iters.length === 0) throw new Error(`bundle: no iterations found in ${input.sessionDir}`);
  const iter = input.iteration ?? iters[iters.length - 1]!;
  if (!iters.includes(iter)) {
    throw new Error(`bundle: iteration ${iter} not found (have: ${iters.join(', ')})`);
  }

  const tag = `iter_${String(iter).padStart(4, '0')}`;
  const bundleDir = path.join(input.sessionDir, `bundle-${tag}`);
  await fs.rm(bundleDir, { recursive: true, force: true });
  await fs.mkdir(bundleDir, { recursive: true });

  const collected: Array<{ rel: string; bytes: number; sha256: string }> = [];

  // 1. Iteration artifacts.
  for (const c of CANONICAL_FILES) {
    const src = path.join(input.sessionDir, `${tag}${c.ext}`);
    if (!(await exists(src))) {
      if (c.required) {
        throw new Error(`bundle: required artifact missing: ${src}`);
      }
      continue;
    }
    const buf = await fs.readFile(src);
    const dest = path.join(bundleDir, `${tag}${c.ext}`);
    await fs.writeFile(dest, buf);
    collected.push({
      rel: path.relative(bundleDir, dest),
      bytes: buf.byteLength,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    });
  }

  // 2. Stems (whole stems/ directory if present).
  const stemsSrc = path.join(input.sessionDir, 'stems');
  if (await exists(stemsSrc)) {
    const stemsDest = path.join(bundleDir, 'stems');
    await fs.mkdir(stemsDest, { recursive: true });
    for (const name of await fs.readdir(stemsSrc)) {
      const buf = await fs.readFile(path.join(stemsSrc, name));
      await fs.writeFile(path.join(stemsDest, name), buf);
      collected.push({
        rel: path.join('stems', name),
        bytes: buf.byteLength,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      });
    }
  }

  // 3. Top-level reports (produce-report / revision-report) for the iter.
  for (const reportName of ['produce-report.md', `${tag}.report.md`, `${tag}.revision-report.md`]) {
    const src = path.join(input.sessionDir, reportName);
    if (await exists(src)) {
      const buf = await fs.readFile(src);
      await fs.writeFile(path.join(bundleDir, reportName), buf);
      collected.push({
        rel: reportName,
        bytes: buf.byteLength,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      });
    }
  }

  // 4. Manifest.
  const graphRaw = JSON.parse(await fs.readFile(path.join(input.sessionDir, `${tag}.json`), 'utf8'));
  const manifest = {
    bundle_version: '1.0.0',
    session_id: graphRaw.session_id,
    schema_version: graphRaw.schema_version,
    iteration: iter,
    brief: graphRaw.brief?.text ?? null,
    primary_genre: graphRaw.brief?.primary_genre ?? null,
    bpm: graphRaw.brief?.bpm ?? null,
    created_at: graphRaw.created_at,
    bundled_at: new Date().toISOString(),
    files: collected,
  };
  const manifestPath = path.join(bundleDir, 'bundle-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // 5. Optional zip via system `zip` binary.
  let zipPath: string | undefined;
  if (input.makeZip !== false) {
    zipPath = path.join(input.sessionDir, `bundle-${tag}.zip`);
    const ok = await runZip(zipPath, bundleDir);
    if (!ok) {
      zipPath = undefined;
      warnings.push('zip binary not found on PATH; bundle written as directory only');
    }
  }

  return {
    bundleDir,
    ...(zipPath ? { zipPath } : {}),
    manifestPath,
    files: collected,
    iteration: iter,
    warnings,
  };
}

async function listIters(dir: string): Promise<number[]> {
  let entries: string[] = [];
  try { entries = await fs.readdir(dir); } catch { return []; }
  return entries
    .filter((n) => /^iter_\d{4}\.json$/.test(n))
    .map((n) => Number(n.slice(5, 9)))
    .sort((a, b) => a - b);
}

async function exists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true; } catch { return false; }
}

function runZip(zipOut: string, bundleDir: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Run from the bundleDir's parent so the archive paths are relative.
    const parent = path.dirname(bundleDir);
    const base = path.basename(bundleDir);
    const proc = spawn('zip', ['-rq', zipOut, base], { cwd: parent, stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => resolve(code === 0));
  });
}
