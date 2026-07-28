import { buildSessionGraphFromBrief } from '../build-graph.js';
import type { BriefGraph, SessionGraph } from '@cactus/ir';

export interface SketchOptions {
  count?: number;
  seedBase?: number;
}

export async function createSketches(
  brief: BriefGraph,
  options: SketchOptions = {},
): Promise<SessionGraph[]> {
  const count = Math.max(1, options.count ?? 5);
  const seedBase = options.seedBase ?? 1;
  const graphs: SessionGraph[] = [];
  for (let i = 0; i < count; i++) {
    const seed = (seedBase + i * 1000003) >>> 0;
    graphs.push(await buildSessionGraphFromBrief(brief, { seed }));
  }
  return graphs;
}
