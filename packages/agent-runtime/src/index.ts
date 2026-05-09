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
export { buildSessionGraphFromBrief } from './build-graph.js';
export { produce, type ProduceOptions, type ProduceResult } from './produce.js';
export { createRng, hashStringToSeed } from './seed-rng.js';
