# IR — SessionGraph

The canonical artifact. Everything the producer system does is a transformation on this graph.

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
├── render_graph: RenderArtifact[]    (one per iteration)
├── critique_graph: CritiqueEntry[]   (one per iteration)
├── preference_graph: PreferenceGraph
└── iteration_log: Iteration[]        (append-only)
```

## Subgraph contracts

- `BriefGraph` — user intent, references, BPM/key/mood/energy/duration.
- `SongGraph` — sections, energy_curve, layer_activation map.
- `LayerGraph` — id + role + orbit.
- `PatternBank` — `{ layer_id: { section_id: PatternEntry } }`. Mini-notation strings only; raw Strudel allowed for escapes.
- `SoundPalette` — per-layer source (sample/synth/soundfont/csound) + effect chain + envelope + macros.
- `MixGraph` — orbit gain/pan/width/sends, master LUFS target + true-peak ceiling, sidechain edges, bus sends.
- `RenderArtifact` — wav path, stems, spectrograms, AnalyzerFeatures, package versions.
- `CritiqueEntry` — ScoreVector + CritiqueTarget[].
- `PreferenceGraph` — append-only PreferenceDecision[], current weights, motif/sound/arrangement likes.
- `Iteration` — kind (sketch/expand/revise/master/stems/recover) + agent + parent_iteration + patches.

## Agent write boundaries

| Agent | Allowed paths |
|---|---|
| producer-brief-interpreter | /brief/ |
| producer-reference-decomposer | /brief/references/, /brief/modifiers/ |
| producer-arranger | /song/, /layers/ |
| producer-composer | /pattern_bank/ |
| producer-sound-designer | /sound_palette/ |
| producer-mix-engineer | /mix_graph/ |
| producer-critic | /critique_graph/ |
| producer-revision-planner | (emits Patch[] only — never writes graph directly) |

Source of truth: `packages/ir/src/agent-paths.ts` + `isAgentAllowedToWrite`.

## Patch contract

JSON Patch (RFC 6902) with extra metadata:

```json
{
  "patch_id": "uuid",
  "iteration": 2,
  "agent": "producer-mix-engineer",
  "intent": "increase chord depth without muddying lows",
  "ops": [{"op": "replace", "path": "/mix_graph/orbits/3/room_send", "value": 0.55}],
  "expected_audio_effect": { "features": ["..."], "sections": ["drop_a"] }
}
```

`closedLoopRevise` enforces:
- `Patch.agent` matches one of the canonical 7 agent names.
- Every `Patch.ops[].path` falls within the agent's write boundary.
- Failed boundary checks → patch silently skipped (no graph corruption).

## Determinism

- Compiler: SessionGraph → Strudel code is byte-equal across runs.
- Build path: same brief + same seed → byte-equal pattern_bank (section IDs derived from rng).
- Renderer: same Strudel code + same chromium build → byte-equal WAV (within 1ms of jitter).

## Migrations

- `packages/ir/migrations/index.ts` exports `MIGRATIONS: Migration[]`.
- Each entry: `{ from, to, apply }`.
- `migrateToCurrent(input)` walks chain to current SCHEMA_VERSION.
- Schema bump rule: any breaking change → bump `SCHEMA_VERSION` + add migration.
