import type { AnalyzerFeatures } from '@cactus/ir';

export interface AnalyzeOptions {
  resampleTo?: number;
}

export async function analyzeWav(
  _wavPath: string,
  _options: AnalyzeOptions = {},
): Promise<AnalyzerFeatures> {
  throw new Error('analyzer not implemented (Phase 5)');
}
