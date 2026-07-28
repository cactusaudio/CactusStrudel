import { v4 as uuid } from 'uuid';
import type { CritiqueEntry, Patch, SessionGraph } from '@cactus/ir';

export interface RevisionPlanInput {
  graph: SessionGraph;
  critique: CritiqueEntry;
  /** Cap on patches per pass. */
  maxPatches?: number;
}

/**
 * Convert a CritiqueEntry into ordered Patches that the runtime applies.
 * Heuristic — turns each high-severity target into a JSON Patch.
 *
 * This is a deterministic mapper, not an LLM call. Phase 8 keeps the producer
 * subagents stateless functions over graph slices; Phase 9 + the closed loop
 * stitch them into a multi-iteration search.
 */
export function planRevisions(input: RevisionPlanInput): Patch[] {
  const { graph, critique } = input;
  const cap = input.maxPatches ?? 5;
  const sorted = [...critique.targets].sort((a, b) => b.severity - a.severity).slice(0, cap);

  const patches: Patch[] = [];
  for (const t of sorted) {
    const patch = mapTargetToPatch(t, graph, critique.iteration + 1);
    if (patch) patches.push(patch);
  }
  return patches;
}

function mapTargetToPatch(
  target: import('@cactus/ir').CritiqueTarget,
  graph: SessionGraph,
  iteration: number,
): Patch | undefined {
  // 1. Master gain adjustment for LUFS / true-peak issues.
  if (target.graph_paths.includes('/mix_graph/master/gain')) {
    const evidence = target.evidence as Record<string, unknown>;
    const currentGain = graph.mix_graph.master.gain;
    let newGain = currentGain;
    if (typeof evidence.delta_db === 'number') {
      // delta_db positive → louder → increase gain
      newGain = currentGain * Math.pow(10, evidence.delta_db / 20);
    } else if (typeof evidence.true_peak_db === 'number') {
      // bring peak to -1; gain /= 10^((peak+1)/20)
      newGain = currentGain * Math.pow(10, (-1 - evidence.true_peak_db) / 20);
    }
    // Clamp to safe range.
    newGain = Math.max(0.1, Math.min(2.0, newGain));
    return {
      patch_id: uuid(),
      iteration,
      agent: 'producer-mix-engineer',
      intent: target.problem,
      ops: [{ op: 'replace', path: '/mix_graph/master/gain', value: newGain }],
      expected_audio_effect: { features: ['lufs_integrated', 'true_peak_db'], sections: [] },
    };
  }

  // 2. Mono-fold low orbits when stereo low-band is too wide.
  if (target.graph_paths.includes('/mix_graph/orbits') && /mono_low/.test(target.problem)) {
    const ops: Patch['ops'] = [];
    for (const layer of graph.layers) {
      if (layer.role === 'bass' || layer.role === 'sub' || layer.role === 'kick') {
        const o = String(layer.orbit);
        ops.push({ op: 'replace', path: `/mix_graph/orbits/${o}/width`, value: 0.5 });
      }
    }
    if (ops.length === 0) return undefined;
    return {
      patch_id: uuid(),
      iteration,
      agent: 'producer-mix-engineer',
      intent: target.problem,
      ops,
      expected_audio_effect: { features: ['mono_low_compliance'], sections: [] },
    };
  }

  // 3. Hat density adjustment via pattern replacement.
  if (target.graph_paths.some((p) => p.startsWith('/pattern_bank/patterns/hat'))) {
    const hatLayer = graph.layers.find((l) => l.role === 'hat');
    if (!hatLayer) return undefined;
    const newPattern = /increase/.test(target.revision_instruction) ? 'hh*8' : '[~ hh]*4';
    const ops: Patch['ops'] = [];
    for (const sec of graph.song.sections.filter((s) => s.function === 'drop')) {
      ops.push({
        op: 'replace',
        path: `/pattern_bank/patterns/${hatLayer.id}/${sec.id}`,
        value: { mini_notation: newPattern },
      });
    }
    if (ops.length === 0) return undefined;
    return {
      patch_id: uuid(),
      iteration,
      agent: 'producer-composer',
      intent: target.problem,
      ops,
      expected_audio_effect: { features: ['onset_density_high'], sections: ['drop'] },
    };
  }

  // 4. Energy-curve flatness — bump drop energies, drop intros lower.
  if (target.graph_paths.includes('/song/sections') || target.graph_paths.includes('/song/energy_curve')) {
    const ops: Patch['ops'] = [];
    const im = readMovement(target);
    // G3 path: shortening breakdown sections by user request.
    if (typeof im.breakdown_max_bars === 'number') {
      const max = im.breakdown_max_bars;
      for (let i = 0; i < graph.song.sections.length; i++) {
        const sec = graph.song.sections[i]!;
        if (sec.function === 'breakdown' && sec.end_bar - sec.start_bar > max) {
          ops.push({ op: 'replace', path: `/song/sections/${i}/end_bar`, value: sec.start_bar + max });
        }
      }
    }
    // G3 path: max_energy ceiling (no_edm).
    if (typeof im.max_energy === 'number') {
      const cap = im.max_energy;
      for (let i = 0; i < graph.song.sections.length; i++) {
        if (graph.song.sections[i]!.energy > cap) {
          ops.push({ op: 'replace', path: `/song/sections/${i}/energy`, value: cap });
        }
      }
    }
    // G3 path: drop energy floor (club continuity).
    if (typeof im.drop_energy_floor === 'number') {
      const floor = im.drop_energy_floor;
      for (let i = 0; i < graph.song.sections.length; i++) {
        const sec = graph.song.sections[i]!;
        if ((sec.function === 'drop' || sec.function === 'main') && sec.energy < floor) {
          ops.push({ op: 'replace', path: `/song/sections/${i}/energy`, value: floor });
        }
      }
    }
    // Default: original arrangement-arc bump (only fires if no synthetic deltas above).
    if (ops.length === 0) {
      for (let i = 0; i < graph.song.sections.length; i++) {
        const sec = graph.song.sections[i]!;
        if (sec.function === 'drop' && sec.energy < 0.75) {
          ops.push({ op: 'replace', path: `/song/sections/${i}/energy`, value: 0.85 });
        }
        if (sec.function === 'intro' && sec.energy > 0.4) {
          ops.push({ op: 'replace', path: `/song/sections/${i}/energy`, value: 0.3 });
        }
      }
    }
    if (ops.length === 0) return undefined;
    return {
      patch_id: uuid(),
      iteration,
      agent: 'producer-arranger',
      intent: target.problem,
      ops,
      expected_audio_effect: { features: ['arrangement_arc'], sections: ['intro', 'drop', 'breakdown'] },
    };
  }

  // G3 path 5: per-orbit gain deltas. Resolves role → orbit from the actual
  // graph at plan time. The synthetic target's graph_paths are hints; the
  // truth is in intended_movement keys like `kick_orbit_gain_db` or
  // `hat_orbit_gain_db`, which name the role explicitly.
  if (target.graph_paths.some((p) => /^\/mix_graph\/orbits\/.+\/gain$/.test(p))) {
    const im = readMovement(target);
    const ops: Patch['ops'] = [];
    for (const [k, v] of Object.entries(im)) {
      const rm = /^([a-z]+)_orbit_gain_db$/.exec(k);
      if (!rm || typeof v !== 'number' || Math.abs(v) <= 0.01) continue;
      const role = rm[1]!;
      const layer = graph.layers.find((l) => l.role === role);
      if (!layer) continue;
      const o = String(layer.orbit);
      const cur = graph.mix_graph.orbits[o]?.gain ?? 1;
      const next = Math.max(0.05, Math.min(2.0, cur * Math.pow(10, v / 20)));
      ops.push({ op: 'replace', path: `/mix_graph/orbits/${o}/gain`, value: next });
    }
    if (ops.length > 0) {
      return {
        patch_id: uuid(), iteration, agent: target.agent || 'producer-mix-engineer',
        intent: target.problem,
        ops,
        expected_audio_effect: { features: ['rms', 'punch'], sections: [] },
      };
    }
  }

  // G3 path 6: sound_palette adjustments (chord HPF, hat HPF, chord gain).
  if (target.graph_paths.includes('/sound_palette/layers')) {
    const im = readMovement(target);
    const ops: Patch['ops'] = [];
    if (typeof im.chord_hpf_hz === 'number') {
      const chord = graph.layers.find((l) => l.role === 'chord');
      if (chord) {
        const dec = graph.sound_palette.layers[chord.id];
        if (dec) {
          const idx = dec.effects.findIndex((e) => e.type === 'hpf');
          if (idx >= 0) {
            const cur = (dec.effects[idx]!.params as { freq?: number }).freq ?? 0;
            ops.push({ op: 'replace', path: `/sound_palette/layers/${chord.id}/effects/${idx}/params/freq`, value: cur + im.chord_hpf_hz });
          }
        }
      }
    }
    if (typeof im.hat_hpf_hz === 'number') {
      const hat = graph.layers.find((l) => l.role === 'hat');
      if (hat) {
        const dec = graph.sound_palette.layers[hat.id];
        if (dec) {
          const idx = dec.effects.findIndex((e) => e.type === 'hpf');
          if (idx >= 0) {
            const cur = (dec.effects[idx]!.params as { freq?: number }).freq ?? 0;
            ops.push({ op: 'replace', path: `/sound_palette/layers/${hat.id}/effects/${idx}/params/freq`, value: cur + im.hat_hpf_hz });
          }
        }
      }
    }
    if (typeof im.chord_orbit_gain_db === 'number') {
      const chord = graph.layers.find((l) => l.role === 'chord');
      if (chord) {
        const o = String(chord.orbit);
        const cur = graph.mix_graph.orbits[o]?.gain ?? 1;
        const next = Math.max(0.05, Math.min(2.0, cur * Math.pow(10, im.chord_orbit_gain_db / 20)));
        ops.push({ op: 'replace', path: `/mix_graph/orbits/${o}/gain`, value: next });
      }
    }
    if (typeof im.hat_orbit_gain_db === 'number') {
      const hat = graph.layers.find((l) => l.role === 'hat');
      if (hat) {
        const o = String(hat.orbit);
        const cur = graph.mix_graph.orbits[o]?.gain ?? 1;
        const next = Math.max(0.05, Math.min(2.0, cur * Math.pow(10, im.hat_orbit_gain_db / 20)));
        ops.push({ op: 'replace', path: `/mix_graph/orbits/${o}/gain`, value: next });
      }
    }
    if (ops.length === 0) return undefined;
    // Sound-palette and mix-graph mutations might mix; prefer the most
    // accurate agent attribution. If any op hits /mix_graph route to mix-engineer.
    const agent = ops.some((o) => o.path.startsWith('/mix_graph')) ? 'producer-mix-engineer' : 'producer-sound-designer';
    return {
      patch_id: uuid(), iteration, agent,
      intent: target.problem,
      ops,
      expected_audio_effect: { features: ['centroid', 'band_rms'], sections: [] },
    };
  }

  // G3 path 7: bass orbit width narrowing for low-end stability.
  if (target.graph_paths.includes('/mix_graph/orbits') && /low-end|stable|稳/.test(target.problem)) {
    const ops: Patch['ops'] = [];
    for (const layer of graph.layers) {
      if (layer.role === 'bass' || layer.role === 'sub') {
        const o = String(layer.orbit);
        ops.push({ op: 'replace', path: `/mix_graph/orbits/${o}/width`, value: 0.4 });
      }
    }
    if (ops.length === 0) return undefined;
    return {
      patch_id: uuid(), iteration, agent: 'producer-mix-engineer',
      intent: target.problem,
      ops,
      expected_audio_effect: { features: ['mono_low_compliance'], sections: [] },
    };
  }

  // G3 path 8: pad/chord room_send increase ("more space without empty").
  if (target.graph_paths.includes('/mix_graph/orbits') && /space|spacious|空/.test(target.problem)) {
    const im = readMovement(target);
    const delta = typeof im.pad_room_send_delta === 'number' ? im.pad_room_send_delta : 0.1;
    const ops: Patch['ops'] = [];
    for (const layer of graph.layers) {
      if (layer.role === 'pad' || layer.role === 'chord') {
        const o = String(layer.orbit);
        const cur = graph.mix_graph.orbits[o]?.room_send ?? 0;
        const next = Math.min(0.55, cur + delta);
        if (next > cur) ops.push({ op: 'replace', path: `/mix_graph/orbits/${o}/room_send`, value: next });
      }
    }
    if (ops.length === 0) return undefined;
    return {
      patch_id: uuid(), iteration, agent: 'producer-mix-engineer',
      intent: target.problem,
      ops,
      expected_audio_effect: { features: ['stereo_width', 'reverb_tail'], sections: [] },
    };
  }

  // G3 path 9: pattern_bank density change (chopped drums, etc.)
  if (target.graph_paths.includes('/pattern_bank/patterns')) {
    const im = readMovement(target);
    if (typeof im.hat_density === 'number' && im.hat_density > 0) {
      const hat = graph.layers.find((l) => l.role === 'hat');
      if (hat) {
        const ops: Patch['ops'] = [];
        for (const sec of graph.song.sections.filter((s) => s.function === 'main' || s.function === 'drop')) {
          ops.push({
            op: 'replace',
            path: `/pattern_bank/patterns/${hat.id}/${sec.id}`,
            value: { mini_notation: 'hh*8' },
          });
        }
        if (ops.length > 0) {
          return {
            patch_id: uuid(), iteration, agent: 'producer-composer',
            intent: target.problem,
            ops,
            expected_audio_effect: { features: ['onset_density_high'], sections: ['main', 'drop'] },
          };
        }
      }
    }
  }

  return undefined;
}

/**
 * Synthetic targets created from user feedback carry their numeric instructions
 * in `intended_movement`. The schema-validated CritiqueTarget shape only has
 * `evidence`, and revise.ts merges intended_movement into evidence on the way
 * in. This helper reads numeric movement keys from either location so the
 * planner stays decoupled from the synthesis path.
 */
function readMovement(target: import('@cactus/ir').CritiqueTarget): Record<string, number> {
  const direct = (target as { intended_movement?: Record<string, unknown> }).intended_movement;
  const out: Record<string, number> = {};
  const sources: Array<Record<string, unknown> | undefined> = [direct, target.evidence as Record<string, unknown>];
  for (const src of sources) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'number' && !(k in out)) out[k] = v;
    }
  }
  return out;
}
