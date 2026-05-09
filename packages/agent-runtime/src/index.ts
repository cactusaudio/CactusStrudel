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
