# Cactus Strudel — Claude Code Rules

Closed-loop autonomous Strudel-centered music producer. Talk → BriefGraph → SongGraph IR → PatternBank/MixGraph → deterministic Strudel compiler → headless render → MIR/audio analysis + spectrogram critic → targeted revisions → master/stems + preference memory.

## Hard rules

- Build the closed-loop producer, not a toy prompt-to-code app.
- Canonical artifact is `SessionGraph` JSON. Strudel code is a compiler output, never an agent's primary artifact.
- All generated Strudel snippets must pass `packages/strudel-validator` before render.
- All rendered outputs must produce feature JSON + spectrogram artifacts in `RenderGraph`.
- Agents write only their assigned graph paths. See `docs/ir.md` § agent-write-boundaries.
- Every phase must have tests + acceptance artifacts before next phase claims completion.
- Prefer deterministic traditional code for validation, render orchestration, feature extraction, scoring. Use LLMs for musical judgment + generation only where symbolic rules are insufficient.
- Do not scrape or train on community-contributed Strudel patterns without permission. Any reference audio in `refs/` must be local only and `.gitignore`d.
- Document AGPL-sensitive renderer / analyzer boundaries. Whole repo is AGPL-3.0-or-later (see `LICENSE`).
- Critic outputs must cite measurable evidence (graph_paths + numeric features), not prose like "make it punchier".

## Workspace layout

```
apps/
  cli/              — `cactus` command (sketch | produce | revise | stems | explain | live | taste)
  renderer-page/    — self-hosted vite static page hosting @strudel/web
packages/
  ir/               — SessionGraph schemas, types, migrations
  session-store/    — append-only iteration persistence
  strudel-validator/— mini-notation + JS-AST + registry checks
  strudel-compiler/ — IR → Strudel code with source maps
  renderer/         — Playwright driver for renderer-page
  analyzer/         — essentia.js + LUFS + spectral + rhythmic + spectrogram
  critic/           — scoring vector + rubric eval + revision targets
  cookbook/         — validated snippets (JSONL)
  genres/           — genre YAML + bridging logic
  agent-runtime/    — orchestration contracts
  preference/       — taste memory + ranking
  mastering/        — loudness norm + true-peak limit + stem post
genres/             — genre YAML data files
cookbook/           — JSONL snippet corpus
sessions/           — runtime session directories
docs/               — architecture, IR, renderer, critic, ops, ADRs, research
```

## Tooling

- pnpm workspace, TypeScript strict, vitest for tests, ESM throughout.
- Render: Playwright (chromium) + OfflineAudioContext where compatible, realtime capture fallback.
- Analyzer resamples to 44.1kHz before RhythmExtractor2013.
- Audio I/O via wavefile (read/write WAV); ffmpeg for spectrogram PNG + format conversion.

## Commands

- `pnpm test` — run all package tests.
- `pnpm build` — TypeScript build all packages.
- `pnpm dev:renderer` — local renderer-page on http://localhost:5173.
- `pnpm cactus -- sketch --brief "..."` — multi-candidate sketch mode (Phase 9+).
- `pnpm cactus -- produce --brief "..."` — full track (Phase 7+).

## ADRs

See `docs/adr/`. Material decisions get an ADR; routine choices do not.
