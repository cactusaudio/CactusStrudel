import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export interface QualityGateThresholds {
  schema_version: 1;
  evidence: {
    calibration_doc: string;
    gap_closeout: string;
    intent: string;
  };
  silence: {
    floor_low_db: number;
    floor_high_db: number;
    broken_renderer_nsr: number;
    sparse_ok_nsr: number;
  };
  spectral: {
    active_band_rms_floor: number;
    active_band_count_min: number;
    low_band_energy_floor: number;
    ambient_low_band_relax_multiplier: number;
  };
  rhythm: {
    default_onset_density_floor: number;
  };
  arrangement: {
    short_track_min_bars: number;
    section_energy_delta_db: number;
    feature_novelty_per_8_bars_cv: number;
    arrangement_arc_db: number;
    loop_fatigue_similarity_max: number;
  };
  mix: {
    default_stereo_mono_low_compliance_min: number;
    default_true_peak_max_dbtp: number;
    true_peak_hard_fail_margin_db: number;
    default_lufs_target: number;
    lufs_distance_warning_lu: number;
    lufs_distance_hard_fail_lu: number;
  };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const QUALITY_GATE_THRESHOLDS_PATH = path.resolve(HERE, '..', 'quality-gates.yaml');

export const QUALITY_GATE_THRESHOLDS: QualityGateThresholds = loadQualityGateThresholds();

export function loadQualityGateThresholds(file = QUALITY_GATE_THRESHOLDS_PATH): QualityGateThresholds {
  const raw = parseYaml(readFileSync(file, 'utf8')) as unknown;
  return validateThresholds(raw);
}

function validateThresholds(raw: unknown): QualityGateThresholds {
  const cfg = raw as QualityGateThresholds;
  if (!cfg || typeof cfg !== 'object') throw new Error('quality gate thresholds must be an object');
  if (cfg.schema_version !== 1) throw new Error('quality gate thresholds schema_version must be 1');

  requiredString(cfg.evidence?.calibration_doc, 'evidence.calibration_doc');
  requiredString(cfg.evidence?.gap_closeout, 'evidence.gap_closeout');
  requiredString(cfg.evidence?.intent, 'evidence.intent');

  finite(cfg.silence?.floor_low_db, 'silence.floor_low_db');
  finite(cfg.silence?.floor_high_db, 'silence.floor_high_db');
  ordered(cfg.silence.floor_low_db, cfg.silence.floor_high_db, 'silence floor db');
  ratio(cfg.silence.broken_renderer_nsr, 'silence.broken_renderer_nsr');
  ratio(cfg.silence.sparse_ok_nsr, 'silence.sparse_ok_nsr');
  ordered(cfg.silence.broken_renderer_nsr, cfg.silence.sparse_ok_nsr, 'silence nsr tiers');

  positive(cfg.spectral?.active_band_rms_floor, 'spectral.active_band_rms_floor');
  positive(cfg.spectral?.active_band_count_min, 'spectral.active_band_count_min');
  positive(cfg.spectral?.low_band_energy_floor, 'spectral.low_band_energy_floor');
  ratio(cfg.spectral?.ambient_low_band_relax_multiplier, 'spectral.ambient_low_band_relax_multiplier');

  positive(cfg.rhythm?.default_onset_density_floor, 'rhythm.default_onset_density_floor');

  positive(cfg.arrangement?.short_track_min_bars, 'arrangement.short_track_min_bars');
  positive(cfg.arrangement?.section_energy_delta_db, 'arrangement.section_energy_delta_db');
  positive(cfg.arrangement?.feature_novelty_per_8_bars_cv, 'arrangement.feature_novelty_per_8_bars_cv');
  positive(cfg.arrangement?.arrangement_arc_db, 'arrangement.arrangement_arc_db');
  ratio(cfg.arrangement?.loop_fatigue_similarity_max, 'arrangement.loop_fatigue_similarity_max');

  ratio(cfg.mix?.default_stereo_mono_low_compliance_min, 'mix.default_stereo_mono_low_compliance_min');
  finite(cfg.mix?.default_true_peak_max_dbtp, 'mix.default_true_peak_max_dbtp');
  positive(cfg.mix?.true_peak_hard_fail_margin_db, 'mix.true_peak_hard_fail_margin_db');
  finite(cfg.mix?.default_lufs_target, 'mix.default_lufs_target');
  positive(cfg.mix?.lufs_distance_warning_lu, 'mix.lufs_distance_warning_lu');
  positive(cfg.mix?.lufs_distance_hard_fail_lu, 'mix.lufs_distance_hard_fail_lu');
  ordered(cfg.mix.lufs_distance_warning_lu, cfg.mix.lufs_distance_hard_fail_lu, 'lufs distance tiers');

  return cfg;
}

function requiredString(v: unknown, name: string): void {
  if (typeof v !== 'string' || v.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function finite(v: unknown, name: string): asserts v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be finite`);
}

function positive(v: unknown, name: string): asserts v is number {
  finite(v, name);
  if (v <= 0) throw new Error(`${name} must be positive`);
}

function ratio(v: unknown, name: string): asserts v is number {
  positive(v, name);
  if (v >= 1) throw new Error(`${name} must be in (0, 1)`);
}

function ordered(lo: number, hi: number, name: string): void {
  if (!(lo < hi)) throw new Error(`${name} must be ordered ascending`);
}
