# Platformization blueprint — 2026-07-29

Goal (Bowei, three-round calibration): make CactusStrudel a **distributable
AI-native music production tool for the machine fleet**, used to score games
and media fast. Priorities: Brain productization, GUI usability, robustness
and self-healing, a complete MCP interface, full CLI coverage, and migration
capability. Music-model tuning is frozen; AI music self-evaluation stays
minimal. Cost is open; per-phase commits; Sol review on public seams.

Non-goals for this arc: prompt-kernel work, model matrices, aesthetic-score
apparatus, new generation profiles beyond the existing five.

## Baseline facts (2026-07-29)

- Runtime: v3 single-owner server (`launchd com.cactus.strudel`, epoch 6),
  52 pieces, Agent Applied (claude-opus-5), generation default opus-producer,
  Brain smoke passed (3 read-only tool calls, accurate answer).
- Chokepoint: every product action flows through `V3Application` behind
  `/api/v2`. GUI is one adapter; CLI is 15 loose `bin/` scripts; MCP does not
  exist.
- External runtime deps: pnpm/node, Playwright Chromium, ffmpeg/ffprobe,
  CLIProxy on :8318, macOS Keychain.
- Known debt this arc inherits deliberately: renderer/validator P2 backlog
  (capture ack, tail flush, Vite descendant drain) — folded into Phase B
  where it is robustness, otherwise deferred.

## Architecture principle

One product chokepoint, many thin adapters:

```text
                V3Application (/api/v2)   ← invariants live here only
   GUI (exists)   │   cactus CLI (C1)   │   MCP server (C2)
```

CLI and MCP expose the SAME operations with the same idempotency and receipt
semantics; neither grows private product logic. Distribution treats a machine
as: repo checkout + bootstrap script + per-machine state root + LaunchAgent.

## Phase A — Brain productization (main battlefield)

- A1 **Durable conversations**: list/reopen past Brain jobs as conversations
  (stable lookup independent of the currently scored revision); a Brain
  history pane fed by existing durable rows; pin context visible per thread.
- A2 **Suggestion→action loop**: when Brain's `render_piece_preview` commits
  a preview, surface it as an auditionable B directly in the thread (play,
  A/B, promote, score deep-links); generation kicked by Brain shows live
  batch progress inline.
- A3 **Effect-state UX**: `reconciliation_required` and `ai-promoted`/
  committed effects become actionable chips (inspect receipt, retry as new
  call, jump to the produced piece) instead of passive badges.
- A4 **Brain reachability**: pin-to-Brain from Library rows; thread state
  survives route changes; error/cancel states re-enterable.

Exit: a full assistant loop — ask → Brain previews → audition → promote —
runs from one screen with receipts visible at every hop; UI vitest covers
the thread state machine; no new server invariants (reuse existing tools).

## Phase B — Robustness and self-healing

- B1 **Doctor**: one diagnostic pass (server + CLI): owner/launchd state,
  disk, ffmpeg/ffprobe, Playwright browser present, pnpm/node versions,
  CLIProxy reachability + credential presence, DB integrity_check, receipt
  reconciliation summary, staging leftovers. Surfaced in /settings/system
  and as `cactus doctor`.
- B2 **Render preflight + honest self-heal**: probe render env before a
  batch; transient render failures get one bounded auto-retry with the
  reason recorded in the job receipt; permanent failures name the missing
  dependency and the fix command.
- B3 **Renderer P2 (robustness subset)**: AudioWorklet start/reset ack,
  ScriptProcessor tail flush, supervisor drains the Vite descendant.
- B4 **Backup/restore**: the missing repo-owned command — snapshot
  runtime.sqlite3 + producer-brain/assets receipts + agent state +
  generation revisions into one dated archive; `restore` verifies receipts
  before adopting; round-trip drill in tests.
- B5 **Chaos drill**: scripted kill -9 during an active render batch →
  restart → adoption/interruption/reconcile all green (extends existing
  fault tests to a live-process drill).

Exit: `cactus doctor` on a stripped environment names every gap; chaos
drill green; backup→wipe→restore proven on a temp state root.

## Phase C — MCP server + full CLI

- C1 **`bin/cactus` unified CLI**: subcommands `status doctor gen pieces
  piece play score promote preview brain settings ops backup restore`,
  `--json` for agents and tables for humans; strictly an `/api/v2` client
  (plus doctor/backup which are operational); old `bin/` scripts stay as
  thin aliases until retired.
- C2 **MCP server** (stdio, Python, minimal deps): tools mirroring the CLI
  verb set with typed schemas, idempotency keys auto-derived, receipts
  returned verbatim; read tools separated from mutating tools; scoring and
  Apply require an explicit `acting_for_bowei` argument so agent callers
  cannot casually bind ear-truth. Registration snippet for Claude Code
  (`.mcp.json`) and docs.
- C3 **Docs**: `docs/CLI.md`, `docs/MCP.md`; API.md cross-links.

Exit: a Claude Code session on this machine drives generate → readback →
play-URL → (explicit) score via MCP alone; CLI covers every API read and
mutation; **Sol xhigh review of the MCP/CLI public surface** (auth
posture, mutation safety, schema honesty) before commit.

## Phase D — Fleet migration

- D1 **Bootstrap installer** `scripts/bootstrap.sh`: idempotent — verify or
  name-and-instruct brew deps (ffmpeg), corepack/pnpm, `pnpm install
  --frozen-lockfile`, Playwright Chromium fetch, builds, LaunchAgent
  install, `cactus doctor` gate, health verify. No sudo. Fresh-HOME
  simulation test on this machine.
- D2 **Machine profile**: port/state-root/browser flags already env-driven;
  add a small per-machine config file convention + doctor awareness;
  document the four-Mac expectations (M1/8GB machine gets render
  concurrency 1).
- D3 **Transport**: (a) git-clone path once Bowei pushes (his action);
  (b) `scripts/deploy-lan.sh` — rsync repo (excluding state/archive bulk)
  to a sibling over LAN for pushless deploy, then run bootstrap there.
  Rollout to siblings is executed per machine with verification, mbp's old
  strudel deployment replaced only after its state is inspected.

Exit: fresh-HOME install on this machine goes red→green via bootstrap
alone; one sibling pilot (mbp) serves 52 pieces with its own state root, or
a documented dry-run if Bowei defers the rollout moment.

## Order rationale

A first because it is the named battlefield and pure product value on the
already-hardened runtime. B before any interface freeze or distribution —
never ship fragility to four machines. C after B so MCP/CLI wrap a runtime
that can diagnose itself (doctor is a CLI verb and an MCP tool). D last and
thinnest: distributing is trivial once the tool is robust and self-checking.
GUI/usability fixes land continuously in whichever phase touches them.

## Discipline

Per-phase commit with gates (verify-repo + focused suites); Sol review
gates: C2 surface (mandatory), B4 restore path (destructive-adjacent),
D1 bootstrap (system-touching). Handoff refreshed per phase. Bowei's
standing actions: push/tag, ear spot-checks, fleet-rollout trigger.
