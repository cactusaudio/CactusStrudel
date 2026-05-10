// Pre-render graph-level gain staging. Mutates SessionGraph.mix_graph.orbits
// so that the deterministic baseline ships sane per-genre level relationships.
//
// Key relationships (per genre):
// - kick is the loudest single layer (by gain) in club genres
// - bass sits 2-4 dB under kick
// - chord/pad sit 6-10 dB under kick to leave headroom
// - hat sits 8-12 dB under kick
//
// Applied AFTER buildSessionGraphFromBrief and AFTER applyArrangementCoverage,
// BEFORE compileSessionGraph.

import type { Role, SessionGraph } from '@cactus/ir';

interface GenreGainProfile {
  /** Linear gain by role; values around 1.0 = unity. */
  by_role: Partial<Record<Role, number>>;
  /** Default for any role not listed. */
  default: number;
}

const PROFILES: Record<string, GenreGainProfile> = {
  techno: {
    // chord trimmed to 0.25 to keep low_mid/mid ratio in line — square-wave
    // stabs were burying mid band under low-mid pile-up in Phase 14 smoke.
    by_role: { kick: 0.85, sub: 0.65, bass: 0.65, hat: 0.4, chord: 0.25, snare: 0.55, percussion: 0.4 },
    default: 0.45,
  },
  dub_techno: {
    by_role: { kick: 0.9, bass: 0.7, hat: 0.35, chord: 0.5, pad: 0.4, noise: 0.18 },
    default: 0.45,
  },
  dnb: {
    by_role: { kick: 0.95, snare: 0.85, bass: 0.85, hat: 0.45, pad: 0.4, fx: 0.25 },
    default: 0.5,
  },
  idm: {
    by_role: { kick: 0.85, percussion: 0.65, bass: 0.7, lead: 0.55, fx: 0.3 },
    default: 0.5,
  },
  ambient: {
    by_role: { pad: 0.55, fx: 0.25 },
    default: 0.45,
  },
  house: {
    by_role: { kick: 0.95, bass: 0.7, hat: 0.5, chord: 0.55, snare: 0.55 },
    default: 0.5,
  },
};

export interface GainStagingReport {
  genre: string;
  mutations: Array<{ orbit: string; layer_id: string; role: string; before: number; after: number }>;
}

export function applyGainStaging(graph: SessionGraph): GainStagingReport {
  const slug = graph.brief.primary_genre ?? 'techno';
  const profile = PROFILES[slug] ?? PROFILES.techno!;
  const report: GainStagingReport = { genre: slug, mutations: [] };

  for (const layer of graph.layers) {
    const o = String(layer.orbit);
    const orbit = graph.mix_graph.orbits[o];
    if (!orbit) continue;
    const target = profile.by_role[layer.role] ?? profile.default;
    const before = orbit.gain;
    if (Math.abs(before - target) < 0.001) continue;
    orbit.gain = target;
    report.mutations.push({ orbit: o, layer_id: layer.id, role: layer.role, before, after: target });
  }

  return report;
}
