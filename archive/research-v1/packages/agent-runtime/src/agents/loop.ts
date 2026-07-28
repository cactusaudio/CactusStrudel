import { applyPatch, type CritiqueEntry, type Patch, type SessionGraph } from '@cactus/ir';
import { isAgentAllowedToWrite } from '@cactus/ir';
import { critique } from '@cactus/critic';
import { planRevisions } from './revision-planner.js';

export interface LoopInput {
  /** Initial graph (compiled, rendered, analyzed). */
  graph: SessionGraph;
  /** Function that renders + analyzes a graph and returns the latest CritiqueEntry. */
  evaluateGraph: (graph: SessionGraph) => Promise<CritiqueEntry>;
  /** Max revision iterations (post-initial). */
  maxIterations?: number;
  /** Stop when no target severity ≥ threshold. */
  severityFloor?: number;
  /** Cap on patches per revision. */
  maxPatchesPerIter?: number;
}

export interface LoopResult {
  graph: SessionGraph;
  iterations: Array<{
    iteration: number;
    critique: CritiqueEntry;
    patches: Patch[];
    appliedOps: number;
    reason?: string;
  }>;
  stoppedReason: 'converged' | 'max_iterations' | 'plateau' | 'no_patches';
}

export async function closedLoopRevise(input: LoopInput): Promise<LoopResult> {
  const maxIter = input.maxIterations ?? 4;
  const sevFloor = input.severityFloor ?? 0.4;
  const maxPatches = input.maxPatchesPerIter ?? 5;

  let graph = input.graph;
  const log: LoopResult['iterations'] = [];
  let prevWeightedSum = -Infinity;

  for (let iter = 1; iter <= maxIter; iter++) {
    const c = await input.evaluateGraph(graph);
    log.push({ iteration: iter - 1, critique: c, patches: [], appliedOps: 0 });

    const maxSeverity = c.targets.reduce((m, t) => Math.max(m, t.severity), 0);
    if (c.targets.length === 0 || maxSeverity < sevFloor) {
      return { graph, iterations: log, stoppedReason: 'converged' };
    }

    const patches = planRevisions({ graph, critique: c, maxPatches });
    if (patches.length === 0) {
      return { graph, iterations: log, stoppedReason: 'no_patches' };
    }
    log[log.length - 1]!.patches = patches;

    // Apply each patch with agent-write-boundary validation.
    let opsApplied = 0;
    for (const p of patches) {
      const ok = p.ops.every((op) => isAgentAllowedToWrite(p.agent, op.path));
      if (!ok) {
        // Patch crosses agent boundary; skip.
        continue;
      }
      try {
        graph = applyPatch(graph, p.ops);
        opsApplied += p.ops.length;
      } catch {
        // Skip un-applyable patch (e.g., path not found).
      }
    }
    log[log.length - 1]!.appliedOps = opsApplied;

    // Plateau detection: weighted score didn't improve from previous iteration.
    const weighted = weightedSumScores(c);
    if (iter > 1 && weighted - prevWeightedSum < 0.02) {
      return { graph, iterations: log, stoppedReason: 'plateau' };
    }
    prevWeightedSum = weighted;
  }

  return { graph, iterations: log, stoppedReason: 'max_iterations' };
}

function weightedSumScores(c: CritiqueEntry): number {
  const s = c.scores;
  return Object.values(s).reduce((a, b) => a + b, 0) / Object.keys(s).length;
}
