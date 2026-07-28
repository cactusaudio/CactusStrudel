// Re-export for spec compliance. The actual applier lives in @cactus/genres
// alongside the per-genre coverage data, which avoids a dep cycle:
// agent-runtime → genres (data + applier) → ir, while orchestrator → genres.

export {
  applyArrangementCoverage,
  type ArrangementCoverageReport,
} from '@cactus/genres';
