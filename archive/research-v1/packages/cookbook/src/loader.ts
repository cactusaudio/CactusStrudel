// G9: cookbook loader. Reads JSONL files under cookbook/<genre>/<role>.jsonl,
// validates each line against CookbookEntrySchema, and returns typed entries.
//
// Migration note: pre-G9 entries had a flat shape (id/genre/role/mini_notation/
// tags/bpm_range only). Those are NOT auto-migrated — the loader rejects them
// loudly. Use `cactus cookbook migrate` (G9 §2) to upgrade in place.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CookbookEntrySchema, type CookbookEntry } from './schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const DEFAULT_COOKBOOK_DIR = path.join(REPO_ROOT, 'cookbook');

export interface LoadEntriesOptions {
  cookbookDir?: string;
  /** When true (default), throw on the first malformed line; otherwise collect issues. */
  strict?: boolean;
}

export interface LoadEntriesResult {
  entries: CookbookEntry[];
  issues: Array<{ file: string; line: number; reason: string }>;
}

export async function loadCookbookEntries(opts: LoadEntriesOptions = {}): Promise<LoadEntriesResult> {
  const root = opts.cookbookDir ?? DEFAULT_COOKBOOK_DIR;
  const strict = opts.strict ?? false;
  const out: CookbookEntry[] = [];
  const issues: LoadEntriesResult['issues'] = [];
  let genres: string[];
  try {
    genres = await fs.readdir(root);
  } catch {
    return { entries: [], issues: [] };
  }
  for (const genre of genres) {
    const genreDir = path.join(root, genre);
    let files: string[];
    try {
      const stat = await fs.stat(genreDir);
      if (!stat.isDirectory()) continue;
      files = await fs.readdir(genreDir);
    } catch { continue; }
    for (const fname of files) {
      if (!fname.endsWith('.jsonl')) continue;
      const fpath = path.join(genreDir, fname);
      const text = await fs.readFile(fpath, 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i]!.trim();
        if (!trimmed) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch (e) {
          const reason = `JSON parse error: ${e instanceof Error ? e.message : String(e)}`;
          if (strict) throw new Error(`${fpath}:${i + 1} ${reason}`);
          issues.push({ file: fpath, line: i + 1, reason });
          continue;
        }
        const result = CookbookEntrySchema.safeParse(parsed);
        if (!result.success) {
          const reason = result.error.issues.map((iss: { path: Array<string | number>; message: string }) => `${iss.path.join('.')}: ${iss.message}`).join('; ');
          if (strict) throw new Error(`${fpath}:${i + 1} schema invalid: ${reason}`);
          issues.push({ file: fpath, line: i + 1, reason: `schema: ${reason}` });
          continue;
        }
        out.push(result.data);
      }
    }
  }
  return { entries: out, issues };
}

/** Resolve the default cookbook directory for tests / scripts that need it. */
export function defaultCookbookDir(): string {
  return DEFAULT_COOKBOOK_DIR;
}
