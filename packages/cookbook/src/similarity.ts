// G9 §9: similarity / anti-template-collapse. Two entries are "near-duplicate"
// if their compiled code shares >= TOKEN_OVERLAP_THRESHOLD of 3-grams AND
// their grid pattern (onset positions) matches.
//
// We don't pretend to do full audio similarity here — we hash the symbolic
// pattern so the cookbook can refuse to register two entries that would
// produce essentially the same output.

import type { CookbookEntry } from './schema.js';
import { getEntryCode } from './schema.js';

const TOKEN_OVERLAP_THRESHOLD = 0.85;

/** Tokenise mini-notation into bare tokens, dropping operator characters. */
export function tokenize(code: string): string[] {
  return code
    .replace(/[\(\)\[\]<>{}*~!@,.|]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Build a multiset of n-grams from a token stream. */
export function ngrams(tokens: string[], n: number): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i + n <= tokens.length; i++) {
    const k = tokens.slice(i, i + n).join(' ');
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** Cosine-style overlap between two multisets. 1.0 = identical. */
export function ngramOverlap(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [k, v] of a) {
    normA += v * v;
    if (b.has(k)) dot += v * b.get(k)!;
  }
  for (const [, v] of b) normB += v * v;
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

/** A compact symbolic-grid hash. Captures onset positions ignoring sample names. */
export function gridHash(code: string): string {
  // Strip sample names; keep just the rhythm shape.
  const skeleton = code
    .replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, 'x') // identifiers → x
    .replace(/\s+/g, '');
  return skeleton;
}

export interface SimilarityPair {
  a_id: string;
  b_id: string;
  ngram_overlap: number;
  grid_match: boolean;
  /** True iff entries are considered near-duplicates. */
  near_duplicate: boolean;
}

/**
 * Adaptive n: short patterns use bigram or unigram comparison, longer ones
 * use 3-grams. Returning `0` for both empty bags caused short patterns
 * (≤ 2 tokens) to look maximally dissimilar even when literally identical.
 */
function adaptiveN(tokens: string[]): number {
  if (tokens.length >= 4) return 3;
  if (tokens.length >= 2) return 2;
  return 1;
}

/**
 * Find every pair of entries that are near-duplicate. O(n²) — fine for
 * cookbook sizes well under 1000.
 */
export function findNearDuplicates(entries: CookbookEntry[], opts: { threshold?: number } = {}): SimilarityPair[] {
  const threshold = opts.threshold ?? TOKEN_OVERLAP_THRESHOLD;
  const cached = entries.map((e) => {
    const code = getEntryCode(e);
    const tokens = tokenize(code);
    return {
      entry: e,
      tri: ngrams(tokens, adaptiveN(tokens)),
      grid: gridHash(code),
    };
  });
  const out: SimilarityPair[] = [];
  for (let i = 0; i < cached.length; i++) {
    for (let j = i + 1; j < cached.length; j++) {
      const A = cached[i]!;
      const B = cached[j]!;
      // Only compare within the same genre+role — different roles don't
      // collide musically.
      if (A.entry.genre !== B.entry.genre || A.entry.role !== B.entry.role) continue;
      const overlap = ngramOverlap(A.tri, B.tri);
      const gridMatch = A.grid === B.grid;
      const isDup = overlap >= threshold && gridMatch;
      if (isDup || (overlap >= threshold * 0.95 && !gridMatch)) {
        out.push({
          a_id: A.entry.id,
          b_id: B.entry.id,
          ngram_overlap: overlap,
          grid_match: gridMatch,
          near_duplicate: isDup,
        });
      }
    }
  }
  return out;
}

export interface DiversityReport {
  total_entries: number;
  total_pairs_checked: number;
  near_duplicate_pairs: SimilarityPair[];
  per_genre_role_counts: Array<{ genre: string; role: string; count: number; warning?: string }>;
  /** Mean pairwise n-gram overlap within each genre+role bucket. */
  per_bucket_homogeneity: Array<{ genre: string; role: string; mean_overlap: number; size: number }>;
}

export function diversityReport(entries: CookbookEntry[]): DiversityReport {
  const buckets = new Map<string, CookbookEntry[]>();
  for (const e of entries) {
    const key = `${e.genre}/${e.role}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(e);
  }
  const counts: DiversityReport['per_genre_role_counts'] = [];
  const homogeneity: DiversityReport['per_bucket_homogeneity'] = [];
  for (const [key, bucket] of buckets) {
    const [genre, role] = key.split('/');
    counts.push({
      genre: genre!,
      role: role!,
      count: bucket.length,
      ...(bucket.length === 1 ? { warning: 'singleton — diversity score undefined' } : {}),
    });
    if (bucket.length < 2) {
      homogeneity.push({ genre: genre!, role: role!, mean_overlap: 0, size: bucket.length });
      continue;
    }
    const cached = bucket.map((e) => {
      const t = tokenize(getEntryCode(e));
      return ngrams(t, adaptiveN(t));
    });
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < cached.length; i++) {
      for (let j = i + 1; j < cached.length; j++) {
        total += ngramOverlap(cached[i]!, cached[j]!);
        pairs++;
      }
    }
    homogeneity.push({
      genre: genre!,
      role: role!,
      mean_overlap: pairs === 0 ? 0 : total / pairs,
      size: bucket.length,
    });
  }
  const dups = findNearDuplicates(entries);
  return {
    total_entries: entries.length,
    total_pairs_checked: entries.length * (entries.length - 1) / 2,
    near_duplicate_pairs: dups,
    per_genre_role_counts: counts.sort((a, b) => a.genre.localeCompare(b.genre) || a.role.localeCompare(b.role)),
    per_bucket_homogeneity: homogeneity.sort((a, b) => b.mean_overlap - a.mean_overlap),
  };
}
