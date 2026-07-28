// Real producer chain smoke. Gated because it boots Chromium renderer, writes a
// WAV, decodes/analyzes it, then runs the critic on analyzer features.

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { produce } from '@cactus/agent-runtime';
import { critique } from '@cactus/critic';

const SHOULD_RUN = process.env.CACTUS_RENDER_E2E === '1';

describe.skipIf(!SHOULD_RUN)('produce real render→analyze→critic chain', () => {
  it('produces a non-silent WAV, analyzer features, and finite critic scores', async () => {
    const sessionsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cactus-produce-real-'));
    const result = await produce('peak time techno 130 BPM, 8 bars', {
      sessionsRoot,
      seed: 177,
      durationCyclesOverride: 8,
    });

    expect(result.failures).toEqual([]);
    expect(result.validatorIssues).toBe(0);
    expect(result.wavPath).toBeDefined();
    expect(result.featuresPath).toBeDefined();

    const wavStat = await fs.stat(result.wavPath!);
    expect(wavStat.size).toBeGreaterThan(44);

    const features = JSON.parse(await fs.readFile(result.featuresPath!, 'utf8'));
    expect(Number.isFinite(features.loudness?.true_peak_db)).toBe(true);
    expect(Number.isFinite(features.loudness?.lufs_integrated)).toBe(true);
    expect(features.rhythmic?.onset_density).toBeDefined();

    const crit = await critique({ graph: result.graph, features });
    for (const [key, value] of Object.entries(crit.scores)) {
      expect(Number.isFinite(value), `${key} score should be finite`).toBe(true);
    }
  }, 90_000);
});
