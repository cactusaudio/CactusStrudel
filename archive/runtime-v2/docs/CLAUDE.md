# Cactus Strudel — Claude Code Rules

Read `docs/LIVE_VS_RESEARCH.md` first. The current live product is the Python
runtime + HTML studio (`runtime/serve.py`, `runtime/main.html`, `runtime/data.html`,
`runtime/settings.html`) backed by the producer-brain corpus. The TypeScript
closed-loop producer remains an important research/eval substrate, but its
SessionGraph/RenderGraph rules are not automatically live studio rules unless the
runtime route consumes that code.

Research substrate shape: Talk → BriefGraph → SongGraph IR → PatternBank/MixGraph →
deterministic Strudel compiler → headless render → MIR/audio analysis + spectrogram
critic → targeted revisions → master/stems + preference memory.

## Hard rules

- For live UX work, start from `runtime/serve.py` + `runtime/*.html` and prove the
  runtime endpoint/UI behavior. Corpus entries, piece JS, MP3/features, prompt metadata,
  revision logs, and kernel fragments are the live records.
- For research engine work, build the closed-loop producer, not a toy prompt-to-code app.
- In the research engine, canonical artifact is `SessionGraph` JSON. Strudel code is a
  compiler output there, never the research agent's primary artifact.
- All generated Strudel snippets must pass `packages/strudel-validator` before render.
- Research renders must produce feature JSON + spectrogram artifacts in `RenderGraph`.
- Research agents write only their assigned graph paths. See `docs/ir.md` § agent-write-boundaries.
- Every phase must have tests + acceptance artifacts before next phase claims completion.
- Prefer deterministic traditional code for validation, render orchestration, feature extraction, scoring. Use LLMs for musical judgment + generation only where symbolic rules are insufficient.
- Do not scrape or train on community-contributed Strudel patterns without permission. Any reference audio in `refs/` must be local only and `.gitignore`d.
- Document AGPL-sensitive renderer / analyzer boundaries. Whole repo is AGPL-3.0-or-later (see `LICENSE`).
- Critic outputs must cite measurable evidence (graph_paths + numeric features), not prose like "make it punchier".
- Do not claim live product improvement from research-only green tests, and do not claim
  research-engine improvement from UI-only behavior.

## Workspace layout

```
apps/
  cli/              — `cactus` command (produce | sketch | revise | stems | explain | taste | audit | audit:repair)
  renderer-page/    — self-hosted vite static page hosting @strudel/web
  studio-ui/        — read-only session inspector (Phase 12; minimal)
packages/
  ir/               — SessionGraph schemas, types, migrations, JSON Patch helpers, agent write-paths
  session-store/    — append-only iteration persistence
  strudel-validator/— mini-notation + JS-AST + registry checks (503-name auto-extracted)
  strudel-compiler/ — IR → Strudel code with source maps + arrange()/orbit/duck/solo
  renderer/         — Playwright + OfflineAudioContext driver for renderer-page
  analyzer/         — essentia.js + ITU-R BS.1770 LUFS + spectral + rhythmic + stereo +
                       section-features + section-diagnostics + stem-diagnostics + 11 quality gates
  critic/           — 9-axis scoring + revision targets + self-consistency
  cookbook/         — validated snippet loader
  genres/           — genre YAML + bridging + per-genre coverage constraints + applier
  agent-runtime/    — brief parser (English/Chinese/mixed) + buildSessionGraphFromBrief +
                       produce orchestrator + sketch/rank/closed-loop + revision-planner
  preference/       — taste memory + feedback parser + ScoreVector weights
  mastering/        — Phase 11 single-pass LUFS normalize + tanh soft-clip true-peak limiter +
                       stems-by-orbit
  mix/              — Phase 15 deterministic mix controller: gain-staging + band-balance +
                       master-normalize (with refusal heuristic) + peak-guard
  orchestrator/     — backend abstraction (rules / claude-shadow / hybrid) +
                       arrangement-coverage re-export
  revision/         — revision locality scorer (unrelated_change_ratio + invariant violations)
  audit/            — Phase 14 adversarial harness: prompt-suite loader + run-audit +
                       genre-confusion + genre-discriminators + failure-taxonomy +
                       champion-challenger + diagnostic-report
genres/             — genre YAML data files (techno / dub_techno / house / dnb / idm / ambient)
cookbook/           — JSONL snippet corpus per genre × role
sessions/           — runtime session directories (gitignored)
docs/               — architecture, IR, renderer, critic, ops, ADRs (0001-0005), audit findings
scripts/            — verify-repo.sh (G0 truth gate runner)
runtime/            — live Python server + HTML studio (current user-facing path)
producer-brain/     — live corpus, generated pieces, prompt kernel, checkpoints, research summaries
```

## Tooling

- pnpm workspace, TypeScript strict, vitest for tests, ESM throughout.
- Render: Playwright (chromium) + OfflineAudioContext where compatible, realtime capture fallback.
- Analyzer resamples to 44.1kHz before RhythmExtractor2013.
- Audio I/O via wavefile (read/write WAV); ffmpeg for spectrogram PNG + format conversion.

## Commands

| Command | What it does |
|---|---|
| `pnpm exec tsc -b` | Project-references TypeScript build. Must exit 0. |
| `pnpm test` | Unit suite (~250 tests; 6 E2E gated behind `CACTUS_RENDER_E2E=1`). |
| `pnpm build` | `pnpm -r build` across packages + apps. |
| `pnpm dev:renderer` | Local renderer-page at http://localhost:5173. |
| `pnpm cactus -- produce -b '...'` | Full single-pass produce (Phase 7). |
| `pnpm cactus -- sketch -b '...' -n 5` | N-candidate sketches at different seeds. |
| `pnpm cactus -- revise -s <id> -f '...'` | Apply NL feedback (records preference; full audio loop is G3 work). |
| `pnpm cactus -- audit --suite smoke --seeds 1` | Adversarial audit harness (Phase 14). |
| `pnpm cactus -- audit:repair` | Real-WAV smoke audit + diagnostics (Phase 15 default repair loop). |
| `scripts/verify-repo.sh` | G0 truth gate: install + tsc + tests + renderer E2E smoke + runtime helpers/endpoints + boundary doc + audit:repair. |

## ADRs

See `docs/adr/`. Material decisions get an ADR; routine choices do not.
