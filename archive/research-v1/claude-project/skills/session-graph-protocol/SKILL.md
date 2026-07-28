---
description: SessionGraph IR protocol — graph paths, agent write boundaries, JSON Patch contract. Load when writing, validating, or applying patches against a SessionGraph. The graph is the protocol; raw Strudel is a compiler output.
---

# SessionGraph protocol

## Top-level shape

```
SessionGraph
├── schema_version: "1.0.0"
├── session_id: uuid
├── created_at: ISO8601
├── brief: BriefGraph
├── song: SongGraph
├── layers: LayerGraph[]
├── pattern_bank: PatternBank
├── sound_palette: SoundPalette
├── mix_graph: MixGraph
├── render_graph: RenderArtifact[]    ← one entry per iteration
├── critique_graph: CritiqueEntry[]   ← one entry per iteration
├── preference_graph: PreferenceGraph
└── iteration_log: Iteration[]        ← append-only
```

## Agent write boundaries

| Agent | Allowed paths |
|---|---|
| `producer-brief-interpreter` | `/brief/*` |
| `producer-reference-decomposer` | `/brief/references/*`, `/brief/modifiers/-` |
| `producer-arranger` | `/song/*`, `/layers/*` |
| `producer-composer` | `/pattern_bank/*` |
| `producer-sound-designer` | `/sound_palette/*` |
| `producer-mix-engineer` | `/mix_graph/*` |
| `producer-critic` | `/critique_graph/*` |
| `producer-revision-planner` | (emits `Patch[]` only; never writes directly) |

The runtime hook validates that each `Patch.agent + Patch.ops[].path` matches the table.

## Patch contract

```json
{
  "patch_id": "uuid",
  "iteration": 2,
  "agent": "producer-sound-designer",
  "intent": "increase chord depth without muddying lows",
  "ops": [
    {"op": "replace", "path": "/sound_palette/layers/chord_stab/effects/0/params/cutoff", "value": 900},
    {"op": "add", "path": "/mix_graph/sidechain/-", "value": {"layer": "chord_stab", "source": "kick", "depth": 0.32, "attack_ms": 8, "release_ms": 180}}
  ],
  "expected_audio_effect": {
    "features": ["reduced 200-500Hz buildup", "clearer kick transient"],
    "sections": ["drop_a"]
  }
}
```

JSON Patch ops follow RFC 6902 (`add`, `remove`, `replace`, `move`, `copy`, `test`). `path` is JSON Pointer.

## Determinism rule

The compiler is deterministic: same `SessionGraph` → same Strudel code, byte-for-byte. Agents inject randomness only via the brief's `constraints.seed` field (if present) — never inside the compiler.

## Append-only iterations

Each iteration writes a new `iter_NNNN.json` to `sessions/<session_id>/`. The previous file is never overwritten. `SessionStore.appendIteration` enforces this.

## Files

- `agent-write-boundaries.md` — full enforcement details + counter-examples.
- `patch-examples.md` — common Patch shapes per agent.
- `migration-policy.md` — schema_version bump + migration script policy.
