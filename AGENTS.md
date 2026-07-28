# CactusStrudel — Agent operating contract

Bowei is the only user. CactusStrudel is a local Strudel producer workspace:
generate independent first shots, listen to immutable renders, score the exact
audio revision, and use an Agent Brain for evidence-backed assistance.

## 0. Five-minute start

Run this before reading broadly:

```bash
bin/catch-up
```

Then choose one area:

```bash
bin/catch-up ui
bin/catch-up http
bin/catch-up truth
bin/catch-up agent
bin/catch-up generation
bin/catch-up renderer
bin/catch-up research
bin/catch-up repo
```

`docs/README.md` is the document router. Read only the selected area’s
entrypoints and tests. Do not scan `archive/` or dispatch a repo-wide agent
swarm unless the change genuinely crosses multiple ownership boundaries.

Live product:

```text
http://127.0.0.1:8765/studio
```

## 1. Product contract

1. A human supplies musical vision.
2. Best-of-1/2/4 creates independent first shots, not repeated rewrites.
3. Successful work becomes an immutable revision with code, prompt, model,
   validator, audio, duration, and hash receipts.
4. Bowei listens to the exact audio bytes and scores that revision from 0–10.
5. Research and Brain suggestions may inform a decision; they never make the
   musical decision.

The prompt kernel is a technical envelope: real Strudel API, render-breaking
syntax constraints, output format, and creative freedom. It must not prescribe
taste, arrangement formulas, required layers, or mixing recipes.

**Bowei’s ear is the only music-quality gate.** Mechanical validation proves
usability and identity, not aesthetic success.

## 2. Authority and evidence

Keep these claims separate:

1. source changed;
2. build succeeded;
3. the running server serves that build;
4. a durable job/settings/revision receipt exists;
5. Bowei listened or explicitly accepted it.

Operational authority:

- canonical database: `~/.cactus-strudel/v3/runtime.sqlite3`;
- immutable assets: `producer-brain/assets/`;
- live UI build: `runtime/app/`;
- Agent candidate/receipt state: `~/.cactus-strudel/v3/agent/`;
- API credential: Keychain reference only;
- dynamic readback: `bin/catch-up` and `bin/health`.

`catch-up`/`STATE` are bounded observations. `bin/source-attest` supplies the
effective source/index/untracked/landing identities; controlled build receipts
and `verify-served` supply source → build → served-byte evidence.
Legacy JSONL, failure spine, old prompts, and archived implementations are
evidence, not alternate live control planes. See `docs/LIVE_VS_RESEARCH.md`.

## 3. Non-negotiable invariants

- A piece is stable identity; a revision is immutable rendered truth.
- A score binds to revision ID and exact audio SHA.
- Preview edits create new revisions; promotion never overwrites old bytes.
- Generation and Brain work are server-owned durable jobs; browser disconnect
  does not own or cancel them.
- Idempotency keys bind to request content; changed content needs a new key.
- Exact CLIProxy endpoint, model ID, effort, and orchestration are recorded.
  There is no silent model or route fallback.
- Ultra is bounded client orchestration; upstream effort is never `"ultra"`.
- Agent Settings follows Draft → Catalog → Test → Apply. Test never Applies.
  Only Bowei performs the final Apply action.
- Research can propose; it cannot promote, score, Apply settings, or rewrite
  the active prompt kernel.

## 4. Live topology

| Layer | Owner |
|---|---|
| Producer UI | `apps/producer-ui/` |
| HTTP/static server | `runtime/serve.py` |
| Application/API adapters | `runtime/v3_api.py` |
| Piece/revision truth | `runtime/v3/` |
| Agent/CLIProxy/Brain | `runtime/agent/` |
| Render worker | `apps/render-worker/` |
| Browser renderer | `packages/renderer/`, `apps/renderer-page/` |
| Strudel validation | `packages/strudel-validator/` |
| Audio features | `packages/analyzer/` |
| Prompt/data assets | `producer-brain/` |

`V3Application` coordinates several stores over the canonical state root:
RuntimeTruth, generation batches, Brain jobs, the UI `api_events` cursor, and
Agent settings. Do not describe them as one repository or one transaction.
The exact topology is in `docs/architecture.md`.

## 5. Change routing

| Change | Read first | Focused check |
|---|---|---|
| UI/transport/A-B | `apps/producer-ui/README.md` | UI typecheck + tests + build |
| HTTP route/adapter | `docs/API.md` | `tests/v3_api` |
| piece/revision/job truth | `runtime/v3/README.md` | `tests/v3` |
| Agent/CLIProxy/Brain | `docs/SETTINGS.md`, `runtime/agent/README.md` | `tests/agent_v3` + targeted API tests |
| generation/kernel | `producer-brain/README.md` | validator + targeted generation test |
| renderer/audio | `docs/renderer.md` | renderer/analyzer tests + one focused render when needed |
| legacy/research | `docs/LIVE_VS_RESEARCH.md` | read-only reconciliation/evidence check |
| repo/build/docs | `docs/development.md` | docs check + repo verification script |

Machine-readable routing lives in `docs/areas.json`.

## 6. Development rules

- Preserve unrelated dirty work. `probe-renderer.mjs` may contain Bowei’s
  independent local modification; do not overwrite it without an explicit
  request.
- Use live code and readback as authority; dated prose can drift.
- Keep archive content inert. Do not restore old SessionGraph, browser-bridge,
  gf, v2 API, Router/shim, or specialist-swarm control paths into live defaults.
- Put stable contracts in docs; put mutable counts only in generated
  `docs/STATE.md`.
- Update the owning component README and `docs/areas.json` when ownership moves.
- Ordinary reversible implementation work does not need permission. Stop only
  for destructive data changes, secrets, real money, or Bowei-owned product or
  musical decisions.

## 7. Verification

Use the smallest check that proves the changed seam:

```bash
python3 scripts/check_docs.py
python3 -m unittest discover -s tests/v3_api -t .
pnpm --filter @cactus/producer-ui test
```

For a cross-layer change:

```bash
scripts/verify-repo.sh
```

Use a real model/render probe only when the model/render path changed. Never
substitute a model matrix or automated aesthetic score for listening.

## 8. Bowei-facing protocol

- Verdict first, plain language first, evidence second.
- Match Chinese/English register.
- Bowei does not type or edit code; make the scoped change and report it.
- When he says the diagnosis is wrong, investigate his direction immediately.
- Distinguish built, served, committed, tested, Applied, scored, and accepted.

## 9. Handoff

Use `bin/handoff start|show|check|close`; do not grow a historical diary inside
AGENTS or STATE. A handoff records only the current delta, evidence, pending
work, Bowei-owned decisions, and exact resume point. Git and `archive/` preserve
product/source history; the ignored handoff itself is ephemeral.

`CLAUDE.md` is a thin adapter; no singular `AGENT.md` exists because `AGENTS.md` is the sole cross-agent authority.
