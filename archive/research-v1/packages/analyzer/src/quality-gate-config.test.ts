import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import {
  QUALITY_GATE_THRESHOLDS,
  QUALITY_GATE_THRESHOLDS_PATH,
  loadQualityGateThresholds,
} from './quality-gate-config.js';
import {
  BROKEN_RENDERER_NSR,
  SILENCE_FLOOR_HIGH_DB,
  SILENCE_FLOOR_LOW_DB,
  SPARSE_OK_NSR,
} from './silence.js';

describe('quality gate threshold config', () => {
  it('loads the YAML threshold registry with evidence pointers', () => {
    expect(existsSync(QUALITY_GATE_THRESHOLDS_PATH)).toBe(true);
    const cfg = loadQualityGateThresholds();
    expect(cfg.evidence.calibration_doc).toBe('docs/adr/0005-quality-gate-calibration.md');
    expect(cfg.evidence.gap_closeout).toBe('docs/gaps-1234-closeout.md');
    expect(cfg.silence.broken_renderer_nsr).toBeGreaterThan(0);
    expect(cfg.silence.broken_renderer_nsr).toBeLessThan(cfg.silence.sparse_ok_nsr);
    expect(cfg.mix.lufs_distance_warning_lu).toBeLessThan(cfg.mix.lufs_distance_hard_fail_lu);
  });

  it('exports silence constants from the YAML registry, not a second source', () => {
    expect(SILENCE_FLOOR_LOW_DB).toBe(QUALITY_GATE_THRESHOLDS.silence.floor_low_db);
    expect(SILENCE_FLOOR_HIGH_DB).toBe(QUALITY_GATE_THRESHOLDS.silence.floor_high_db);
    expect(BROKEN_RENDERER_NSR).toBe(QUALITY_GATE_THRESHOLDS.silence.broken_renderer_nsr);
    expect(SPARSE_OK_NSR).toBe(QUALITY_GATE_THRESHOLDS.silence.sparse_ok_nsr);
  });
});
