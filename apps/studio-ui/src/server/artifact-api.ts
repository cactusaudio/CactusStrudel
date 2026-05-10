// G11A: vite dev/preview middleware that exposes session / audit / ledger /
// cookbook artifacts to the browser. Strictly read-only. The UI fetches
// JSON, .md and .strudel.js files via /api/...; binary artifacts (wav, png)
// are served via /artifact/... using the Content-Type the file deserves.
//
// We resolve every requested path against a known root (sessions / audits /
// learning_ledger / cookbook). Any request for a path that escapes its root
// is refused — operator console must not become a path-traversal vector.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';

export interface ArtifactApiOptions {
  /** Repo root (where sessions/, audits/, learning_ledger/, cookbook/ live). */
  repoRoot: string;
}

const TEXT_EXTS = new Set(['.json', '.md', '.txt', '.js', '.ts', '.yaml', '.yml']);
const BINARY_EXTS = new Map<string, string>([
  ['.wav', 'audio/wav'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
]);

/**
 * URL-prefix → FS-prefix rewrites. The CLI writes sessions and audits under
 * apps/cli/, but operators see them at clean URL paths.
 */
export const URL_REWRITES: Array<[RegExp, string]> = [
  [/^sessions(\/|$)/, 'apps/cli/sessions$1'],
  [/^audits(\/|$)/, 'apps/cli/audits$1'],
];

const ROOTS = [
  'sessions', 'audits', 'apps/cli/sessions', 'apps/cli/audits',
  'learning_ledger', 'cookbook', 'references', 'tests/fixtures',
];

export function rewriteUrlPath(p: string): string {
  for (const [re, replacement] of URL_REWRITES) {
    if (re.test(p)) return p.replace(re, replacement);
  }
  return p;
}

function resolveSafe(repoRoot: string, requested: string): string | null {
  const rewritten = rewriteUrlPath(requested);
  const root = path.resolve(repoRoot);
  const target = path.resolve(repoRoot, rewritten);
  if (!target.startsWith(root + path.sep) && target !== root) return null;
  const rel = path.relative(root, target);
  if (!ROOTS.some((r) => rel === r || rel.startsWith(r + path.sep))) return null;
  return target;
}

async function listDir(p: string): Promise<Array<{ name: string; type: 'dir' | 'file'; size?: number; mtime: number }>> {
  const entries = await fs.readdir(p, { withFileTypes: true });
  const out: Awaited<ReturnType<typeof listDir>> = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    try {
      const stat = await fs.stat(path.join(p, e.name));
      out.push({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        size: e.isFile() ? stat.size : undefined,
        mtime: stat.mtimeMs,
      });
    } catch { /* skip */ }
  }
  // Sort: dirs first by name desc (newest sessions appear first), files by name asc.
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return b.name.localeCompare(a.name);
  });
  return out;
}

async function handle(req: Connect.IncomingMessage, res: Parameters<Connect.NextHandleFunction>[1], opts: ArtifactApiOptions): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const isApi = url.pathname.startsWith('/api/');
  const isArtifact = url.pathname.startsWith('/artifact/');
  if (!isApi && !isArtifact) {
    (res as unknown as { writeHead(s: number, h?: Record<string, string>): void; end(b: string): void }).writeHead(404);
    (res as unknown as { writeHead(s: number, h?: Record<string, string>): void; end(b: string): void }).end('not found');
    return;
  }
  const requested = decodeURIComponent(url.pathname.replace(/^\/(api|artifact)\//, ''));
  const target = resolveSafe(opts.repoRoot, requested);
  if (!target) {
    (res as unknown as { writeHead(s: number, h?: Record<string, string>): void; end(b: string): void }).writeHead(403);
    (res as unknown as { writeHead(s: number, h?: Record<string, string>): void; end(b: string): void }).end('forbidden');
    return;
  }
  const writeHead = (res as unknown as { writeHead(s: number, h?: Record<string, string>): void }).writeHead.bind(res);
  const writeEnd = (res as unknown as { end(b: string | Buffer): void }).end.bind(res);
  let stat;
  try { stat = await fs.stat(target); }
  catch { writeHead(404); writeEnd('not found'); return; }
  if (stat.isDirectory()) {
    const list = await listDir(target);
    writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    writeEnd(JSON.stringify({ kind: 'dir', path: requested, entries: list }, null, 2));
    return;
  }
  const ext = path.extname(target).toLowerCase();
  if (isApi && (TEXT_EXTS.has(ext) || ext === '')) {
    const buf = await fs.readFile(target, 'utf8');
    const ct = ext === '.json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
    writeHead(200, { 'content-type': ct });
    writeEnd(buf);
    return;
  }
  if (isArtifact && BINARY_EXTS.has(ext)) {
    const buf = await fs.readFile(target);
    writeHead(200, { 'content-type': BINARY_EXTS.get(ext)! });
    writeEnd(buf);
    return;
  }
  writeHead(415);
  writeEnd('unsupported media type');
}

export function artifactApi(opts: ArtifactApiOptions): Plugin {
  return {
    name: 'cactus-artifact-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/') && !url.startsWith('/artifact/')) return next();
        try { await handle(req, res, opts); }
        catch (e) {
          (res as unknown as { writeHead(s: number, h?: Record<string, string>): void; end(b: string): void }).writeHead(500);
          (res as unknown as { writeHead(s: number, h?: Record<string, string>): void; end(b: string): void }).end(`error: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/') && !url.startsWith('/artifact/')) return next();
        try { await handle(req, res, opts); }
        catch (e) {
          (res as unknown as { writeHead(s: number, h?: Record<string, string>): void; end(b: string): void }).writeHead(500);
          (res as unknown as { writeHead(s: number, h?: Record<string, string>): void; end(b: string): void }).end(`error: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    },
  };
}
