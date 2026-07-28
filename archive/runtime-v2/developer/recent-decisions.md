# Recent decisions (ckpt 16 → 34)

Each entry = one substantial architectural decision. Linked to the ckpt where
it was implemented. Read this before reverting or re-implementing anything.

When you make a new substantive change, append a new entry at the top.

## 2026-05-29 — Hardening pass (~40 audit findings fixed)

Full security/data-integrity/UX/elegance sweep after a 4-agent deep review.
Regression coverage: `developer/smoke-test.py` (run against a live server — 19
checks, must be ALL GREEN). Highlights — DO NOT revert these without reading why:

**Security**
- `_brain_tool_update_settings` strips `developer.*` / `api_key` / `base_url`
  from any brain patch → the brain can NO LONGER grant itself
  `write_override` (was a full sandbox-escape to source-write + bash).
- `_dev_resolve_path` uses `realpath` (blocks symlink-escape) + blocks the whole
  `~/.cactus-strudel` tree. `dev_run_bash` output runs through `_redact_secrets`;
  its blocklist is explicitly a thin guard, NOT a boundary (write_override is the
  real, human-only gate).
- `delete_piece` is two-call nonce-gated (first call mints a nonce + refuses;
  only a second call with it deletes). Irreversible → hard gate.

**Data integrity** — `_manifest_lock` (RLock) serializes ALL corpus
read-modify-write + appends + i/name allocation (was unlocked → concurrent
gen-append vs score/archive-rewrite silently lost pieces). `_manifest_entries`
is now bad-line tolerant. Spine has its own `_spine_lock`.

**Brain/UX** — brain-chat now streams SSE (`stream:true`) with per-tool
progress + client abort (`_brain_chat_events` generator; JSON path kept for
back-comp). The legacy `_detect_brain_code_action` regex short-circuit was
DELETED (it hijacked "filter/lpf" msgs, ignoring typed numbers). Confab guard
reworked to be question-INTENT-driven (`_should_force_tool`) — dropped the
false-firing bare-ID/count answer regex. Generate Cancel (`/api/generate/cancel`)
now kills the server render via `_run_render_subprocess` killpg; brain async
jobs show in `/api/gen-status` (were invisible).

**Render pipeline** — one helper trio: `_run_render_subprocess` (own process
group → killpg on timeout/cancel), `_probe_mp3`, `_mp3_path_for`. All 5 render
sites + 3 SSE-open blocks deduped. `export_midi` cps parse is `_cpm_to_cps`
(no more `eval`). AGY gen uses `_agy_bin_path()` (was bypassing config).

**Ops** — `CACTUS_PORT` env + clean bind-failure message; render-toolchain
preflight at boot; line-buffered stdout; `_brain_gen_jobs` pruned; cc/stream
SSE bounded + heartbeats; malformed JSON → 400 via `_json_body`; `.bak` files
moved out of the served tree to `.runtime-bak-attic/`.

**UI** — `data.html` restyled to main.html's gold-on-dark (accent family →
gold, default `data-accent="gold"`); XSS fixed (data.html delegated handlers +
main.html `escAttr` on title/data-tip); rename/score patch in-memory (no
`location.reload`); settings can clear a saved key (type `clear`); dead
`drawWaveform` removed; `:focus-visible` rings added.

## 2026-05-29 — Opus 4.7 → 4.8 model upgrade (memo)

Swapped BOTH Claude routes from Opus 4.7 to **4.8**. Going forward the project
uses 4.8 everywhere; 4.7 is retired.

- **Brain chat**: `claude-opus-4-8(xhigh)` (was `claude-opus-4-7(xhigh)`).
- **Anthropic generation slot**: key renamed `opus-4.7` → **`opus-4.8`**, label
  "Opus 4.8", cliproxy model `claude-opus-4-8(xhigh)`, direct fallback
  `claude-opus-4-8`.
- Files touched: `runtime/serve.py` (`BRAIN_CHAT_CLIPROXY_MODEL` /
  `BRAIN_CHAT_DIRECT_MODEL`, `BACKEND_REGISTRY`, `BACKEND_SLOTS`, fallback list,
  brain-tool slot enum+description), `runtime/user_config.py` DEFAULTS,
  `~/.cactus-strudel/config.json` (active `brain` override),
  `runtime/data.html` + `main.html` + `settings.html` (labels/colors/order/
  placeholder), `docs/SETTINGS.md`, `docs/HANDOFF.md`,
  `bin/cactus-strudel-postdeploy.md.template`.
- Migrated the 2 live corpus pieces (CHP-001, CO-001) `source` opus-4.7→opus-4.8
  and dropped the temporary data.html legacy `opus-4.7` display mapping.

**CONVENTION (going forward): always use 4.8, never 4.7.** The Anthropic slot is
`opus-4.8`. Any `opus-4.7` / `claude-opus-4-7` you see is stale → upgrade it,
**EXCEPT immutable history, which is left intentionally — do NOT rewrite**:
`producer-brain/checkpoints/*` snapshots, `cc-bridge/brain-edit-backups/*`, the
dated entries in `docs/MILESTONES.md`, and `docs/HANDOFF.md:824` (that line is
**Codex CLI**, a different tool). Those truthfully record past state made by 4.7.

Why kept: those are integrity snapshots / dated logs; rewriting them would
falsify provenance and break checkpoint-restore fidelity.

Verified: `/api/backends` shows only `opus-4.8` (available); brain reply
`model = claude-opus-4-8(xhigh)`; opus-4.8 generation smoke = MH-002 rendered;
live corpus opus sources all `opus-4.8`. cliproxy gateway confirmed serving
`claude-opus-4-8` and accepting the `(xhigh)` effort suffix (same as 4.7).

## ckpt-34 (2026-05-28) — Brain spine tools

Added 2 brain function-calling tools: `add_spine_entry`, `update_spine_status`.
Brain can now record validation/rejection patterns from chat into
failure-spine.jsonl with audit trail of `_transitions` (from/to/reason/ts).

Why: closes the loop on "I keep hearing X" → spine pattern → future generation
avoids. Previously brain could only score pieces.

## ckpt-33 (2026-05-28) — Failure spine archived

Moved 20 historical spine entries → `archive-v0/failure-spine.jsonl`. Created
empty active `failure-spine.jsonl`. spine.html shows archive via toggle
(default hidden); active counts only.

Why: parallel to the corpus archive-v0 pattern. Pre-2026-05-28 spine was
research-era; going forward, new patterns get fresh ids starting from where
the archive left off (next id = fs-021 etc.).

## ckpt-32 (2026-05-28) — Spine page

Replaced top-nav `/producer-brain/failure-spine.jsonl` link (raw jsonl) with
proper `runtime/spine.html`. Status filter + search + per-entry color accents
+ piece-name regex auto-links to `data.html#piece=NAME`.

Why: spine was a dead-end in the UI per audit. Now it's a first-class page.

## ckpt-31 (2026-05-28) — Config coverage gap closure

Closed 4 last gaps: `cc.session_dir` auto-derives from `getpass.getuser()`
(works for jack@Mac-Studio); `brain.cliproxy_model` + `brain.direct_model`
exposed in Settings Advanced; legacy `~/Downloads/CLIProxyAPI-*.md` fallback
removed from `_cliproxy_api_key()` (pure config-driven).

Why: Bowei asked "is everything covered yet?" — these were the last
non-config residuals.

## ckpt-29 (2026-05-28) — Universal installer + Settings UI + dual-mode dispatch

Major refactor. Three-layer config (env > `~/.cactus-strudel/config.json` >
defaults). Settings UI for backends + providers + AGY + brain models.
`_resolve_slot_route(slot)` picks cliproxy/direct/agy at dispatch time.
Each of 7 slots has BOTH `cliproxy_model` and `direct_model`. Installer no
longer detects per-host configs — all config flows through Settings UI.

Why: Bowei said "make it universal — friends without CLIProxy should be able
to use direct vendor APIs". Settings UI surfaces all keys.

## ckpt-27 (2026-05-28) — Bundle v2 + packaging memo

`refs/strudel-monorepo/` subset (3.7M) added to tar; installer now does
`pnpm install` inside the monorepo too AND runs `playwright install chromium`.
Smarter key-doc match-by-port logic (replaced fragile filename scan).

Why: mbp v1 deploy failed because tar omitted strudel-monorepo (vite import
failed) AND Playwright was never installed. v2 closes these.

## ckpt-25 (2026-05-28) — Brain tool-use

Brain now uses OpenAI standard function-calling (CLIProxy bridges to Anthropic
`tool_use`). 5 initial tools: generate_piece / list_recent / get_piece_code /
search_corpus / score_piece. Repo source locked off via pilot doc + tool surface.

Why: brain previously only emitted text; now it actually acts.

## ckpt-24 (2026-05-28) — Per-vendor color palette

7 model colors: gpt-5.5 purple, gpt-5.5x deep purple, agy turquoise, opus
orange, gemini-flash sky, gemini-pro deep blue, grok silver. Synced to both
trajectory cards (data.html `BACKEND_META`) and per-piece pills
(`.m-backend[data-src=…]`).

Why: Bowei's per-vendor brand identity. Visual consistency between trajectory
row + piece tags.

## ckpt-22 (2026-05-28) — Note editor + delete flow

Note moved to expandable `▸ note` panel (textarea + save). Trash icon →
2-stage modal (archive soft / permanent delete). `archived_at` field hides
piece from default views without losing data.

Why: Per audit, native `prompt()`/`alert()` UX was brutal; archive separation
needed for DB hygiene.

## ckpt-21 (2026-05-28) — info-icon popup positioning

Reusable `.info-icon` component. Body-level `position:fixed` popup positioned
by JS — escapes any ancestor `overflow:hidden`. Lowercase `i` (Georgia serif,
text-transform:none !important to defeat parent uppercase).

Why: earlier inline `::after` tooltips got clipped by section boundaries.

## ckpt-19 (2026-05-28) — Data page Sprint 1

Free-text search; 6 category cards clickable (filter category); auto-refresh
30s; render-failed pieces visible (with badge); genre_code chip; note_bowei
inline; localStorage UI state persistence (sort only — filters reset per
visit); `#piece=NAME` hash deep-link.

Why: data page was missing all the search/filter functions of a real DB GUI.

## ckpt-18 (2026-05-28) — Backend registry + CLIProxy live

7 backend slots: AGY CLI + 6 CLIProxy slots (Opus 4.7, GPT 5.5, GPT 5.5x,
Gemini Flash, Gemini Pro, Grok Build). `/api/backends` single source of truth.
`entry.source` field = slot key (model-version-agnostic).

Why: previously the UI showed 3 dropdown options (AGY/3.5 Flash/3.1 Pro) and
gf web-scrape was the only multi-vendor path. Now CLIProxy handles all of it
via slot dispatch.

## ckpt-17 (2026-05-28) — Severe-six fix

gf path permanently archived → `archive-gf/`. `corpus.jsonl` schema unified
via `_build_corpus_entry`. `_atomic_write_text` helper. `ROOT` derived from
`__file__`. boundedSurprise() bug. advRandomness dead refs. Stop All race.

Why: audit found 6 severe bugs; this ckpt was the unified fix.

---

## How to add an entry

When you finish a substantive change:

1. Create ckpt: `bash bin/checkpoint-create <N>-<slug> "<short summary>"`
2. Append to the top of THIS file with:
   - `## ckpt-NN (YYYY-MM-DD) — <title>`
   - 2-4 sentences on what + why

Avoid trivial entries (CSS tweaks, typo fixes). Use this for things future-you
needs to remember.
