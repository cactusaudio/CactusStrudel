# ADR 0004 — Stem export via orbit-isolated re-renders

Date: 2026-05-10
Status: Accepted

## Context

Strudel routes layers through "orbits" (numeric channels in superdough). Native multi-channel split is not exposed by `@strudel/web`. We need stem export per layer/orbit for Phase 11.

## Decision

Stem export = N renders, one per orbit, with all-but-one orbit muted via the IR layer-activation flag. The compiler accepts a `solo` option that emits `.mute(true)` calls on every layer except the soloed orbit.

Pros:
- Works with current Strudel API; no upstream PR needed.
- Uses the same render path as full-mix → consistent timing/levels.
- Sample-aligned because compiler is deterministic.

Cons:
- N× render cost. For ~5 orbits and ~3 minute tracks, ~15 minutes wall clock at realtime fallback. Acceptable.
- Sidechain ducking signal must be preserved on solo renders → compiler keeps `duck_source` layer audible but routed to a silent orbit when soloing the targeted orbit. (Detailed in `packages/strudel-compiler/src/orbit-solo.ts`.)

## Consequences

- Stem renders are first-class `RenderArtifact` entries in `RenderGraph`.
- Filenames: `<session_id>/iter_<n>/stems/<orbit_id>__<layer_role>.wav`.
- A "stems-only" render mode bypasses the master-mix render but keeps mastering chain consistent (Phase 11).
