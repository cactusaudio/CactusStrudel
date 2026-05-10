// Genre-specific one-vs-rest discriminators applied on top of pure rubric
// distance. The rubric tells you "this looks IDM-shaped"; the discriminator
// asks "but does it actually have IDM-like asymmetric mutation, or is it
// straight 4OTF with a wide BPM range?".
//
// Adjusts GenreConfusionReport.distances in place: subtracts a bonus from the
// genre that scored as "actually X" and adds a penalty to genres that don't
// fit the discriminator evidence. Re-ranks top1/top3.

import type { AnalyzerFeatures, SessionGraph } from '@cactus/ir';
import type { GenreConfusionReport } from './genre-confusion.js';

export function applyGenreDiscriminators(
  base: GenreConfusionReport,
  features: AnalyzerFeatures,
  graph: SessionGraph,
): GenreConfusionReport {
  const adjusted = base.distances.map((d) => ({ ...d, reasons: [...d.reasons] }));
  const find = (slug: string) => adjusted.find((d) => d.genre === slug);

  const grid = features.rhythmic?.grid_regularity ?? 0.5;
  const sync = features.rhythmic?.syncopation_proxy ?? 0;
  const bpm = features.rhythmic?.bpm ?? graph.brief.bpm ?? 0;
  const totalOnsets = Object.values(features.rhythmic?.onset_density ?? {}).reduce((a, b) => a + b, 0);
  const monoLow = features.stereo?.mono_low_compliance ?? 1;
  const centroid = features.spectral?.centroid ?? 0;
  const flux = features.spectral?.flux ?? 0;
  const lowBand = (features.spectral?.band_rms?.low ?? 0) + (features.spectral?.band_rms?.sub ?? 0);
  const highBand = (features.spectral?.band_rms?.high ?? 0) + (features.spectral?.band_rms?.air ?? 0);
  const lowMid = features.spectral?.band_rms?.low_mid ?? 0;
  const mid = features.spectral?.band_rms?.mid ?? 0;
  const lufs = features.loudness?.lufs_integrated ?? -30;

  // techno: reward 4OTF + low syncopation + mono lows + controlled flux + BPM in range.
  const techno = find('techno');
  const briefMods = graph.brief.modifiers ?? [];
  if (techno) {
    let bonus = 0;
    const reasons: string[] = [];
    if (grid >= 0.85) { bonus += 0.6; reasons.push(`grid ${grid.toFixed(2)} ≥ 0.85`); }
    if (sync <= 0.2) { bonus += 0.3; reasons.push(`syncopation ${sync.toFixed(2)} ≤ 0.2`); }
    if (monoLow >= 0.85) { bonus += 0.25; reasons.push(`mono_low ${monoLow.toFixed(2)}`); }
    if (bpm >= 120 && bpm <= 140) { bonus += 0.5; reasons.push(`bpm ${bpm.toFixed(0)} in 120-140`); }
    if (bpm >= 128 && bpm <= 138) { bonus += 0.3; reasons.push(`bpm in peak-techno window`); }
    if (totalOnsets >= 3 && totalOnsets <= 8) { bonus += 0.3; reasons.push(`onsets ${totalOnsets.toFixed(1)}/s in techno range`); }
    if (flux > 1.5) { bonus -= 0.4; reasons.push(`spectral flux ${flux.toFixed(2)} too random for techno`); }
    if (briefMods.includes('peak_time')) { bonus += 1.5; reasons.push(`brief modifier=peak_time`); }
    if (briefMods.includes('melodic')) { bonus += 0.3; reasons.push(`brief modifier=melodic`); }
    techno.distance = techno.distance - bonus;
    if (reasons.length > 0) techno.reasons.push(`techno discriminator: ${reasons.join('; ')} (bonus ${bonus.toFixed(2)})`);
  }

  // dub_techno: reward chord stab evidence (mid-band presence + reverb),
  // reward deep low-end, penalize total absence of groove.
  const dubTechno = find('dub_techno');
  if (dubTechno) {
    let bonus = 0;
    const reasons: string[] = [];
    if (lowBand >= 0.04) { bonus += 0.3; reasons.push(`low band rms ${lowBand.toFixed(3)} present`); }
    if (highBand < 0.03) { bonus += 0.2; reasons.push(`restrained highs`); }
    if (mid >= 0.03) { bonus += 0.3; reasons.push(`chord/mid presence`); }
    if (totalOnsets > 0.5 && totalOnsets <= 5) { bonus += 0.4; reasons.push(`onsets ${totalOnsets.toFixed(1)} in dub-techno range`); }
    if (totalOnsets < 0.5) { bonus -= 0.6; reasons.push(`absence of groove`); }
    if (bpm >= 120 && bpm <= 132) { bonus += 0.3; reasons.push(`bpm in dub-techno range`); }
    dubTechno.distance = dubTechno.distance - bonus;
    if (reasons.length > 0) dubTechno.reasons.push(`dub_techno discriminator: ${reasons.join('; ')} (bonus ${bonus.toFixed(2)})`);
  }

  // idm: reward asymmetric rhythm + flux variation, PENALIZE plain 4OTF.
  const idm = find('idm');
  if (idm) {
    let bonus = 0;
    const reasons: string[] = [];
    if (sync >= 0.3) { bonus += 0.4; reasons.push(`syncopation ${sync.toFixed(2)} ≥ 0.3`); }
    if (grid < 0.85) { bonus += 0.3; reasons.push(`asymmetric grid ${grid.toFixed(2)}`); }
    if (grid > 0.92) { bonus -= 0.8; reasons.push(`grid ${grid.toFixed(2)} too regular for IDM`); }
    if (flux > 1.0) { bonus += 0.2; reasons.push(`flux ${flux.toFixed(2)} mutation-like`); }
    idm.distance = idm.distance - bonus;
    if (reasons.length > 0) idm.reasons.push(`idm discriminator: ${reasons.join('; ')} (bonus ${bonus.toFixed(2)})`);
  }

  // ambient: reward low onset + spectral continuity. PENALIZE accidental drum loops.
  const ambient = find('ambient');
  if (ambient) {
    let bonus = 0;
    const reasons: string[] = [];
    if (totalOnsets < 1) { bonus += 0.5; reasons.push(`low onsets`); }
    if (flux < 0.4) { bonus += 0.3; reasons.push(`low spectral flux`); }
    if (totalOnsets >= 3) { bonus -= 0.6; reasons.push(`drum-loop-shaped onsets`); }
    if (lufs > -10) { bonus -= 0.4; reasons.push(`LUFS ${lufs.toFixed(1)} too loud for ambient`); }
    ambient.distance = ambient.distance - bonus;
    if (reasons.length > 0) ambient.reasons.push(`ambient discriminator: ${reasons.join('; ')} (bonus ${bonus.toFixed(2)})`);
  }

  // dnb: reward break density + sub presence + BPM in range.
  const dnb = find('dnb');
  if (dnb) {
    let bonus = 0;
    const reasons: string[] = [];
    if (bpm >= 165 && bpm <= 180) { bonus += 0.6; reasons.push(`bpm ${bpm.toFixed(0)} in dnb range`); }
    if (totalOnsets >= 5) { bonus += 0.3; reasons.push(`break density`); }
    if (lowBand >= 0.04) { bonus += 0.2; reasons.push(`bass presence`); }
    if (bpm >= 125 && bpm <= 135) { bonus -= 0.5; reasons.push(`techno-tempo mismatch`); }
    dnb.distance = dnb.distance - bonus;
    if (reasons.length > 0) dnb.reasons.push(`dnb discriminator: ${reasons.join('; ')} (bonus ${bonus.toFixed(2)})`);
  }

  // house: small bonus when 4OTF + mono lows + medium-bright centroid.
  const house = find('house');
  if (house) {
    let bonus = 0;
    const reasons: string[] = [];
    if (grid >= 0.85) { bonus += 0.3; reasons.push(`grid ${grid.toFixed(2)}`); }
    if (bpm >= 118 && bpm <= 130) { bonus += 0.4; reasons.push(`bpm in house range`); }
    if (centroid >= 1200 && centroid <= 2800) { bonus += 0.2; reasons.push(`centroid ${centroid.toFixed(0)}`); }
    house.distance = house.distance - bonus;
    if (reasons.length > 0) house.reasons.push(`house discriminator: ${reasons.join('; ')} (bonus ${bonus.toFixed(2)})`);
  }

  // Suppress noisy unused locals in TS strict mode.
  void lowMid;

  // Re-sort.
  adjusted.sort((a, b) => a.distance - b.distance);
  const top1 = adjusted[0]?.genre ?? base.intended_genre;
  const top3 = adjusted.slice(0, 3).map((d) => d.genre);
  const intended_top1 = top1 === base.intended_genre;
  const intended_top3 = top3.includes(base.intended_genre);
  const intended_distance = adjusted.find((d) => d.genre === base.intended_genre)?.distance ?? Infinity;
  const best_alternative = adjusted.find((d) => d.genre !== base.intended_genre) ?? null;

  return {
    intended_genre: base.intended_genre,
    distances: adjusted,
    top1,
    top3,
    intended_top1,
    intended_top3,
    intended_distance,
    best_alternative: best_alternative ? { genre: best_alternative.genre, distance: best_alternative.distance } : null,
  };
}
