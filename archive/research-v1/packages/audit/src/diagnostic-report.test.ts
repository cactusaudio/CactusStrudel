import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeDiagnosticReport } from './diagnostic-report.js';
import type { ExpandedPrompt } from './prompt-suite.js';

const TMP = path.join(os.tmpdir(), 'cactus-diag-report-tests');

beforeAll(async () => { await fs.mkdir(TMP, { recursive: true }); });

const prompt: ExpandedPrompt = {
  id: 'test-001',
  text: 'techno 130 BPM',
  intent_genre: 'techno',
  expected_modifiers: [],
  forbidden_modifiers: [],
  intent_class: 'canonical',
  suite_genre: 'techno',
  seed: 1,
};

describe('writeDiagnosticReport', () => {
  it('writes JSON + markdown for a valid section diagnostic', async () => {
    const out = path.join(TMP, 'r1');
    const r = await writeDiagnosticReport({
      prompt,
      sections: {
        total_duration_sec: 10,
        rendered_sections: [{
          section_id: 's1', name: 'main', function: 'main',
          start_sec: 0, end_sec: 10, duration_sec: 10,
          active_layer_count: 4, active_layer_ids: ['kick', 'hat', 'bass', 'chord'],
          non_silent_ratio: 0.95, rms: 0.2, rms_db: -14,
          short_term_lufs_proxy: -8, band_rms: { mid: 0.05, low_mid: 0.06 },
          onset_density: 4, true_peak_db: -1,
        }],
        unrendered_sections: [],
      },
      outDir: out,
    });
    const json = JSON.parse(await fs.readFile(r.json, 'utf8'));
    expect(json.sections.rendered_sections.length).toBe(1);
    const md = await fs.readFile(r.md, 'utf8');
    expect(md).toContain('main');
  });

  it('localizes silence in the markdown when a section is below 0.6', async () => {
    const out = path.join(TMP, 'r2');
    const r = await writeDiagnosticReport({
      prompt,
      sections: {
        total_duration_sec: 10,
        rendered_sections: [{
          section_id: 's1', name: 'intro', function: 'intro',
          start_sec: 0, end_sec: 5, duration_sec: 5,
          active_layer_count: 1, active_layer_ids: ['kick'],
          non_silent_ratio: 0.3, rms: 0.05, rms_db: -26,
          short_term_lufs_proxy: -22, band_rms: {},
          onset_density: 1, true_peak_db: -8,
        }],
        unrendered_sections: [],
      },
      outDir: out,
    });
    const md = await fs.readFile(r.md, 'utf8');
    expect(md).toContain('silence localization');
    expect(md).toContain('intro');
  });
});
