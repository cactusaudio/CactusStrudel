// Pre-render band balance: applies high-pass / cleanup defaults to layers that
// would otherwise pile up energy in 200-500 Hz (low_mid mud) or fight the
// kick/bass low end. Operates on graph.sound_palette + graph.mix_graph.

import type { SessionGraph } from '@cactus/ir';

export interface BandBalanceReport {
  genre: string;
  mutations: Array<{ layer_id: string; role: string; change: string }>;
}

const HPF_TARGET_BY_ROLE: Record<string, number> = {
  // Each entry: minimum HPF cutoff applied to this role. Layers above this
  // value already are left alone; layers without an HPF get one inserted.
  // chord/pad pushed to 400 Hz to clear bass + low-mid for kick + bass.
  chord: 400,
  pad: 350,
  hat: 6000,
  cymbal: 5000,
  snare: 200,
  lead: 350,
  noise: 400,
  fx: 400,
};

export function applyBandBalance(graph: SessionGraph): BandBalanceReport {
  const slug = graph.brief.primary_genre ?? 'techno';
  const report: BandBalanceReport = { genre: slug, mutations: [] };

  for (const layer of graph.layers) {
    const dec = graph.sound_palette.layers[layer.id];
    if (!dec) continue;
    const minHpf = HPF_TARGET_BY_ROLE[layer.role];
    if (!minHpf) continue;
    const existing = dec.effects.find((e) => e.type === 'hpf');
    if (existing) {
      const cur = (existing.params as { freq?: number }).freq ?? 0;
      if (cur < minHpf) {
        existing.params = { ...existing.params, freq: minHpf };
        report.mutations.push({ layer_id: layer.id, role: layer.role, change: `hpf raised ${cur}Hz → ${minHpf}Hz` });
      }
    } else {
      dec.effects.unshift({ type: 'hpf', params: { freq: minHpf } });
      report.mutations.push({ layer_id: layer.id, role: layer.role, change: `hpf added @${minHpf}Hz` });
    }
  }

  // dub_techno-specific: chord reverb gets a low-cut to keep tail out of the
  // bass band. Rendered through orbit.room_send → no per-effect handle, so we
  // shave the chord orbit's room_send slightly.
  if (slug === 'dub_techno') {
    for (const layer of graph.layers) {
      if (layer.role !== 'chord') continue;
      const orbit = graph.mix_graph.orbits[String(layer.orbit)];
      if (!orbit) continue;
      const before = orbit.room_send;
      if (before > 0.45) {
        orbit.room_send = 0.45;
        report.mutations.push({ layer_id: layer.id, role: layer.role, change: `dub_techno chord room_send ${before.toFixed(2)} → 0.45` });
      }
    }
  }

  // Stacking detection: if more than 2 layers in low_mid territory (chord+pad+stab)
  // are simultaneously active in any "drop" section, halve the gains of the
  // recommended-tier ones.
  const lowMidRoles = new Set(['chord', 'pad']);
  for (const sec of graph.song.sections) {
    if (sec.function !== 'drop' && sec.function !== 'main') continue;
    const stacked = graph.layers.filter((l) =>
      lowMidRoles.has(l.role) && (graph.song.layer_activation[l.id]?.sections[sec.id] ?? false),
    );
    if (stacked.length < 2) continue;
    // Keep the first one at full gain; shrink the others by 0.7×.
    for (let i = 1; i < stacked.length; i++) {
      const layer = stacked[i]!;
      const orbit = graph.mix_graph.orbits[String(layer.orbit)];
      if (!orbit) continue;
      const before = orbit.gain;
      if (before > 0.4) {
        orbit.gain = before * 0.7;
        report.mutations.push({ layer_id: layer.id, role: layer.role, change: `stacked-low-mid: gain ${before.toFixed(2)} → ${orbit.gain.toFixed(2)}` });
      }
    }
  }

  return report;
}
