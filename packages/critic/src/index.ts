import { v4 as uuid } from 'uuid';
import type {
  AnalyzerFeatures,
  CritiqueEntry,
  CritiqueTarget,
  ScoreVector,
  SessionGraph,
} from '@cactus/ir';
import { loadGenre, type GenreSpec } from '@cactus/genres';

export { checkCriticSelfConsistency, type SelfConsistencyReport } from './self-consistency.js';

export interface CritiqueInput {
  graph: SessionGraph;
  features: AnalyzerFeatures;
  iteration?: number;
}

export async function critique(input: CritiqueInput): Promise<CritiqueEntry> {
  const { graph, features } = input;
  const iteration = input.iteration ?? Math.max(0, graph.render_graph.length - 1);
  let genre: GenreSpec | undefined;
  if (graph.brief.primary_genre) {
    try {
      genre = await loadGenre(graph.brief.primary_genre);
    } catch {
      /* unknown genre — score against generic targets */
    }
  }

  const scores = scoreVector(graph, features, genre);
  const targets = revisionTargets(graph, features, genre);
  return {
    iteration,
    scores,
    targets,
    notes: targetsNote(targets),
  };
}

function scoreVector(graph: SessionGraph, f: AnalyzerFeatures, genre?: GenreSpec): ScoreVector {
  const tech = scoreTechnical(graph, f);
  const fit = scoreGenreFit(graph, f, genre);
  const groove = scoreGroove(graph, f);
  const arc = scoreArrangement(graph, f);
  const sound = scoreSoundDesign(graph, f);
  const mix = scoreMixTranslation(graph, f, genre);
  const hook = scoreHook(graph);
  const orig = scoreOriginality(graph);
  return {
    technical_validity: tech,
    genre_fit: fit,
    groove,
    arrangement_arc: arc,
    sound_design: sound,
    mix_translation: mix,
    memorability_hook: hook,
    originality: orig,
    user_taste_fit: 0,
  };
}

function scoreTechnical(graph: SessionGraph, f: AnalyzerFeatures): number {
  let s = 1;
  if ((f.loudness?.true_peak_db ?? -1) > -0.1) s -= 0.4;
  if (graph.layers.length === 0) s -= 0.5;
  if (graph.song.sections.length === 0) s -= 0.3;
  return Math.max(0, s);
}

function scoreGenreFit(graph: SessionGraph, f: AnalyzerFeatures, genre?: GenreSpec): number {
  if (!genre) return 0.5;
  let s = 1;
  const bpm = f.rhythmic?.bpm ?? graph.brief.bpm ?? 0;
  if (bpm > 0) {
    const [lo, hi] = genre.bpm_range;
    if (bpm < lo - 5 || bpm > hi + 5) s -= 0.4;
  }
  if (genre.mix_targets.stereo_mono_low_compliance_min !== undefined) {
    const mlc = f.stereo?.mono_low_compliance ?? 1;
    if (mlc < genre.mix_targets.stereo_mono_low_compliance_min) {
      s -= 0.25 * (genre.mix_targets.stereo_mono_low_compliance_min - mlc) * 4;
    }
  }
  return Math.max(0, Math.min(1, s));
}

function scoreGroove(graph: SessionGraph, f: AnalyzerFeatures): number {
  if (!f.rhythmic) return 0.5;
  const reg = f.rhythmic.grid_regularity ?? 0.5;
  const center = graph.brief.primary_genre === 'idm' ? 0.6 : 0.85;
  const dist = Math.abs(reg - center);
  return Math.max(0, 1 - dist * 1.5);
}

function scoreArrangement(graph: SessionGraph, _f: AnalyzerFeatures): number {
  const curve = graph.song.energy_curve;
  if (curve.length < 2) return 0;
  const min = Math.min(...curve);
  const max = Math.max(...curve);
  return Math.min(1, (max - min) * 1.5);
}

function scoreSoundDesign(graph: SessionGraph, f: AnalyzerFeatures): number {
  const flatness = f.spectral?.flatness ?? 0.3;
  const dist = Math.abs(flatness - 0.12);
  let s = Math.max(0, 1 - dist * 5);
  if (graph.layers.length < 3) s *= 0.6;
  return s;
}

function scoreMixTranslation(graph: SessionGraph, f: AnalyzerFeatures, genre?: GenreSpec): number {
  if (!f.loudness) return 0.5;
  const target = genre?.mix_targets.lufs ?? -10;
  const integrated = f.loudness.lufs_integrated ?? -30;
  if (!Number.isFinite(integrated)) return 0.2;
  const lufsErr = Math.abs(integrated - target);
  let s = Math.max(0, 1 - lufsErr / 8);
  if ((f.loudness.true_peak_db ?? -1) > -1) s *= 0.7;
  return s;
}

function scoreHook(graph: SessionGraph): number {
  const drops = graph.song.sections.filter((s) => s.function === 'drop');
  const harmonic = graph.layers.find((l) => l.role === 'chord' || l.role === 'lead');
  if (!harmonic || drops.length === 0) return 0.4;
  const activeDrops = drops.filter((s) => graph.song.layer_activation[harmonic.id]?.sections[s.id]).length;
  return Math.min(1, activeDrops / drops.length);
}

function scoreOriginality(_graph: SessionGraph): number {
  return 0.5;
}

function revisionTargets(graph: SessionGraph, f: AnalyzerFeatures, genre?: GenreSpec): CritiqueTarget[] {
  const targets: CritiqueTarget[] = [];

  if (f.loudness && Number.isFinite(f.loudness.lufs_integrated ?? NaN) && genre) {
    const integrated = f.loudness.lufs_integrated!;
    const target = genre.mix_targets.lufs;
    if (Math.abs(integrated - target) > 2) {
      const delta = target - integrated;
      targets.push({
        target_id: uuid(),
        severity: Math.min(1, Math.abs(delta) / 6),
        agent: 'producer-mix-engineer',
        graph_paths: ['/mix_graph/master/gain'],
        problem: `integrated LUFS ${integrated.toFixed(1)} vs genre target ${target.toFixed(1)}`,
        evidence: { lufs_integrated: integrated, lufs_target: target, delta_db: delta },
        revision_instruction: `adjust /mix_graph/master/gain by ${delta > 0 ? '+' : ''}${delta.toFixed(1)} dB equivalent`,
      });
    }
  }

  if (f.loudness?.true_peak_db !== undefined && f.loudness.true_peak_db > -0.5) {
    targets.push({
      target_id: uuid(),
      severity: 0.85,
      agent: 'producer-mix-engineer',
      graph_paths: ['/mix_graph/master/gain'],
      problem: `true peak ${f.loudness.true_peak_db.toFixed(2)} dBTP exceeds -1 ceiling`,
      evidence: { true_peak_db: f.loudness.true_peak_db, target: -1 },
      revision_instruction: 'reduce /mix_graph/master/gain to bring true peak ≤ -1 dBTP',
    });
  }

  if (genre?.mix_targets.stereo_mono_low_compliance_min !== undefined) {
    const mlc = f.stereo?.mono_low_compliance ?? 1;
    const min = genre.mix_targets.stereo_mono_low_compliance_min;
    if (mlc < min) {
      targets.push({
        target_id: uuid(),
        severity: Math.min(1, (min - mlc) * 4),
        agent: 'producer-mix-engineer',
        graph_paths: ['/mix_graph/orbits'],
        problem: `low-band stereo width too wide (mono_low_compliance ${mlc.toFixed(2)} < ${min})`,
        evidence: { mono_low_compliance: mlc, target_min: min },
        revision_instruction: 'set width≤0.6 on bass/sub orbit; mono-fold low-band of any wide layers',
      });
    }
  }

  if (f.rhythmic?.onset_density && genre) {
    const expectedHigh = genre.slug === 'idm' ? [3, 12] : [2, 8];
    const actual = f.rhythmic.onset_density.high ?? 0;
    if (actual < expectedHigh[0]! || actual > expectedHigh[1]!) {
      targets.push({
        target_id: uuid(),
        severity: 0.5,
        agent: 'producer-composer',
        graph_paths: ['/pattern_bank/patterns/hat'],
        problem: `high-band onset density ${actual.toFixed(1)}/s outside genre range ${expectedHigh.join('-')}`,
        evidence: { onset_density_high: actual, expected_range: expectedHigh },
        revision_instruction:
          actual < expectedHigh[0]!
            ? 'increase hat density (e.g. [hh hh]*4 → hh*8 or [~ hh hh ~]*2)'
            : 'reduce hat density (e.g. hh*8 → [~ hh]*4)',
      });
    }
  }

  const drops = graph.song.sections.filter((s) => s.function === 'drop');
  const intros = graph.song.sections.filter((s) => s.function === 'intro');
  if (drops.length > 0 && intros.length > 0) {
    const dropEnergy = drops[0]!.energy;
    const introEnergy = intros[0]!.energy;
    if (dropEnergy - introEnergy < 0.25) {
      targets.push({
        target_id: uuid(),
        severity: 0.6,
        agent: 'producer-arranger',
        graph_paths: ['/song/sections', '/song/energy_curve'],
        problem: 'arrangement arc too flat — drop barely louder than intro',
        evidence: { drop_energy: dropEnergy, intro_energy: introEnergy },
        revision_instruction: 'raise drop section energy to ≥ 0.75 or lower intro to ≤ 0.4',
      });
    }
  }

  return targets;
}

function targetsNote(targets: CritiqueTarget[]): string | undefined {
  if (targets.length === 0) return 'no critique targets — within tolerance on all measured axes';
  const sev = targets.reduce((a, t) => a + t.severity, 0) / targets.length;
  return `${targets.length} target(s); avg severity ${sev.toFixed(2)}`;
}
