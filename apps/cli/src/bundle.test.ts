// G10: bundle tests. Build a session via produce(skipRender), then bundle it
// and assert the manifest, file presence, and SHA-256 stability.

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { produce } from '@cactus/agent-runtime';
import { bundleSession } from './bundle.js';

const TMP = path.join(os.tmpdir(), 'cactus-bundle-tests');

async function newSession(): Promise<string> {
  await fs.mkdir(TMP, { recursive: true });
  const r = await produce('peak time techno 130 BPM 16 bars', {
    sessionsRoot: TMP, seed: 11, skipRender: true, skipAnalyze: true,
  });
  return r.sessionDir;
}

describe('bundleSession (G10)', () => {
  it('writes bundle-iter_0000/ with required artifacts and a manifest', async () => {
    const sessionDir = await newSession();
    const r = await bundleSession({ sessionDir, makeZip: false });
    expect(r.iteration).toBe(0);
    expect(r.bundleDir.endsWith('bundle-iter_0000')).toBe(true);
    // Required artifacts: graph + code.
    const present = (await fs.readdir(r.bundleDir)).sort();
    expect(present).toContain('iter_0000.json');
    expect(present).toContain('iter_0000.strudel.js');
    expect(present).toContain('bundle-manifest.json');
  });

  it('manifest carries session_id, iteration, schema_version, and file SHA-256', async () => {
    const sessionDir = await newSession();
    const r = await bundleSession({ sessionDir, makeZip: false });
    const manifest = JSON.parse(await fs.readFile(r.manifestPath, 'utf8'));
    expect(manifest.bundle_version).toBe('1.0.0');
    expect(manifest.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(manifest.iteration).toBe(0);
    expect(manifest.schema_version).toBe('1.0.0');
    expect(Array.isArray(manifest.files)).toBe(true);
    expect(manifest.files.length).toBeGreaterThanOrEqual(2);
    for (const f of manifest.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes).toBeGreaterThan(0);
    }
  });

  it('SHA-256 in manifest matches actual file content', async () => {
    const sessionDir = await newSession();
    const r = await bundleSession({ sessionDir, makeZip: false });
    const manifest = JSON.parse(await fs.readFile(r.manifestPath, 'utf8'));
    for (const f of manifest.files) {
      const buf = await fs.readFile(path.join(r.bundleDir, f.rel));
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      expect(hash).toBe(f.sha256);
    }
  });

  it('throws when session has no iterations', async () => {
    const empty = path.join(TMP, `no-iter-${Date.now()}`);
    await fs.mkdir(empty, { recursive: true });
    await expect(bundleSession({ sessionDir: empty })).rejects.toThrow(/no iterations/);
  });

  it('throws when an explicit iteration does not exist', async () => {
    const sessionDir = await newSession();
    await expect(bundleSession({ sessionDir, iteration: 99 })).rejects.toThrow(/iteration 99 not found/);
  });

  it('omits optional artifacts that are not present (no error)', async () => {
    const sessionDir = await newSession();
    const r = await bundleSession({ sessionDir, makeZip: false });
    const present = await fs.readdir(r.bundleDir);
    // Skipped render means no .wav, no .features.json, no .critique.json — that's fine.
    expect(present.find((n) => n.endsWith('.wav'))).toBeUndefined();
    expect(present.find((n) => n.endsWith('.features.json'))).toBeUndefined();
  });

  it('makeZip:false leaves bundleDir without a .zip and without warning', async () => {
    const sessionDir = await newSession();
    const r = await bundleSession({ sessionDir, makeZip: false });
    expect(r.zipPath).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });
});
