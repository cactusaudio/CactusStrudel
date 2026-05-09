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
    for (let i = 0; i < graph.song.sections.length; i++) {
      const sec = graph.song.sections[i]!;
      if (sec.function === 'drop' && sec.energy < 0.75) {
        ops.push({ op: 'replace', path: `/song/sections/${i}/energy`, value: 0.85 });
      }
      if (sec.function === 'intro' && sec.energy > 0.4) {
        ops.push({ op: 'replace', path: `/song/sections/${i}/energy`, value: 0.3 });
      }
    }
    if (ops.length === 0) return undefined;
    return {
      patch_id: uuid(),
      iteration,
      agent: 'producer-arranger',
      intent: target.problem,
      ops,
      expected_audio_effect: { features: ['arrangement_arc'], sections: ['intro', 'drop'] },
    };
  }

  return undefined;
}
