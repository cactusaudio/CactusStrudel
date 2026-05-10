import type { AnalyzerFeatures } from '@cactus/ir';
import { readWav, mixToMono } from './wav-io.js';
import { computeSpectralFeatures } from './spectral.js';
import { computeRhythmFeatures } from './rhythm.js';
import { computeStereoFeatures } from './stereo.js';
import { computeLoudness } from './loudness.js';

export interface AnalyzeOptions {
  resampleTo?: number;
}

export async function analyzeWav(
  wavPath: string,
  _options: AnalyzeOptions = {},
): Promise<AnalyzerFeatures> {
  const decoded = await readWav(wavPath);
  const mono = mixToMono(decoded.channels);

  const spectral = await computeSpectralFeatures(mono, decoded.sampleRate);
  const rhythm = await computeRhythmFeatures(mono, decoded.sampleRate);
  const stereo = computeStereoFeatures(decoded.channels, decoded.sampleRate);
  const loudness = computeLoudness({
    channels: decoded.channels,
    sampleRate: decoded.sampleRate,
  });

  return {
    spectral,
    rhythmic: rhythm,
    loudness: {
      lufs_integrated: loudness.integratedLufs,
      lufs_short_max: loudness.shortTermMaxLufs,
      true_peak_db: loudness.truePeakDb,
    },
    stereo,
  };
}

export { computeSpectralFeatures, computeRhythmFeatures, computeStereoFeatures, computeLoudness };
export { generateSpectrogram } from './spectrogram.js';
export { readWav, mixToMono, resample } from './wav-io.js';
export {
  computeSectionFeatures,
  type SectionAnalysis,
  type SectionFeatures,
} from './section-features.js';
export {
  runQualityGates,
  type QualityGateResult,
  type QualityGatesReport,
  type QualityGatesInput,
} from './quality-gates.js';
export {
  computeSectionDiagnostics,
  type SectionDiagnostic,
  type SectionDiagnosticsReport,
} from './section-diagnostics.js';
export {
  computeStemDiagnostics,
  type StemDiagnostic,
  type StemDiagnosticsReport,
  type StemRef,
} from './stem-diagnostics.js';
