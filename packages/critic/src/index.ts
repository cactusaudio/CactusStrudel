import type { CritiqueEntry, RenderArtifact, SessionGraph } from '@cactus/ir';

export interface CritiqueInput {
  graph: SessionGraph;
  artifact: RenderArtifact;
}

export function critique(_input: CritiqueInput): CritiqueEntry {
  throw new Error('critic not implemented (Phase 5/8)');
}
