// Genre confusion: given a rendered track's features, score how close it sits
// to each audit-owned holdout genre profile and rank. If the intended genre
// isn't top-1 (or top-3), the audit reports genre_collapse.
//
// Important: this module deliberately does NOT load `@cactus/genres`.
// Production genre specs are producer inputs; using them as the evaluator
// rubric makes the audit circular. The holdout profiles live in
// `packages/audit/genre-holdout-profiles.yaml` and are coarse observable
// ranges only.

import type { AnalyzerFeatures, SessionGraph } from '@cactus/ir';
import { loadHoldoutGenreProfiles, type HoldoutGenreProfile } from './genre-holdout-profiles.js';

export interface GenreDistance {
  genre: string;
  distance: number;
  reasons: string[];
}

export interface GenreConfusionInput {
  intended_genre: string;
  graph: SessionGraph;
  features: AnalyzerFeatures;
}

export interface GenreConfusionReport {
  intended_genre: string;
  distances: GenreDistance[];
  top1: string;
  top3: string[];
  intended_top1: boolean;
  intended_top3: boolean;
  intended_distance: number;
  best_alternative: { genre: string; distance: number } | null;
}

export async function scoreGenreConfusion(input: GenreConfusionInput): Promise<GenreConfusionReport> {
  const profiles = await loadHoldoutGenreProfiles();
  const distances: GenreDistance[] = [];
  for (const [slug, profile] of Object.entries(profiles)) {
    distances.push(distanceToGenre(slug, profile, input.graph, input.features));
  }
  distances.sort((a, b) => a.distance - b.distance);
  const top1 = distances[0]?.genre ?? input.intended_genre;
  const top3 = distances.slice(0, 3).map((d) => d.genre);
  const intended_top1 = top1 === input.intended_genre;
  const intended_top3 = top3.includes(input.intended_genre);
  const intended_distance = distances.find((d) => d.genre === input.intended_genre)?.distance ?? Infinity;
  const best_alternative = distances.find((d) => d.genre !== input.intended_genre) ?? null;
  return {
    intended_genre: input.intended_genre,
    distances,
    top1,
    top3,
    intended_top1,
    intended_top3,
    intended_distance,
    best_alternative: best_alternative ? { genre: best_alternative.genre, distance: best_alternative.distance } : null,
  };
}

function distanceToGenre(slug: string, profile: HoldoutGenreProfile, graph: SessionGraph, f: AnalyzerFeatures): GenreDistance {
  const reasons: string[] = [];
  let dist = 0;

  // 1. BPM proximity to genre's range. Use analyzer evidence only; falling
  // back to graph.brief.bpm lets a producer self-report the very feature the
  // audit is supposed to measure.
  const bpm = f.rhythmic?.bpm ?? 0;
  const [lo, hi] = profile.bpm_range;
  const bpmDist = bpm > 0 ? rangeDistance(bpm, lo, hi) : 0.5;
  dist += bpmDist * 5;
  if (bpmDist > 0.05) reasons.push(`bpm ${bpm.toFixed(0)} vs ${lo}-${hi}`);

  // 2. LUFS proximity to audit-owned holdout range (20%).
  const [lufsLo, lufsHi] = profile.lufs_range;
  const integrated = f.loudness?.lufs_integrated ?? -30;
  let lufsDist = 0;
  if (Number.isFinite(integrated)) {
    lufsDist = rangeDistance(integrated, lufsLo, lufsHi, 12);
  } else {
    lufsDist = 1;
  }
  dist += lufsDist * 2;
  if (lufsDist > 0.3) reasons.push(`lufs ${integrated.toFixed(1)} vs ${lufsLo}-${lufsHi}`);

  // 3. Onset density (15%) — use strongest band to avoid triple-counting
  // broadband transients.
  const onsetValues = Object.values(f.rhythmic?.onset_density ?? {}).filter((v) => Number.isFinite(v));
  const totalOnsets = onsetValues.length > 0 ? Math.max(...onsetValues) : 0;
  const expectedOnsets = profile.onset_density_range;
  const onsetDist = rangeDistance(totalOnsets, expectedOnsets[0], expectedOnsets[1]);
  dist += onsetDist * 1.5;
  if (onsetDist > 0.3) reasons.push(`onsets ${totalOnsets.toFixed(1)}/s vs ${expectedOnsets.join('-')}`);

  // 4. Spectral centroid (15%).
  const expectedCentroid = profile.centroid_range_hz;
  const centroid = f.spectral?.centroid ?? 0;
  const centroidDist = rangeDistance(centroid, expectedCentroid[0], expectedCentroid[1]);
  dist += centroidDist * 1.5;
  if (centroidDist > 0.3) reasons.push(`centroid ${centroid.toFixed(0)} Hz vs ${expectedCentroid.join('-')}`);

  return { genre: slug, distance: dist, reasons };
}

function rangeDistance(value: number, lo: number, hi: number, denom = Math.max(1, Math.abs(lo), Math.abs(hi))): number {
  if (value < lo) return (lo - value) / denom;
  if (value > hi) return (value - hi) / denom;
  return 0;
}

export interface GenreConfusionMatrix {
  /** matrix[intended][top1] = count */
  matrix: Record<string, Record<string, number>>;
  total_renders: number;
  top1_correct: number;
  top3_correct: number;
}

export function aggregateConfusion(reports: GenreConfusionReport[]): GenreConfusionMatrix {
  const matrix: Record<string, Record<string, number>> = {};
  let top1Correct = 0;
  let top3Correct = 0;
  for (const r of reports) {
    matrix[r.intended_genre] ??= {};
    const row = matrix[r.intended_genre]!;
    row[r.top1] = (row[r.top1] ?? 0) + 1;
    if (r.intended_top1) top1Correct++;
    if (r.intended_top3) top3Correct++;
  }
  return { matrix, total_renders: reports.length, top1_correct: top1Correct, top3_correct: top3Correct };
}

export function renderConfusionMarkdown(m: GenreConfusionMatrix): string {
  const intended = Object.keys(m.matrix).sort();
  const all = new Set<string>();
  for (const row of Object.values(m.matrix)) for (const k of Object.keys(row)) all.add(k);
  const tops = Array.from(all).sort();
  const header = ['intended \\ top1', ...tops];
  const lines: string[] = [];
  lines.push(`# genre confusion matrix (${m.total_renders} renders)`);
  lines.push('');
  lines.push(`top-1 correct: ${m.top1_correct}/${m.total_renders} (${pct(m.top1_correct, m.total_renders)})`);
  lines.push(`top-3 correct: ${m.top3_correct}/${m.total_renders} (${pct(m.top3_correct, m.total_renders)})`);
  lines.push('');
  lines.push('| ' + header.join(' | ') + ' |');
  lines.push('| ' + header.map(() => '---').join(' | ') + ' |');
  for (const i of intended) {
    const row = m.matrix[i]!;
    const cells = tops.map((t) => String(row[t] ?? 0));
    lines.push('| ' + [i, ...cells].join(' | ') + ' |');
  }
  return lines.join('\n') + '\n';
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '0%';
  return `${((num / denom) * 100).toFixed(1)}%`;
}
