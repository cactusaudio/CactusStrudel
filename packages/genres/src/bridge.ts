import type { GenreSpec } from './index.js';

export interface BridgeOptions {
  primary: GenreSpec;
  secondary: GenreSpec;
  /** 0..1; 0 = pure primary, 1 = pure secondary, 0.5 = midpoint */
  weight?: number;
}

export function bridgeGenres(opts: BridgeOptions): GenreSpec {
  const w = opts.weight ?? 0.3;
  const inv = 1 - w;
  const a = opts.primary;
  const b = opts.secondary;
  return {
    ...a,
    slug: `${a.slug}_x_${b.slug}`,
    display_name: `${a.display_name} × ${b.display_name}`,
    bpm_range: [
      Math.round(a.bpm_range[0] * inv + b.bpm_range[0] * w),
      Math.round(a.bpm_range[1] * inv + b.bpm_range[1] * w),
    ],
    section_template: a.section_template, // primary's structure wins
    drum_archetypes: dedupe([...a.drum_archetypes, ...b.drum_archetypes]),
    bass_archetypes: dedupe([...a.bass_archetypes, ...b.bass_archetypes]),
    harmonic_palette: {
      modes: dedupe([...a.harmonic_palette.modes, ...b.harmonic_palette.modes]),
      typical_chord_progressions: a.harmonic_palette.typical_chord_progressions,
    },
    sound_palette: { ...a.sound_palette, ...b.sound_palette },
    mix_targets: {
      lufs: a.mix_targets.lufs * inv + b.mix_targets.lufs * w,
      true_peak_max: Math.min(a.mix_targets.true_peak_max, b.mix_targets.true_peak_max),
    },
    critic_rubric_hints: dedupe([...a.critic_rubric_hints, ...b.critic_rubric_hints]),
    modifiers: { ...a.modifiers, ...b.modifiers },
  };
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
