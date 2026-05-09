export interface MasteringTargets {
  lufs: number;
  true_peak_max: number;
}

export interface MasteringInput {
  inputWavPath: string;
  outputWavPath: string;
  targets: MasteringTargets;
}

export async function masterTrack(_input: MasteringInput): Promise<void> {
  throw new Error('mastering not implemented (Phase 11)');
}
