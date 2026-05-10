// G9 §2: validation. Cookbook entries fail loudly when:
//   - schema invalid
//   - mini-notation / raw fails strudel-validator
//   - duplicate id
//   - sound-palette tag in forbidden_constraints (logical contradiction)
//   - near-duplicate of another entry (use similarity.ts)
//
// validate() returns a structured report; the CLI command surfaces it.

import { validateStrudelCode } from '@cactus/strudel-validator';
import { findNearDuplicates, type SimilarityPair } from './similarity.js';
import { loadCookbookEntries, type LoadEntriesResult } from './loader.js';
import type { CookbookEntry } from './schema.js';
import { getEntryCode } from './schema.js';

export type IssueLevel = 'error' | 'warning';

export interface ValidationIssue {
  level: IssueLevel;
  category:
    | 'load'
    | 'duplicate_id'
    | 'strudel_syntax'
    | 'effect_collision'
    | 'role_genre_mismatch'
    | 'logical_contradiction'
    | 'near_duplicate';
  entry_id?: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  total_entries: number;
  per_genre_role: Array<{ genre: string; role: string; count: number }>;
  issues: ValidationIssue[];
  near_duplicate_pairs: SimilarityPair[];
}

export interface ValidateOptions {
  cookbookDir?: string;
  /** Filter to one genre. */
  genre?: string;
  /** Filter to one role within the genre. */
  role?: string;
}

export async function validateCookbook(opts: ValidateOptions = {}): Promise<ValidationReport> {
  const loaded = await loadCookbookEntries({
    ...(opts.cookbookDir !== undefined ? { cookbookDir: opts.cookbookDir } : {}),
    strict: false,
  });
  const issues: ValidationIssue[] = [];

  for (const i of loaded.issues) {
    issues.push({
      level: 'error',
      category: 'load',
      message: `${i.file}:${i.line} ${i.reason}`,
    });
  }

  const filtered = loaded.entries.filter((e) =>
    (!opts.genre || e.genre === opts.genre) &&
    (!opts.role || e.role === opts.role),
  );

  // Duplicate ids.
  const seenIds = new Map<string, CookbookEntry>();
  for (const e of filtered) {
    if (seenIds.has(e.id)) {
      issues.push({
        level: 'error', category: 'duplicate_id', entry_id: e.id,
        message: `id "${e.id}" appears in multiple entries`,
      });
    } else {
      seenIds.set(e.id, e);
    }
  }

  // Strudel syntax check on each entry's code. mix_macro / arrangement_macro
  // are config presets (JSON object literals), not playable code — they're
  // round-tripped through JSON.parse instead.
  for (const e of filtered) {
    const code = getEntryCode(e);
    if (!code) {
      issues.push({
        level: 'error', category: 'strudel_syntax', entry_id: e.id,
        message: 'no mini_notation or raw code',
      });
      continue;
    }
    if (e.role === 'mix_macro' || e.role === 'arrangement_macro') {
      try { JSON.parse(code); }
      catch (err) {
        issues.push({
          level: 'error', category: 'strudel_syntax', entry_id: e.id,
          message: `${e.role} raw must be a JSON object literal: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      continue;
    }
    // mini_notation snippets are fragments and must be wrapped; `raw`
    // entries are full JS expressions and validate as-is.
    const wrapped = e.mini_notation !== undefined
      ? wrapMiniNotation(e.role, code)
      : code;
    const v = validateStrudelCode(wrapped);
    if (v.issues.length > 0) {
      issues.push({
        level: 'error', category: 'strudel_syntax', entry_id: e.id,
        message: `${v.issues.length} validator issue(s); first: [${v.issues[0]!.code}] ${v.issues[0]!.message}`,
      });
    }
  }

  // Logical contradiction: a sound_palette tag also listed in forbidden_constraints text.
  for (const e of filtered) {
    for (const tag of e.sound_palette_tags) {
      if (e.forbidden_constraints.some((f: string) => f.toLowerCase().includes(tag))) {
        issues.push({
          level: 'warning', category: 'logical_contradiction', entry_id: e.id,
          message: `sound_palette_tag "${tag}" also appears in forbidden_constraints`,
        });
      }
    }
  }

  // Near-duplicate pairs (same genre+role only).
  const pairs = findNearDuplicates(filtered);
  for (const p of pairs.filter((x) => x.near_duplicate)) {
    issues.push({
      level: 'warning', category: 'near_duplicate', entry_id: p.a_id,
      message: `near-duplicate of ${p.b_id} (overlap=${p.ngram_overlap.toFixed(3)}, grid_match=${p.grid_match})`,
    });
  }

  // Per-genre/role counts.
  const counts = new Map<string, number>();
  for (const e of filtered) {
    const k = `${e.genre}/${e.role}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const perGenreRole = Array.from(counts).map(([k, n]) => {
    const [genre, role] = k.split('/');
    return { genre: genre!, role: role!, count: n };
  }).sort((a, b) => a.genre.localeCompare(b.genre) || a.role.localeCompare(b.role));

  const errors = issues.filter((i) => i.level === 'error');
  return {
    ok: errors.length === 0,
    total_entries: filtered.length,
    per_genre_role: perGenreRole,
    issues,
    near_duplicate_pairs: pairs,
  };
}

/**
 * Wrap a mini-notation fragment so the strudel-validator sees a parseable
 * complete expression. note() vs s() depends on role: tonal roles
 * (chord_stab, bass, lead_hook, pad_atmo) become note(...); rhythmic roles
 * become s(...).
 */
function wrapMiniNotation(role: string, code: string): string {
  const escaped = code.replace(/"/g, '\\"');
  const tonal = role === 'chord_stab' || role === 'bass' || role === 'lead_hook' || role === 'pad_atmo';
  return tonal ? `note("${escaped}")` : `s("${escaped}")`;
}

export function formatValidationReport(r: ValidationReport): string {
  const lines: string[] = [];
  lines.push(`cookbook validation: ${r.ok ? 'OK' : 'FAIL'} — ${r.total_entries} entries, ${r.issues.length} issue(s)`);
  for (const { genre, role, count } of r.per_genre_role) {
    lines.push(`  ${genre}/${role}: ${count}`);
  }
  if (r.issues.length > 0) {
    lines.push('');
    lines.push('issues:');
    for (const i of r.issues) {
      const idStr = i.entry_id ? ` [${i.entry_id}]` : '';
      lines.push(`  ${i.level}/${i.category}${idStr}: ${i.message}`);
    }
  }
  return lines.join('\n');
}
