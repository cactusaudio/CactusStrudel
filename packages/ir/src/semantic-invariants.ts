// G5: semantic invariants over a SessionGraph. Zod gives us structural shape;
// these checks enforce cross-field constraints — section coverage, energy
// curve length matches total_bars, layer / orbit / sample references resolve,
// patch agents are known.
//
// Errors are blocking (callers should refuse to render / commit a graph that
// violates them). Warnings are informational — typically referenced sample
// names that aren't in the known registry, which often still works at render
// time but is worth flagging.

import { AGENT_WRITE_PATHS } from './agent-paths.js';
import type { SessionGraph } from './schema.js';

export type SemanticSeverity = 'error' | 'warning';

export interface SemanticIssue {
  severity: SemanticSeverity;
  category:
    | 'section_coverage'
    | 'section_overlap'
    | 'energy_curve_length'
    | 'layer_orbit_orphan'
    | 'orbit_layer_orphan'
    | 'activation_layer_ref'
    | 'activation_section_ref'
    | 'patch_agent_unknown'
    | 'sample_name_unknown'
    | 'pattern_layer_ref'
    | 'sound_palette_layer_ref'
    | 'sidechain_layer_ref';
  path: string;
  message: string;
}

export interface SemanticInvariantsOptions {
  /**
   * Optional list of sample names known to the renderer. Sample-source
   * decorations whose `name` isn't in this list become warnings, not errors —
   * the renderer may still resolve them via dirt-samples or another loader.
   * Pass `undefined` (default) to skip sample-name validation entirely.
   */
  knownSampleNames?: ReadonlyArray<string>;
  /**
   * Synth source `name`s are not validated against knownSampleNames; this
   * lets the caller declare additional names that should be considered known
   * regardless of source kind (e.g. user-loaded samples).
   */
  extraKnownNames?: ReadonlyArray<string>;
}

export interface SemanticReport {
  ok: boolean;
  errors: SemanticIssue[];
  warnings: SemanticIssue[];
}

export function validateSemanticInvariants(
  graph: SessionGraph,
  opts: SemanticInvariantsOptions = {},
): SemanticReport {
  const errors: SemanticIssue[] = [];
  const warnings: SemanticIssue[] = [];

  // 1. Section coverage: union of section [start_bar, end_bar) must equal
  //    [0, total_bars] with no gaps or overlaps.
  const sortedSections = [...graph.song.sections].sort((a, b) => a.start_bar - b.start_bar);
  let cursor = 0;
  for (let i = 0; i < sortedSections.length; i++) {
    const s = sortedSections[i]!;
    if (s.start_bar !== cursor) {
      const issue: SemanticIssue = {
        severity: 'error',
        category: s.start_bar > cursor ? 'section_coverage' : 'section_overlap',
        path: `/song/sections/${graph.song.sections.indexOf(s)}/start_bar`,
        message:
          s.start_bar > cursor
            ? `gap of ${s.start_bar - cursor} bars between bar ${cursor} and section "${s.name}" starting at ${s.start_bar}`
            : `section "${s.name}" starts at ${s.start_bar} but previous section ended at ${cursor} (overlap of ${cursor - s.start_bar} bars)`,
      };
      errors.push(issue);
    }
    cursor = Math.max(cursor, s.end_bar);
  }
  if (cursor !== graph.song.total_bars) {
    errors.push({
      severity: 'error',
      category: 'section_coverage',
      path: '/song/total_bars',
      message: `sections cover ${cursor} bars but song.total_bars=${graph.song.total_bars} — ${graph.song.total_bars - cursor} bars uncovered`,
    });
  }

  // 2. Energy curve length: one value per bar.
  if (graph.song.energy_curve.length !== graph.song.total_bars) {
    errors.push({
      severity: 'error',
      category: 'energy_curve_length',
      path: '/song/energy_curve',
      message: `energy_curve has ${graph.song.energy_curve.length} entries but total_bars=${graph.song.total_bars}`,
    });
  }

  // 3. Layer / orbit cross-refs.
  const layerIds = new Set(graph.layers.map((l) => l.id));
  const layerOrbits = new Set(graph.layers.map((l) => String(l.orbit)));
  const mixOrbitKeys = Object.keys(graph.mix_graph.orbits);
  for (const o of mixOrbitKeys) {
    if (!layerOrbits.has(o)) {
      warnings.push({
        severity: 'warning',
        category: 'orbit_layer_orphan',
        path: `/mix_graph/orbits/${o}`,
        message: `mix_graph orbit "${o}" has no layer assigned to it`,
      });
    }
  }
  for (const l of graph.layers) {
    if (!mixOrbitKeys.includes(String(l.orbit))) {
      errors.push({
        severity: 'error',
        category: 'layer_orbit_orphan',
        path: `/layers/${graph.layers.indexOf(l)}/orbit`,
        message: `layer "${l.id}" (role=${l.role}) is on orbit ${l.orbit} but mix_graph has no orbit configuration for it`,
      });
    }
  }

  // 4. Layer activation refs.
  const sectionIds = new Set(graph.song.sections.map((s) => s.id));
  for (const [layerId, activation] of Object.entries(graph.song.layer_activation)) {
    if (!layerIds.has(layerId)) {
      errors.push({
        severity: 'error',
        category: 'activation_layer_ref',
        path: `/song/layer_activation/${layerId}`,
        message: `layer_activation references unknown layer "${layerId}"`,
      });
    }
    for (const secId of Object.keys(activation.sections)) {
      if (!sectionIds.has(secId)) {
        errors.push({
          severity: 'error',
          category: 'activation_section_ref',
          path: `/song/layer_activation/${layerId}/sections/${secId}`,
          message: `layer_activation for "${layerId}" references unknown section id "${secId}"`,
        });
      }
    }
  }

  // 5. Pattern bank layer refs.
  for (const layerId of Object.keys(graph.pattern_bank.patterns)) {
    if (!layerIds.has(layerId)) {
      errors.push({
        severity: 'error',
        category: 'pattern_layer_ref',
        path: `/pattern_bank/patterns/${layerId}`,
        message: `pattern_bank references unknown layer "${layerId}"`,
      });
    }
  }

  // 6. Sound palette layer refs.
  for (const layerId of Object.keys(graph.sound_palette.layers)) {
    if (!layerIds.has(layerId)) {
      errors.push({
        severity: 'error',
        category: 'sound_palette_layer_ref',
        path: `/sound_palette/layers/${layerId}`,
        message: `sound_palette references unknown layer "${layerId}"`,
      });
    }
  }

  // 7. Sidechain edges layer refs.
  for (let i = 0; i < graph.mix_graph.sidechain.length; i++) {
    const sc = graph.mix_graph.sidechain[i]!;
    if (!layerIds.has(sc.layer)) {
      errors.push({
        severity: 'error',
        category: 'sidechain_layer_ref',
        path: `/mix_graph/sidechain/${i}/layer`,
        message: `sidechain edge target layer "${sc.layer}" does not exist`,
      });
    }
    if (!layerIds.has(sc.source)) {
      errors.push({
        severity: 'error',
        category: 'sidechain_layer_ref',
        path: `/mix_graph/sidechain/${i}/source`,
        message: `sidechain edge source layer "${sc.source}" does not exist`,
      });
    }
  }

  // 8. Patch agent enum: every iteration_log patch must use a known agent.
  const knownAgents = new Set(Object.keys(AGENT_WRITE_PATHS));
  for (let i = 0; i < graph.iteration_log.length; i++) {
    const it = graph.iteration_log[i]!;
    for (let j = 0; j < it.patches.length; j++) {
      const p = it.patches[j]!;
      if (!knownAgents.has(p.agent)) {
        errors.push({
          severity: 'error',
          category: 'patch_agent_unknown',
          path: `/iteration_log/${i}/patches/${j}/agent`,
          message: `iteration_log[${i}].patches[${j}] uses unknown agent "${p.agent}" — must be one of: ${Array.from(knownAgents).join(', ')}`,
        });
      }
    }
  }

  // 9. Sample-name registry check (warning-only).
  if (opts.knownSampleNames !== undefined) {
    const known = new Set([...opts.knownSampleNames, ...(opts.extraKnownNames ?? [])]);
    for (const [layerId, dec] of Object.entries(graph.sound_palette.layers)) {
      if (dec.source.kind !== 'sample') continue;
      const name = dec.source.name;
      // Strip trailing index like ":3" used by Strudel.
      const baseName = name.split(':')[0]!;
      if (!known.has(baseName)) {
        warnings.push({
          severity: 'warning',
          category: 'sample_name_unknown',
          path: `/sound_palette/layers/${layerId}/source/name`,
          message: `sample name "${name}" not in known registry — render may fail or fall back`,
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function formatSemanticReport(report: SemanticReport): string {
  const lines: string[] = [];
  lines.push(`semantic invariants: ${report.ok ? 'OK' : 'FAIL'} — ${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
  for (const e of report.errors) lines.push(`  [error/${e.category}] ${e.path}: ${e.message}`);
  for (const w of report.warnings) lines.push(`  [warn/${w.category}] ${w.path}: ${w.message}`);
  return lines.join('\n');
}
