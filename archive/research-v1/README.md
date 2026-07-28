# Research v1 archive

Archived on 2026-07-28 when the live product was narrowed to the v3 producer
workspace.

This tree preserves:

- SessionGraph IR/compiler/orchestrator/critic/cookbook research packages;
- the old multi-agent producer/build swarm and Claude hooks;
- the generic CLI and Studio Inspector;
- unused icon-rendering source and old launcher icon derivatives;
- research fixtures, reports, genre/reference data and prototype outputs.

None of it is in `pnpm-workspace.yaml`, active docs routing, Claude automatic
discovery, runtime imports or the production verification gate.

Historical source remains readable. Generated `dist/`, node_modules symlinks,
tsbuildinfo and Python caches are intentionally excluded from the archive.

Archive moves are byte-identical by default. The exceptions under this tree
are explicit annotations, not byte-identical copies. See
[`../transformations.json`](../transformations.json) for the original/new paths,
full Git blob OIDs, classification, and reason for each exception.
