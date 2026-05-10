import type { Patch, SessionGraph } from '@cactus/ir';

export interface AgentInput {
  graph: SessionGraph;
  prompt?: string;
}

export interface AgentResult {
  patches: Patch[];
  notes?: string;
}

export interface ProducerAgent {
  readonly name: string;
  run(input: AgentInput): Promise<AgentResult>;
}

export const REGISTRY: Map<string, ProducerAgent> = new Map();

export { parseBrief } from './brief-parser.js';
export { buildSessionGraphFromBrief, type BuildGraphOptions } from './build-graph.js';
export { produce, type ProduceOptions, type ProduceResult } from './produce.js';
export {
  selectPrior, getCookbookMode, mapIrRoleToCookbookRole,
  energyToBand, loadCookbookOnce, _resetCookbookCacheForTests,
  type CookbookMode, type CookbookTrace, type CookbookTracePick,
  type SelectPriorInput, type SelectPriorResult,
} from './cookbook-prior.js';
export { createRng, hashStringToSeed } from './seed-rng.js';
export {
  planRevisions,
  createSketches,
  rankCandidates,
  closedLoopRevise,
  type SketchOptions,
  type RankedCandidate,
  type LoopInput,
  type LoopResult,
} from './agents/index.js';
