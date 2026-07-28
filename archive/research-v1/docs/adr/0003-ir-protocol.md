# ADR 0003 — IR: SessionGraph as canonical artifact

Date: 2026-05-10
Status: Accepted

## Context

Per dispatch §2.2: agents must not pass raw Strudel as primary artifact. We need a typed graph that captures intent, structure, sound design, mix, render, critique, preference history.

## Decision

`packages/ir` defines a single `SessionGraph` root with versioned subgraphs:

```
SessionGraph {
  schema_version: "1.0.0"
  session_id: uuid
  created_at: ISO8601
  brief: BriefGraph
  song: SongGraph
  layers: LayerGraph[]
  pattern_bank: PatternBank
  sound_palette: SoundPalette
  mix_graph: MixGraph
  render_graph: RenderGraph[]    # one per iteration
  critique_graph: CritiqueGraph[] # one per iteration
  preference_graph: PreferenceGraph
  iteration_log: Iteration[]      # append-only
}
```

- JSON Schema is canonical (`packages/ir/schema/`).
- Zod validators derived from schema.
- TypeScript types generated from schema via `json-schema-to-typescript` (Phase 1).
- Migrations in `packages/ir/migrations/<from>_<to>.ts`. `schema_version` field bumps on breaking change.
- Append-only iteration store: each `(session_id, iteration_n)` is a frozen JSON file. `session-store` package handles persistence.

## Agent write boundaries (enforced by validator + hook)

| Agent | May write |
|---|---|
| `producer-brief-interpreter` | `/brief/**` |
| `producer-reference-decomposer` | `/brief/references/**` |
| `producer-arranger` | `/song/**`, `/layers/*/role` |
| `producer-composer` | `/pattern_bank/**` |
| `producer-sound-designer` | `/sound_palette/**`, `/pattern_bank/*/sound_ref` |
| `producer-mix-engineer` | `/mix_graph/**` |
| `producer-critic` | `/critique_graph/**` (read-only on others) |
| `producer-revision-planner` | emits `Patch[]`; never writes graph directly |

A hook validates that any subagent-written graph file's diff stays inside its allowed paths.

## Patch contract

Per dispatch §7. RFC 6902 JSON Patch format extended with `intent`, `agent`, `expected_audio_effect`. Patches are first-class artifacts in `iteration_log`.

## Consequences

- Whole system is debuggable via graph inspection.
- Compiler is the only code-emitter; agents never hand-write Strudel.
- Critic targets revisions by graph path, not by code span.
- Migration discipline is mandatory before schema changes.
