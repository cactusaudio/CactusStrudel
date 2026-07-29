# Documentation router

This directory contains only current v3 contracts plus dated review evidence.
`AGENTS.md` is the sole cross-agent operating contract. Dynamic facts come from
`bin/catch-up`; do not infer current state from an older prose snapshot.

## Reading paths

| Task | Read |
|---|---|
| first contact | `AGENTS.md` → `bin/catch-up` |
| UI | `apps/producer-ui/README.md`, target screen/store, focused UI tests |
| HTTP/API | `API.md`, `runtime/serve.py`, target `V3Application` method |
| truth/data | `architecture.md`, `runtime/v3/README.md` |
| Agent/CLIProxy/Brain | `SETTINGS.md`, `runtime/agent/README.md` |
| generation/kernel | `producer-brain/README.md`, target generation adapter |
| renderer/audio | `renderer.md`, `apps/render-worker/README.md` |
| operations/recovery | `operations.md`, then `bin/catch-up` |
| legacy/research | `LIVE_VS_RESEARCH.md`; open archive only for a named need |
| repo/build/docs | `development.md`, `package.json`, `scripts/check_docs.py`, `scripts/verify-repo.sh` |
| handoff | `HANDOFF.md`, `bin/handoff show` |

Machine-readable routing is in [`areas.json`](areas.json).

## Current documents

| Document | Authority |
|---|---|
| [`architecture.md`](architecture.md) | stable live ownership and data flow |
| [`development.md`](development.md) | change workflow and verification map |
| [`operations.md`](operations.md) | local start/readback/recovery |
| [`API.md`](API.md) | current `/api/v2` surface |
| [`SETTINGS.md`](SETTINGS.md) | Agent and generation settings contract |
| [`LIVE_VS_RESEARCH.md`](LIVE_VS_RESEARCH.md) | authority boundary |
| [`renderer.md`](renderer.md) | production render path |
| [`STATE.md`](STATE.md) | generated, time-anchored readback |
| [`HANDOFF.md`](HANDOFF.md) | handoff format and commands |
| [`reviews/ultrareview-2026-07-28.md`](reviews/ultrareview-2026-07-28.md) | dated non-security v3 Ultrareview and debt ledger |
| [`blueprint-platform-2026-07-29.md`](blueprint-platform-2026-07-29.md) | active platformization blueprint (Brain/robustness/MCP+CLI/fleet) |

Component-level documents stay beside their owners:

- [`apps/README.md`](../apps/README.md)
- [`packages/README.md`](../packages/README.md)
- [`runtime/README.md`](../runtime/README.md)
- [`apps/producer-ui/README.md`](../apps/producer-ui/README.md)
- [`apps/render-worker/README.md`](../apps/render-worker/README.md)
- [`runtime/v3/README.md`](../runtime/v3/README.md)
- [`runtime/agent/README.md`](../runtime/agent/README.md)
- [`producer-brain/README.md`](../producer-brain/README.md)
- [`bin/README.md`](../bin/README.md)

## Currency rules

- Stable contracts belong here; mutable counts belong only in generated
  `STATE.md`.
- A component move updates `areas.json`, its colocated README, and the relevant
  architecture row in the same change.
- Dated audits live in `docs/reviews/` and are evidence, not operating policy.
- Superseded implementations and their docs move under `archive/`; archived
  prose is never silently rewritten to look current.
- `python3 scripts/check_docs.py` checks the active map, local links, line
  budgets, generated-state marker, and stale control-path references.
