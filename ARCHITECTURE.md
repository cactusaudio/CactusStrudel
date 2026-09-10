# CactusStrudel — Architecture Digest

## What it is

`README.md` opens: "A live Strudel music studio: real-time generation through 7 model
backends, a listener-grade catalog GUI, and an action-capable Opus brain." `AGENTS.md` §0
calls it "A closed-loop producer-brain for **Strudel** (strudel.cc, JS port of
TidalCycles)" and sets the envelope: "Internal tool, not public. No auth, no multi-user."

The loop, per `AGENTS.md` §0: generate Strudel code from a curated prompt, auto-render to
mp3, human scores 0–10, guideline patches proposed and accepted or rejected with a click,
findings recorded in `producer-brain/failure-spine.jsonl`.

## Topology

`ls -1 packages | wc -l` → 16; `ls -1 apps | wc -l` → 3. `pnpm-workspace.yaml` declares
`packages/*`, `apps/*`, `tests`.

`docs/LIVE_VS_RESEARCH.md` splits the tree into a **live product path** (`runtime/`) and a
**research substrate path** (`packages/*`, `apps/cli/src/index.ts`, `genres/`, `cookbook/`),
forbidding mixed evidence: "Do not claim live product improvement from research-only green
tests."

The live surface is `runtime/serve.py` — 4,950 lines by `wc -l`, its own docstring: "Single
file, stdlib only, threaded" — plus `runtime/main.html` (3,215 lines), `data.html` and
`settings.html`. Port 8765, `CACTUS_PORT` overrides (`serve.py:14`).

The backend registry is `BACKEND_REGISTRY` at `serve.py:51`; `BACKEND_SLOTS` at
`serve.py:60` lists seven slots: `gpt-5.5`, `gpt-5.5x`, `agy-cli`, `opus-4.8`,
`gemini-flash`, `gemini-pro`, `grok-build`. Each carries `label`, `vendor`,
`cliproxy_model`, `direct_model`. Six resolve through a local gateway
(`CLIPROXY_BASE_URL`, default `http://127.0.0.1:8318/v1`, `serve.py:36`) or the vendor's
direct API; `agy-cli` has both models `None` and runs as a subprocess. The `README.md` slot
table names "Opus 4.7" where `serve.py` holds `opus-4.8` — and `README.md` itself declares
`serve.py` the "single source of truth".

Rendering: `serve.py:4248` shells `pnpm -s exec tsx src/auto-render.ts`, driving
`packages/renderer` (Playwright dependency in its `package.json`) against
`apps/renderer-page`, a Vite page hosting `@strudel/web`.

## The loop and its data

`producer-brain/corpus.jsonl` holds 49 entries (`grep -c . producer-brain/corpus.jsonl`).
All 49 carry `schema_version`, `i`, `name`, `genre_code`, `genre_preset`, `genre_label`,
`category`, `source`, `extra`, `js`, `mp3`, `sha`, `dur`, `ts`, `tags`, `parent`,
`archived_at`, `audio_features`, `prompt`; `prompt_json` on 5, `score_bowei` on 4,
`note_bowei`/`note_ts` on 3 (every line parsed with `python3 -c`). `source` is a slot key,
not a model id — `docs/MILESTONES.md` ckpt-18: "`entry.source` field on each corpus entry
= slot key (model-version-agnostic)."

`producer-brain/failure-spine.jsonl` holds 1 entry as shipped (`grep -c .`), fields `id`,
`symptom_heard`, `root_cause`, `avoid_rule`, `evidence`, `ts`, `status`; `AGENTS.md` §0
recorded "19 entries currently".

Guideline patches: `AGENTS.md` §0 step 6 — accepted ones "execute via `PUT /api/guideline`
(auto-backup before overwrite)"; `bin/guideline-put` posts to that endpoint,
`bin/rollback-guideline` sits beside it. Promotion into the prompt is deliberately narrow:
`bin/spine-promote` appends an entry's `avoid_rule` to
`producer-brain/kernel/50-spine-derived.md`, whose header states aesthetic failures "stay
in the spine but never enter the prompt". The kernel is six fragments in
`producer-brain/kernel/`, compiled fresh per generation (`README.md`).
`producer-brain/revisions.jsonl` logs each edit with `from_sha`/`to_sha`, deltas and a
`backup_dir`.

## Design decisions

`AGENTS.md` line 34: "**The harness/governor mechanism (PROMPT_BASE + spine + accept/reject
proposals) is the moat**, not the model."

The registry comment at `serve.py:49–50`: "UI never sees model names." Accordingly
`/api/backends` returns `{key, label, available, reason}` (`README.md`).

Marginal results stay marginal. `AGENTS.md` §1 records "spine entry `fs-019
VALIDATED-marginal` (mean 7.10 vs gate 7.15)" as the first positive guideline patch since
an arrange-only baseline of 6.98, then adds: "Std 1.21 (vs baseline 0.18) → real 'floor
collapse' risk."

`.claude/skills/cactus-governor/SKILL.md` states the discipline as refusable rules:
"Deterministic rules stay champion", "Gates are calibrated, not weakened", "Hooks enforce,
they do not advise", "Critic must cite measurable evidence."

## How truth is enforced

Root `package.json` defines `test` (`vitest run`), `typecheck` (`pnpm -r typecheck`) and
`lint` (`pnpm -r lint`). Nineteen workspace members define `typecheck`
(`grep -l '"typecheck"' packages/*/package.json apps/*/package.json | wc -l` → 19); none
define `lint` (same command for `"lint"` → 0), so `pnpm lint` has nothing to run.

`vitest.config.ts` includes `packages/*/src/**/*.test.ts`, `packages/*/test/**`,
`apps/*/src/**` and `tests/**`.
`find packages apps tests -name '*.test.ts' -not -path '*/node_modules/*' | wc -l` → 70
test files, 55 of them colocated under `packages/*/src`. Python side:
`runtime/test_serve_helpers.py` (366 lines).

`scripts/verify-repo.sh` (94 lines) is the aggregate gate: 14 `step` blocks — frozen-lockfile
install, `tsc -b`, `pnpm test`, three renderer/conformance runs gated on
`CACTUS_RENDER_E2E=1`, `py_compile` plus `unittest` on the runtime helpers, an `rg` check
that no operational helper hardcodes an absolute home path, and a check that
`docs/LIVE_VS_RESEARCH.md` still contains its boundary sentences.

`.claude/hooks/run-fast-tests-on-write.sh` is a `PostToolUse` `Write|Edit` hook in
`.claude/settings.json`, alongside `validate-session-graph.sh` and
`validate-strudel-code.sh` (plus `PreToolUse` `block-unsafe-shell.sh`). It walks up from a
written `.ts` file to the owning package and emits `additionalContext`; its comment: "Hint
Claude that tests are runnable here, but don't block."

`.github/workflows/verify.yml` runs `verify-repo.sh` on `pull_request` and push to `main`,
after cloning the Strudel monorepo pinned at commit `f73b3956`.

## How to read the repo

`README.md` → `docs/LIVE_VS_RESEARCH.md` (which `CLAUDE.md` says to read first) →
`runtime/serve.py` for anything user-facing → `AGENTS.md` for operator protocol →
`docs/MILESTONES.md` for checkpoint history → `packages/` only for research-engine
questions. `CLAUDE.md`'s workspace-layout block gives one line per package.

## Non-claims

- **Not an active line.** `git log -1 --format='%ci'` → `2026-06-01 02:42:57 +0800`; first
  commit `2026-05-10`.
- **AGPL-3.0-or-later, whole repo** (`LICENSE`, `package.json`), because upstream is: the
  renderer page wraps AGPL `@strudel/web`
  (`.claude/skills/cactus-governor/SKILL.md`, rule 6).
- **No hosted service.** `README.md`'s only start paths are a local installer and
  `python3 runtime/serve.py`; `AGENTS.md` states no auth and no multi-user.
- **Snapshot documents go stale by design.** `docs/STATE.md` reports 96 pieces from a
  2026-05-28 regeneration — "Don't hand-edit — re-run instead"; `corpus.jsonl` has 49.
- **Audio and archives are absent.** `.gitignore` excludes `producer-brain/audio/`,
  `archive-v0/` and `checkpoints/`, so rendered mp3s and the 104-piece frozen archive
  named in `README.md` are not in this tree.
