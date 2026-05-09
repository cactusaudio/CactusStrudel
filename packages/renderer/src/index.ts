export interface RenderInput {
  code: string;
  durationCycles: number;
  sampleRate?: number;
  cps?: number;
}

export interface RenderResult {
  wavPath: string;
  sampleRate: number;
  durationSec: number;
  channels: number;
  packageVersions: Record<string, string>;
  warnings: string[];
}

export async function render(_input: RenderInput): Promise<RenderResult> {
  throw new Error('renderer not implemented (Phase 4)');
}
