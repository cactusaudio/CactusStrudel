// Genre confusion: given a rendered track's features, score how close it sits
// to each known genre rubric and rank. If the intended genre isn't top-1
// (or top-3), the audit reports genre_collapse.

import { loadGenre, listGenres, type GenreSpec } from '@cactus/genres';
import type { AnalyzerFeatures, SessionGraph } from '@cactus/ir';

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
  const slugs = await listGenres();
  const distances: GenreDistance[] = [];
  for (const slug of slugs) {
    let spec: GenreSpec;
    try { spec = await loadGenre(slug); } catch { continue; }
    distances.push(distanceToGenre(spec, input.graph, input.features));
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

function distanceToGenre(spec: GenreSpec, graph: SessionGraph, f: AnalyzerFeatures): GenreDistance {
  const reasons: string[] = [];
  let dist = 0;

  // 1. BPM proximity to genre's range (50% weight).
  const bpm = f.rhythmic?.bpm ?? graph.brief.bpm ?? 0;
  const [lo, hi] = spec.bpm_range;
  let bpmDist = 0;
  if (bpm > 0) {
    if (bpm < lo) bpmDist = (lo - bpm) / lo;
    else if (bpm > hi) bpmDist = (bpm - hi) / hi;
    else bpmDist = 0;
  } else {
    bpmDist = 0.5;
  }
  dist += bpmDist * 5;
  if (bpmDist > 0.05) reasons.push(`bpm ${bpm.toFixed(0)} vs ${lo}-${hi}`);

  // 2. LUFS proximity to genre target (20%).
  const target = spec.mix_targets.lufs;
  const integrated = f.loudness?.lufs_integrated ?? -30;
  let lufsDist = 0;
  if (Number.isFinite(integrated)) {
    lufsDist = Math.min(1, Math.abs(integrated - target) / 12);
  } else {
    lufsDist = 1;
  }
  dist += lufsDist * 2;
  if (lufsDist > 0.3) reasons.push(`lufs ${integrated.toFixed(1)} vs ${target}`);

  // 3. Onset density floor (15%) — ambient/drone wants near zero, dnb wants high.
  const totalOnsets = Object.values(f.rhythmic?.onset_density ?? {}).reduce((a, b) => a + b, 0);
  // Genre-specific expected ranges:
  const expectedOnsets = ((): [number, number] => {
    switch (spec.slug) {
      case 'ambient': return [0, 1];
      case 'dub_techno': return [1, 4];
      case 'house':
      case 'techno': return [3, 8];
      case 'dnb': return [5, 14];
      case 'idm': return [3, 12];
      default: return [1, 8];
    }
  })();
  let onsetDist = 0;
  if (totalOnsets < expectedOnsets[0]) onsetDist = (expectedOnsets[0] - totalOnsets) / Math.max(1, expectedOnsets[0]);
  else if (totalOnsets > expectedOnsets[1]) onsetDist = (totalOnsets - expectedOnsets[1]) / Math.max(1, expectedOnsets[1]);
  dist += onsetDist * 1.5;
  if (onsetDist > 0.3) reasons.push(`onsets ${totalOnsets.toFixed(1)}/s vs ${expectedOnsets.join('-')}`);

  // 4. Spectral centroid (15%) — dub_techno + ambient lean dark, dnb leans bright.
  const expectedCentroid = ((): [number, number] => {
    switch (spec.slug) {
      case 'ambient':
      case 'dub_techno': return [600, 1800];
      case 'house':
      case 'techno': return [1000, 2800];
      case 'dnb':
      case 'idm': return [1500, 3500];
      default: return [800, 3000];
    }
  })();
  const centroid = f.spectral?.centroid ?? 0;
  let centroidDist = 0;
  if (centroid < expectedCentroid[0]) centroidDist = (expectedCentroid[0] - centroid) / Math.max(1, expectedCentroid[0]);
  else if (centroid > expectedCentroid[1]) centroidDist = (centroid - expectedCentroid[1]) / Math.max(1, expectedCentroid[1]);
  dist += centroidDist * 1.5;
  if (centroidDist > 0.3) reasons.push(`centroid ${centroid.toFixed(0)} Hz vs ${expectedCentroid.join('-')}`);

  return { genre: spec.slug, distance: dist, reasons };
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
