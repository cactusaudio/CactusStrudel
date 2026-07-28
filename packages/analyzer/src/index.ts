/// <reference path="./types/essentia-js.d.ts" />

import type { AnalyzerFeatures } from './types.js';
import { readWav, mixToMono, type DecodedAudio } from './wav-io.js';
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
  return analyzeDecoded(decoded);
}

export async function analyzeDecoded(decoded: DecodedAudio): Promise<AnalyzerFeatures> {
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

export type { AnalyzerFeatures } from './types.js';
export { computeSpectralFeatures, computeRhythmFeatures, computeStereoFeatures, computeLoudness };
export { generateSpectrogram } from './spectrogram.js';
export { readWav, mixToMono, resample, type DecodedAudio } from './wav-io.js';
