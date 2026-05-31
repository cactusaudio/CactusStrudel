# Research Architecture (Historical)

This document describes the TypeScript closed-loop research substrate only.
It is not the live CactusStrudel product architecture. For current runtime
ownership, read `docs/LIVE_VS_RESEARCH.md` first. Live generation, catalog,
Advanced panel, brain chat, save/render, and corpus writes are owned by
`runtime/serve.py` + `runtime/*.html`.

## Closed loop

```
brief (text)
  └─► producer-brief-interpreter        → BriefGraph
        └─► producer-reference-decomposer → annotated /brief/references
              └─► producer-arranger      → SongGraph + LayerGraph[]
                    └─► producer-composer       → PatternBank
                          └─► producer-sound-designer → SoundPalette
                                └─► producer-mix-engineer  → MixGraph
                                      ↓
                              compileSessionGraph (deterministic)
                                      ↓
                              renderer (Playwright + @strudel/web)
                                      ↓
                              analyzer (essentia.js + LUFS + spectral)
                                      ↓
                              producer-critic → CritiqueGraph
                                      ↓
                              producer-revision-planner → Patch[]
                                      ↓
                              [apply patches, write iter_NNNN.json]
                                      ↺
```

## Layers

| Layer | Owner | Contract |
|---|---|---|
| **IR** (`packages/ir`) | build-ir-architect | zod schemas + types + JSON pointer + JSON Patch + agent write paths |
| **Persistence** (`packages/session-store`) | build-ir-architect | append-only iteration store |
| **Validator** (`packages/strudel-validator`) | build-ir-architect | mini-notation + JS AST + function whitelist |
| **Compiler** (`packages/strudel-compiler`) | build-renderer-engineer | deterministic SessionGraph → Strudel + source map |
| **Renderer page** (`apps/renderer-page`) | build-renderer-engineer | static page exposing `window.__cactusRender` |
| **Renderer driver** (`packages/renderer`) | build-renderer-engineer | Playwright + WAV write |
| **Analyzer** (`packages/analyzer`) | build-analyzer-engineer | essentia + LUFS + spectrogram |
| **Critic** (`packages/critic`) | build-analyzer-engineer | scoring vector + revision targets |
| **Cookbook** (`packages/cookbook`) | build-agent-system-engineer | seed snippets per genre/role |
| **Genres** (`packages/genres`) | build-agent-system-engineer | YAML + bridging |
| **Agent runtime** (`packages/agent-runtime`) | build-agent-system-engineer | orchestration |
| **Preference** (`packages/preference`) | build-agent-system-engineer | taste memory |
| **Mastering** (`packages/mastering`) | build-analyzer-engineer | LUFS norm + true-peak limit |
| **CLI** (`apps/cli`) | build-agent-system-engineer | `cactus *` |

## Data flow invariants

1. Agents never write Strudel. The compiler is the only emitter.
2. Patches validate agent write-boundaries before being applied.
3. Critic outputs cite numeric evidence + graph paths.
4. RenderArtifact metadata always carries package_versions and warnings.
5. PreferenceGraph decisions are append-only.
6. Schema bumps require migrations.

## Decision references

- ADR 0001 — License: AGPL-3.0-or-later.
- ADR 0002 — Renderer: self-hosted Vite + Playwright.
- ADR 0003 — IR: SessionGraph as canonical artifact.
- ADR 0004 — Stems via orbit-isolated re-renders.
