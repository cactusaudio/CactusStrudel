// 15-category failure taxonomy. Each render that misses any gate or other
// audit signal classifies into one or more of these buckets.

import type { QualityGatesReport } from '@cactus/analyzer';
import type { GenreConfusionReport } from './genre-confusion.js';
import type { LocalityResult } from '@cactus/revision';
import type { SelfConsistencyReport } from '@cactus/critic';
import type { AnalyzerFeatures, SessionGraph } from '@cactus/ir';

export type FailureCategory =
  | 'silence_or_near_silence'
  | 'technically_valid_but_musically_empty'
  | 'loop_fatigue'
  | 'genre_collapse'
  | 'mix_mud'
  | 'low_end_failure'
  | 'harsh_highs'
  | 'no_arrangement_arc'
  | 'fake_breakdown'
  | 'over_reverb'
  | 'weak_kick_bass_relationship'
  | 'revision_drift'
  | 'critic_instability'
  | 'strudel_validation_gap'
  | 'render_analyzer_mismatch';

export interface ClassifyFailureInput {
  gates?: QualityGatesReport;
  confusion?: GenreConfusionReport;
  locality?: LocalityResult;
  consistency?: SelfConsistencyReport;
  validatorIssues?: number;
  features?: AnalyzerFeatures;
  graph?: SessionGraph;
}

export interface ClassifiedFailure {
  categories: FailureCategory[];
  evidence: Record<string, unknown>;
}

export function classifyFailure(input: ClassifyFailureInput): ClassifiedFailure {
  const cats = new Set<FailureCategory>();
  const evidence: Record<string, unknown> = {};

  if (input.gates) {
    for (const g of input.gates.gates) {
      if (g.passed) continue;
      switch (g.name) {
        case 'non_silent_ratio':
          cats.add('silence_or_near_silence');
          evidence.non_silent_ratio = g.value; break;
        case 'active_band_count':
        case 'low_band_energy_floor':
        case 'onset_count_floor':
          cats.add('technically_valid_but_musically_empty');
          evidence[g.name] = g.value;
          if (g.name === 'low_band_energy_floor') {
            cats.add('low_end_failure');
          }
          break;
        case 'loop_fatigue_score':
        case 'feature_novelty_per_8_bars':
          cats.add('loop_fatigue');
          evidence[g.name] = g.value; break;
        case 'section_energy_delta':
        case 'arrangement_arc_score':
          cats.add('no_arrangement_arc');
          evidence[g.name] = g.value; break;
        case 'stereo_low_mono_guard':
          cats.add('low_end_failure');
          evidence[g.name] = g.value; break;
        case 'true_peak_guard':
          // True peak hot is its own thing; count as mix_mud since limiter would fix.
          cats.add('mix_mud');
          evidence.true_peak = g.value; break;
        case 'lufs_target_distance':
          cats.add('mix_mud');
          evidence.lufs_distance = g.value; break;
      }
    }
  }

  // Genre confusion → genre_collapse.
  if (input.confusion && !input.confusion.intended_top1) {
    cats.add('genre_collapse');
    evidence.intended_genre = input.confusion.intended_genre;
    evidence.actual_top1 = input.confusion.top1;
    evidence.intended_top3 = input.confusion.intended_top3;
  }

  // Mid-band buildup → mix_mud (cross-check on band_rms).
  const bands = input.features?.spectral?.band_rms;
  if (bands) {
    const lowMid = bands.low_mid ?? 0;
    const mid = bands.mid ?? 1;
    // ADR 0005: kick-led genres naturally run low_mid > mid because
    // dirt-samples 909 kick body sits at 200-400 Hz (measured kick-only
    // sections at 8-10× ratio). Trigger mud only when low_mid genuinely
    // overwhelms mid (>8×).
    if (mid > 0 && lowMid / mid > 8.0) {
      cats.add('mix_mud');
      evidence.low_mid_to_mid_ratio = lowMid / mid;
    }
    const high = bands.high ?? 0;
    const air = bands.air ?? 0;
    if ((high + air) > 0 && (high + air) / Math.max(1e-6, mid) > 1.8) {
      cats.add('harsh_highs');
      evidence.high_band_to_mid_ratio = (high + air) / mid;
    }
  }

  // Fake breakdown — declared breakdown section not actually quieter than drop.
  if (input.gates?.per_section && input.graph) {
    const sectionByName = new Map(input.graph.song.sections.map((s) => [s.id, s]));
    let drop_db = -Infinity;
    let breakdown_db = -Infinity;
    for (const sa of input.gates.per_section.sections) {
      const meta = sectionByName.get(sa.section_id);
      if (!meta || !Number.isFinite(sa.energy_db)) continue;
      if (meta.function === 'drop') drop_db = Math.max(drop_db, sa.energy_db);
      if (meta.function === 'breakdown') breakdown_db = Math.max(breakdown_db, sa.energy_db);
    }
    if (Number.isFinite(drop_db) && Number.isFinite(breakdown_db) && breakdown_db >= drop_db - 0.5) {
      cats.add('fake_breakdown');
      evidence.fake_breakdown_drop_db = drop_db;
      evidence.fake_breakdown_breakdown_db = breakdown_db;
    }
  }

  // Over-reverb proxy: very wide mid-band stereo + tail not specified — heuristic only.
  if (input.features?.stereo) {
    const wMid = input.features.stereo.width_mid ?? 0;
    const wHigh = input.features.stereo.width_high ?? 0;
    if (wMid > 0.7 && wHigh > 0.7) {
      cats.add('over_reverb');
      evidence.stereo_width_mid = wMid;
      evidence.stereo_width_high = wHigh;
    }
  }

  // Weak kick/bass relationship: mono_low_compliance is high but low_band energy is low,
  // implying kick + bass collide or duck below floor.
  if (input.features?.spectral?.band_rms) {
    const sub = input.features.spectral.band_rms.sub ?? 0;
    const low = input.features.spectral.band_rms.low ?? 0;
    if (sub < 0.005 && low < 0.005) {
      cats.add('weak_kick_bass_relationship');
      evidence.sub_rms = sub;
      evidence.low_rms = low;
    }
  }

  if (input.locality && (input.locality.unrelated_change_ratio > 0.4 || input.locality.invariant_violations.length > 0)) {
    cats.add('revision_drift');
    evidence.unrelated_change_ratio = input.locality.unrelated_change_ratio;
    evidence.invariant_violations = input.locality.invariant_violations.map((v) => v.path);
  }

  if (input.consistency && !input.consistency.stable) {
    cats.add('critic_instability');
    evidence.max_stddev = input.consistency.max_stddev;
    evidence.top_target_overlap = input.consistency.top_target_overlap;
  }

  if ((input.validatorIssues ?? 0) > 0) {
    cats.add('strudel_validation_gap');
    evidence.validator_issues = input.validatorIssues;
  }

  // Render/analyzer mismatch: detected BPM far from intended BPM.
  const intendedBpm = input.graph?.brief.bpm;
  const detectedBpm = input.features?.rhythmic?.bpm;
  const bpmConfidence = input.features?.rhythmic?.bpm_confidence;
  if (intendedBpm && detectedBpm && Number.isFinite(detectedBpm)) {
    const ratio = detectedBpm / intendedBpm;
    const isHalfDouble = Math.abs(ratio - 1) < 0.1 || Math.abs(ratio - 0.5) < 0.05 || Math.abs(ratio - 2) < 0.1;
    const confidenceIsActionable = typeof bpmConfidence !== 'number' || bpmConfidence >= 0.5;
    const totalBars = input.graph?.song?.total_bars;
    const durationIsActionable = typeof totalBars !== 'number' || totalBars >= 12;
    if (durationIsActionable && confidenceIsActionable && !isHalfDouble && Math.abs(detectedBpm - intendedBpm) > 15) {
      cats.add('render_analyzer_mismatch');
      evidence.intended_bpm = intendedBpm;
      evidence.detected_bpm = detectedBpm;
      if (typeof bpmConfidence === 'number') evidence.bpm_confidence = bpmConfidence;
      if (typeof totalBars === 'number') evidence.total_bars = totalBars;
    }
  }

  return { categories: Array.from(cats), evidence };
}
