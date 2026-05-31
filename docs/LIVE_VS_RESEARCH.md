# Live vs Research Boundary

Current source of truth as of 2026-05-31: CactusStrudel has two valid but
different execution surfaces. Do not collapse them.

## Live product path

The live user-facing studio is the Python runtime plus HTML workbench:

- `runtime/serve.py` owns HTTP routing, backend dispatch, settings, AGY/CLIProxy/direct
  generation, render orchestration, scoring, corpus writes, source-offer, and brain chat.
- `runtime/main.html`, `runtime/data.html`, and `runtime/settings.html` are the active UI.
- `producer-brain/corpus.jsonl`, `producer-brain/pieces/*.js`, rendered audio,
  feature sidecars, prompt metadata, revision logs, and kernel fragments are the live
  product records.
- `apps/cli/src/auto-render.ts`, `apps/cli/src/validate-strudel.ts`, and
  `apps/cli/src/midi-export.ts` are live bridge utilities called by the Python runtime.

If the task changes user-facing generation, the Advanced panel, the DAW editor,
brain chat, catalog, backend settings, source offer, scoring, or save/render flows,
start in `runtime/serve.py` and `runtime/*.html`, then verify runtime endpoints or UI
behavior plus `scripts/verify-repo.sh`.

## Research substrate path

The TypeScript closed-loop producer is still useful research/eval substrate:

- `packages/*`, `apps/cli/src/index.ts`, `genres/`, and `cookbook/` implement the
  SessionGraph/SongGraph-style producer, deterministic compiler, validator, renderer,
  analyzer, critic, preferences, audit harness, and repair loop.
- `references/*.yaml` is a legacy research calibration stack. It is not shipped in the
  deployment bundle and is not a live studio dependency. Its remaining valid role is
  regression evidence: `packages/genres/src/index.test.ts` cross-checks production
  `genres/*.yaml` against the reference descriptors for LUFS, true-peak, and BPM drift.
- `pnpm cactus -- produce`, `sketch`, `revise`, `stems`, `explain`, `taste`, `audit`,
  `audit:repair`, and cookbook commands exercise this research engine.
- `SessionGraph` remains canonical only inside the TypeScript research engine.
  Strudel code can be compiler output there, but that is not the live studio's global
  data contract.
- `RenderGraph` feature/spectrogram rules describe research-engine invariants. The live
  studio records rendered MP3s/features/prompts/corpus entries through `runtime/serve.py`.

If the task changes deterministic producer behavior, package-level validation, MIR
analysis, critic scoring, genre constraints, cookbook snippets, audit repair, or
research CLI output, start in `packages/`, `apps/cli/src/index.ts`, `genres/`, or
`cookbook/`, then verify package tests, targeted audits, and `scripts/verify-repo.sh`.

## Boundary rules

- Do not claim live product improvement from research-only green tests unless the live
  runtime route actually consumes the changed code.
- Do not claim research-engine improvement from UI-only behavior.
- Keep bridge utilities explicit. `auto-render.ts`, `validate-strudel.ts`, and
  `midi-export.ts` may serve both worlds, so changes there need both targeted utility
  checks and runtime awareness.
- Keep packaging/source-offer paths sanitized for live users. Include source and docs;
  exclude local state such as runtime uploads, cc-bridge, checkpoints, audio archives,
  research sessions, audits, refs, `references/`, secrets, and dependency caches.
- Older docs such as `docs/architecture.md`, `docs/ir.md`, ADR 0003, and parts of
  `CLAUDE.md` describe the research substrate unless they explicitly reference the
  current runtime.

When in doubt, ask: "Which executable path proves this?" For live UX, the proof is
`runtime/serve.py` plus the browser/runtime endpoint. For research substrate, the proof
is the TypeScript package/CLI harness and audit artifacts.

## Stack Ownership Matrix

| Surface | Live product? | Owner files | Proof required |
|---|---:|---|---|
| Workbench / Advanced panel / DAW editor | yes | `runtime/main.html`, `runtime/serve.py` | browser/runtime endpoint behavior |
| Catalog / Data page | yes | `runtime/data.html`, `producer-brain/corpus.jsonl` | corpus entry + UI/API behavior |
| Brain chat tool-use | yes | `runtime/serve.py`, `runtime/cc-bridge/*` | `/api/brain-chat` trace and resulting corpus/revision state |
| Save + Render / overwrite piece | yes | `runtime/serve.py`, `producer-brain/pieces`, `producer-brain/revisions.jsonl` | backup + render + manifest/revision update |
| Render / MIDI bridge utilities | shared | `apps/cli/src/auto-render.ts`, `apps/cli/src/validate-strudel.ts`, `apps/cli/src/midi-export.ts`, `packages/renderer` | utility tests plus live endpoint awareness |
| TypeScript SessionGraph producer | no, research | `packages/*`, `apps/cli/src/index.ts`, `genres/`, `cookbook/` | package tests, CLI audit, real-WAV conformance |
| Studio UI session inspector | no, research/read-only | `apps/studio-ui/*` | loader/screenshot tests only; not live UX proof |
| Legacy reference descriptors | no, research calibration | `references/*.yaml` | genre/reference alignment tests; excluded from bundle |
| Older architecture docs | no, research/historical | `docs/architecture.md`, `docs/ir.md`, ADR 0003 | must carry research-only banner |

## Retired Zombie Claims

These statements are no longer allowed as unqualified current-product claims:

- "SessionGraph is the canonical artifact" — true only inside the TypeScript
  research engine.
- "Agents never write Strudel" — true only for the research compiler path. The
  live studio stores and edits Strudel piece JS directly.
- "Renderer artifacts in RenderGraph prove live product quality" — false unless
  the live runtime route consumed that render and updated corpus state.
- "Studio UI is the product studio" — false. It is a read-only research session
  inspector; the live product UI is `runtime/main.html` / `runtime/data.html`.
