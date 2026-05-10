// Genre-aware arrangement coverage applier. Mutates a SessionGraph's
// layer_activation map so every section satisfies the role mandates declared
// in `getCoverageConstraints(genre)`. Honors brief constraints
// (no_kick / no_rhythmic_grid / no_four_on_floor).
//
// Lives alongside the data file so callers in agent-runtime / orchestrator can
// import directly without creating a dep cycle.

import type { SectionFunction, SessionGraph } from '@cactus/ir';
import { getCoverageConstraints } from './coverage-constraints.js';

export interface ArrangementCoverageReport {
  genre: string;
  mutations: Array<{
    section_id: string;
    section_function: SectionFunction;
    activated_layers: string[];
    deactivated_layers: string[];
    reasons: string[];
  }>;
}

export function applyArrangementCoverage(graph: SessionGraph): ArrangementCoverageReport {
  const slug = graph.brief.primary_genre ?? 'techno';
  const constraints = getCoverageConstraints(slug);
  const briefConstraints = (graph.brief.constraints ?? {}) as Record<string, unknown>;
  const report: ArrangementCoverageReport = { genre: slug, mutations: [] };

  const layersByRole = new Map<string, string[]>();
  for (const l of graph.layers) {
    const list = layersByRole.get(l.role) ?? [];
    list.push(l.id);
    layersByRole.set(l.role, list);
  }

  for (const sec of graph.song.sections) {
    const cov = constraints.per_function[sec.function as SectionFunction] ?? constraints.default;
    const sectionId = sec.id;
    const activated: string[] = [];
    const deactivated: string[] = [];
    const reasons: string[] = [];

    const effectivelyForbidden = new Set<string>(cov.forbidden);
    if (briefConstraints.no_kick) effectivelyForbidden.add('kick');
    if (briefConstraints.no_rhythmic_grid) {
      effectivelyForbidden.add('kick');
      effectivelyForbidden.add('snare');
      effectivelyForbidden.add('hat');
      effectivelyForbidden.add('clap');
      effectivelyForbidden.add('rim');
    }

    for (const role of cov.mandatory) {
      if (effectivelyForbidden.has(role)) continue;
      for (const id of layersByRole.get(role) ?? []) {
        if (!setActivation(graph, id, sectionId, true)) continue;
        activated.push(id);
        reasons.push(`coverage: ${slug}/${sec.function} requires role=${role}`);
      }
    }

    for (const role of effectivelyForbidden) {
      for (const id of layersByRole.get(role) ?? []) {
        if (!setActivation(graph, id, sectionId, false)) continue;
        deactivated.push(id);
        reasons.push(`coverage: ${slug}/${sec.function} forbids role=${role}`);
      }
    }

    if (sec.energy >= 0.6) {
      for (const role of cov.recommended) {
        if (effectivelyForbidden.has(role)) continue;
        for (const id of layersByRole.get(role) ?? []) {
          if (!setActivation(graph, id, sectionId, true)) continue;
          activated.push(id);
          reasons.push(`coverage: ${slug}/${sec.function} recommends role=${role} (energy ${sec.energy.toFixed(2)} ≥ 0.60)`);
        }
      }
    }

    if (activated.length > 0 || deactivated.length > 0) {
      report.mutations.push({
        section_id: sectionId,
        section_function: sec.function,
        activated_layers: activated,
        deactivated_layers: deactivated,
        reasons,
      });
    }
  }

  return report;
}

function setActivation(graph: SessionGraph, layerId: string, sectionId: string, value: boolean): boolean {
  const la = graph.song.layer_activation[layerId] ?? { sections: {} };
  graph.song.layer_activation[layerId] = la;
  const cur = la.sections[sectionId] ?? false;
  if (cur === value) return false;
  la.sections[sectionId] = value;
  return true;
}
