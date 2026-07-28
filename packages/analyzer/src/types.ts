export interface AnalyzerFeatures {
  spectral?: Partial<{
    centroid: number;
    rolloff: number;
    flatness: number;
    flux: number;
    mfcc_mean: number[];
    mfcc_std: number[];
    band_rms: Record<string, number>;
  }>;
  rhythmic?: Partial<{
    bpm: number;
    bpm_confidence: number;
    onset_density: Record<string, number>;
    grid_regularity: number;
    syncopation_proxy: number;
  }>;
  loudness?: Partial<{
    lufs_integrated: number;
    lufs_short_max: number;
    true_peak_db: number;
    plr: number;
    dr: number;
  }>;
  stereo?: Partial<{
    width_low: number;
    width_mid: number;
    width_high: number;
    mono_low_compliance: number;
  }>;
  embedding?: {
    vector: number[];
    model: string;
  };
}
