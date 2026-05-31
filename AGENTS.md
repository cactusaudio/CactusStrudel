# CactusStrudel — Agent Base

You are about to operate CactusStrudel. This file gets any AI (Claude, Codex, DeepSeek, Gemini CLI, Grok) to operating speed in ~5 minutes. **Read sections 0–2 first. Treat them as load-bearing.**

The user is Bowei. He runs three product lines (CactusMind, CactusDSP, CactusStrudel). You're on the third. The bar: don't be slower or less useful than the AI you replaced.

---

## 0. Immediate orientation — what is CactusStrudel right now

A closed-loop producer-brain for **Strudel** (strudel.cc, JS port of TidalCycles). Bowei's actual workflow today:

1. He clicks **▶ Generate** in a web UI (`http://localhost:8765/runtime/main.html`).
2. A Playwright script `gf` attaches to a dedicated Chrome instance (`~/.cactus-gemini-chrome`, debug port 9222), drives **Gemini web** to produce Strudel code from a curated PROMPT_BASE. Token-thrift via web scraping; no Gemini API key needed.
3. The code is auto-rendered to mp3 via a headless Strudel renderer (`@cactus/renderer` Playwright + realtime audio capture).
4. Both files land in `producer-brain/{pieces,audio}/`, an entry is appended to `producer-brain/corpus-2026-05-21.jsonl`, the PROMPT_BASE used is snapshotted to `producer-brain/prompts/`.
5. Bowei listens (audio player auto-plays on click) and **scores 0–10**.
6. He chats with Claude Code (you) in the right-sidebar **CC Bridge** to diagnose, propose **guideline patches**, accept/reject them with a click; accepted ones execute via `PUT /api/guideline` (auto-backup before overwrite).
7. Findings get recorded in `producer-brain/failure-spine.jsonl` (19 entries currently). Validated patches stay in PROMPT_BASE; REJECTED ones get reverted.

The loop is **functional, validated, in active iteration.** Don't redesign the architecture; iterate on the surface.

**Single user**, single machine (`bowei@mac`, mac mini secondary). Internal tool, not public. No auth, no multi-user. No mobile.

---

## 1. Project mission + validated direction

> Produce a tool that turns subscription Gemini (and future 3.5 Pro) into a controlled music producer via prompt-engineering + automation, with Claude Code as the brain-in-terminal that the user converses with for governance.

Validated direction (as of 2026-05-25, fits multiple prior arcs Bowei ran):
- **Unconstrained Gemini + live engine + ear-scored corpus = "normal producer level"** (n≥10 pieces validated)
- **Best-of-N first-shot beats iteration on one piece** (per Bowei's `feedback_first_shot_beats_revision`)
- **The harness/governor mechanism (PROMPT_BASE + spine + accept/reject proposals) is the moat**, not the model
- The current build targets **future 3.5 Pro release**; 3.1 Pro is the daily, 3.5 Flash is a faster lower-ceiling alternative

What `dashboard.html` (now `data.html`) doesn't say but is real: spine entry `fs-019 VALIDATED-marginal` (mean 7.10 vs gate 7.15) is the FIRST positive guideline patch since arrange-only baseline (6.98). Std 1.21 (vs baseline 0.18) → real "floor collapse" risk.

---

## 2. Bowei — interaction protocol (most critical section)

If you skip this, you will fail him.

### 2.1 Voice + structure

- **Brief first.** Every response starts terse + concrete + evidence-led. No banners, no recap, no "I'll do X" preface. State the verdict in the first line.
- **大白话 first, mechanism second.** Bowei demands a plain-language verdict before any technical detail.
- **No AI-tic phrases.** Don't say "absolutely!", "great question", "let me think step by step", "I understand you want…". These get caught and called out (`feedback_bowei_voice_constraints`).
- He answers Chinese in Chinese, English in English, mixed in mixed. Match his register.
- Code blocks for code. Tables for comparisons. Plain prose for verdicts.

### 2.2 Pushback is a strong signal

When Bowei says "不是这个是那个" or "好像不对" or "怎么还是 X" — **drop defense, investigate his pointed direction immediately**. He's right way more often than you'll predict, and defensiveness destroys the loop.

Documented hits:
- "好像没替换" → file actually replaced, cache/mtime issue elsewhere → confirmed
- "好像是你的渲染器问题" → I'd attributed to Gemini → he was right
- "音乐播放条没法点到指定位置" → Python http.server lacks Range support → fix it, not deny
- "刷新还是没有" → browser cached old HTML; not a content issue → add `Cache-Control: no-store` + self-stale-detect

### 2.3 Hard rules

- **He never types code.** "我一行代码都不敲" — if you need something tried, hand him a `paste-ready` block or open a proxy session. Never instruct him to "edit X to Y at line Z."
- **He approves Y/N on proposals; doesn't co-write them.** Bridge proposals exist for this.
- **Don't ask permission for ordinary reversible steps.** Do it, verify, report. Ask only at irreversible-risk boundaries (destructive shell, sudo, secrets, production deletions, real-money, sovereignty decisions).
- **AI-replaceability test for collaborators.** If a contribution could be done by you/another AI in <5min, decline doing it on his behalf — surface it back to him as a one-line so HE decides quickly.
- **Velocity rule.** Traditional dev estimates are 50-500× too slow for AI. If you find yourself saying "this will take a few hours", you're probably 20-100× over. Just do it.

### 2.4 Delegation (for non-Claude AIs)

If you are **NOT** Claude and you can dispatch sub-agents:
- For mechanism / boilerplate / search → use the cheapest model you have.
- For voice / verdict / judgment / Bowei-facing reply → keep on yourself.
- DeepSeek (if it's you) — Bowei said "跟不要钱似的". Use aggressively. Watch for **confabulation on binary/visual/PDF tasks** (canonical case `feedback_deepseek_failure_2026_05_09_pdf`).

### 2.5 Stop hooks + harness oddities

The Claude Code Stop hook in this session **fires on literal-text completion checks** of long-ago `/goal`s. If you hit one, surface to Bowei that "hook wants a literal 'done' / sign-off", **don't perform process theater**. He'll say "done" or `/goal clear`.

### 2.6 When to /schedule, when not to

Default: **do not** offer `/schedule`. Only offer when this turn produced a named artifact with a future date or ETA (flag ramp, `.skip` cleanup, dated TODO). At most once per session. Never invent dates.

---

## 3. Architecture map

```
~/CactusStrudel/                       — repo root (you are here)
├── AGENTS.md                          — THIS FILE (handoff)
├── CLAUDE.md                          — architectural ambition (SessionGraph IR, phases). Aspirational; not all live.
├── README.md                          — public-facing brief
├── package.json + pnpm-workspace.yaml — pnpm monorepo
├── bin/                               — operational CLI helpers (curl/bash, work for ANY AI)
├── runtime/                           — the live web app
│   ├── serve.py                       — single-file Python server (port 8765). ~780 lines. ALL routes here.
│   ├── serve                          — zsh wrapper exec'ing serve.py
│   ├── main.html                      — main page (designer-redesigned, 55KB). v2 of the producer-brain UI.
│   ├── data.html                      — dashboard (corpus + spine browser, 95KB). Renamed from dashboard.html.
│   ├── uploads/                       — logos and design assets
│   ├── cc-bridge/                     — CC Bridge file-queues (see §8)
│   │   ├── inbox.jsonl, replies.jsonl, proposals.jsonl, tasks.jsonl, transcript-tail.jsonl
│   │   └── .kick                      — marker file: user wrote inbox/took action, wake CC on next /check-inbox
│   └── *.bak.<ts>                     — backups (auto + manual)
├── producer-brain/                    — the ear-validated corpus + spine
│   ├── corpus-2026-05-21.jsonl        — 36 entries (`{i,name,extra,js,mp3,prompt,sha,dur,ts,score_bowei?,note_bowei?,has_arrange?}`)
│   ├── failure-spine.jsonl            — 19 entries (`{id,symptom_heard,root_cause,avoid_rule,evidence,ts,status}`)
│   ├── pieces/gemini_auto_<ts>.js     — Strudel source files
│   ├── audio/gemini_auto_<ts>.mp3     — rendered audio (gitignored)
│   └── prompts/gemini_auto_<ts>.txt   — PROMPT_BASE snapshot at generation time (added 2026-05-25)
├── gf                                 — zsh wrapper: gemini-fetch → auto-render
├── gl                                 — zsh wrapper: launches dedicated Chrome (debug 9222)
├── scripts/
│   ├── gemini-fetch.ts                — Playwright CDP-attach → Gemini web → scrape Strudel code
│   └── gemini-fetch.ts.bak.<ts>       — PROMPT_BASE backups (auto-created on PUT /api/guideline)
├── apps/
│   ├── cli/                           — tsx scripts: auto-render, midi-export
│   └── renderer-page/                 — Vite static page hosting @strudel/web for headless render
├── packages/
│   ├── renderer/                      — Playwright + OfflineAudioContext driver (queryHaps, render, shutdown)
│   ├── strudel-validator/, strudel-compiler/, analyzer/, critic/, …
│   │                                  — Phase 1-15 work from earlier; producer-brain bypasses most of it
│   └── (others — aspirational, see CLAUDE.md)
├── .claude/
│   └── commands/check-inbox.md        — slash command Bowei types in terminal to trigger you (§9)
└── ~/Desktop/CactusStrudel.command    — double-click launcher (kills + restarts serve, opens main.html)
```

### Layer reality

The producer-brain loop **bypasses** most of the SessionGraph/agent-runtime in `packages/*`. CLAUDE.md describes phases 1-15 of an earlier architecture; the live workflow is in `runtime/serve.py` + `scripts/gemini-fetch.ts` + `apps/cli/auto-render.ts`. Don't waste time reading packages/* until you need queryHaps (MIDI export) or `@strudel/web` boot internals.

---

## 4. Runtime

### Start the server

```bash
~/CactusStrudel/runtime/serve              # zsh wrapper; threaded HTTP + Range + cc-bridge + transcript-watcher
# or
~/Desktop/CactusStrudel.command            # kills :8765, restarts, opens browser
```

Server binds `127.0.0.1:8765`, ROOT is `~/CactusStrudel`. Logs to stdout (printed errors only; access log suppressed).

### Stop / restart

```bash
lsof -ti :8765 | xargs -r kill -9
```

The serve process spawns a daemon thread `transcript_watcher` that tails `~/.claude/projects/-Users-bowei/*.jsonl` (Claude Code's session log) and writes extracted `{user,assistant,tool}` lines to `runtime/cc-bridge/transcript-tail.jsonl` (capped 60). This is how the web's "Live" tab shows what you're doing in terminal in real time.

### Chrome attachment for gf

`gf` script attaches to Chrome at `localhost:9222`. If not running:
```bash
~/CactusStrudel/gl                          # one-shot launches Chrome with dedicated profile, returns
# then in that Chrome window: log into gemini.google.com once (persists via profile dir)
```

The web has a Chrome status pill + one-click `POST /api/chrome-start` that runs `gl` for the user.

---

## 5. Data model

### `producer-brain/corpus-2026-05-21.jsonl` — the corpus

Each line:
```json
{
  "i": 36,
  "name": "UI-1779680736",
  "extra": "(MAIN-UI, default)",
  "js":  "producer-brain/pieces/gemini_auto_1779680628163.js",
  "mp3": "producer-brain/audio/gemini_auto_1779680628163.mp3",
  "prompt": "producer-brain/prompts/gemini_auto_1779680628163.txt",
  "sha": "ab12cd34...",
  "dur": "123.456789",
  "ts":  "2026-05-25 11:45:36",
  "score_bowei": 7.5,
  "note_bowei": "lead 干净, drum 力度合适"
}
```

- Names follow batch tags: `V01..V10` (raw baseline), `ARR-01..05` (arrange-hint baked), `HOOK-01..08` (lead-hook v1, REJECTED), `HR-01..07` (refined lead-hook v2, REJECTED), `FLASH-01..05` (3.5-flash baseline test), `UI-<unix-ts>` (anything generated from the web Generate button since Phase v1).
- `score_bowei` is 0-10; `null`/absent = unscored.
- Paths are repo-relative; `url(p)` helper in HTML prepends `/`.

### `producer-brain/failure-spine.jsonl` — the spine (19 entries)

Each line is one VALIDATED, REJECTED, FIXED, or CLOSED finding. Schema:
```json
{
  "id": "fs-019",
  "symptom_heard": "lead-treatment defensive hint VALIDATED-marginal. N=3 mean 7.10 (UI-1779621053 7.8 + UI-1779623498 7.8 + UI-1779623914 5.7) vs pre-registered gate 7.15...",
  "root_cause": "...",
  "avoid_rule": "...",
  "evidence": "corpus-... UI-...; backup scripts/gemini-fetch.ts.bak.20260524-190114",
  "ts": "2026-05-24",
  "status": "VALIDATED-marginal"
}
```

`status` values: `VALIDATED`, `VALIDATED-marginal`, `REJECTED`, `FIXED`, `CLOSED`, `candidate`. Spine is **append-only** in normal flow; status updates via `Read` + `Write`-full-file (rewrite jsonl).

### `producer-brain/prompts/<basename>.txt` — per-piece PROMPT_BASE snapshot

Plain text. Captures the exact PROMPT_BASE used when that piece was generated. New since 2026-05-25. Pre-2026-05-25 entries have a NOTE-prefixed approximation from the closest available `.bak` file — accuracy caveat documented in-file.

### `producer-brain/kernel/` — Prompt Kernel (NEW 2026-05-28 Phase 1-5)

Single source of compositional prompt knowledge. Six fragments + optional style/:
```
producer-brain/kernel/
├── 00-identity.md            "You are composing in Strudel..."
├── 10-api-existence.md       full API surface + don't-exist methods
├── 20-syntax-rules.md        render-breaking syntax (silent failure)
├── 30-output-contract.md     fenced code block requirement
├── 40-creative-freedom.md    explicit "no musical decision prescribed" statement
├── 50-spine-derived.md       auto-appended by bin/spine-promote (currently empty)
└── style/                    optional per-preset style fragments (Phase 4+ slot)
```

Compiled via `runtime/prompt_kernel.py compile(mode='agy')` → returns
`{text, hash, fragments_used, mode, preset}`. Result is concatenation of all
core fragments with `---` separators. Hash = sha256[:16] of body.

**Critical design rule** (from Bowei 2026-05-28): kernel contains ONLY
API existence, syntax rules (silent-failure prevention), output format, and
positive creative-freedom statement. NO pattern formulas. NO drum-must,
4-6-layer-must, mix-discipline. The kernel is the technical envelope. The
human's vision goes through the Advanced panel.

**Current state**: hash `da992068ca18b65f`, ~7060 chars, 6 fragments.
View live: `python3 runtime/prompt_kernel.py`.
Lock file: `producer-brain/kernel.lock.json`.

**Who uses the kernel**: AGY CLI mode only (Phase 1-5 scope). The gf path
(scripts/gemini-fetch.ts PROMPT_BASE) and the Opus brain (docs/cactus-strudel-opus-pilot.md)
remain on their old content sources — Bowei explicitly excluded them from
this refactor.

### `runtime/main.html` `buildAdvancedPrompt()` — the Vision Compiler

Reads all Advanced panel options (genre / mood / BPM / key / mode / progression /
six sliders / intent / palette / drums) and emits a flowing producer-brief-style
prompt that frames every option as "the human is asking for X" rather than
"you must do X". The output goes into PROMPT_EXTRA which AGY receives on top
of the kernel.

Phase 3 rewrite intentionally stripped all pattern formulas (drum-must,
layer-count, repetition-first, mix-discipline) — those were vision narrowing.
The current output ends with an explicit reframe: "This is vision, not recipe.
The musical decisions are entirely yours."

### `producer-brain/prompts/<base>.json` — per-piece prompt sidecar (Phase 4)

For every AGY-CLI generated piece, alongside the existing `<base>.txt` snapshot
is a structured `<base>.json` with:
```json
{
  "schema_version": 1,
  "mode": "agy-cli",
  "ts": "...",
  "kernel": {"hash": "...", "fragments_used": [...], "text_length": N},
  "extra": "...",                     // PROMPT_EXTRA verbatim (the Advanced panel output)
  "compiled_prompt": "...",           // exact text sent to AGY
  "piece": "UI-..."
}
```

Corpus entry now has `prompt_json` field pointing to this file. Enables
cross-piece kernel-hash comparison, exact compiled-prompt replay, structured
research-summary queries.

### `producer-brain/revisions.jsonl` — the research database (NEW 2026-05-28)

Every human-saved code edit becomes one row here. Each line:
```json
{
  "id": "rev-<unix-ms>",
  "ts": "2026-05-28 03:45:12",
  "piece": "UI-...",
  "source": "brain-action" | "manual-edit" | "backfill",
  "intent": {"kind": "filter|gain|effect|structure|melody|tempo|palette|freeform", "target": "lead|chords|bass|drums|global", "params": {...}, "brain_reply_id": "...", "natural_lang_request": "..."},
  "code": {"before_chars", "after_chars", "delta_chars", "added_lines", "removed_lines"},
  "from_sha", "to_sha", "from_dur", "to_dur",
  "score_before": <num>,
  "score_after":  <num>,  // backfilled by /api/score after next rescore
  "score_delta":  <num>,  // computed when score_after set
  "backup_dir": "runtime/cc-bridge/brain-edit-backups/<ts>-<piece>"
}
```

The corresponding `<backup_dir>` also contains:
- `diff.txt` — unified diff of the .js change
- `revision.json` — full mirror of the jsonl row (resilient against jsonl truncation)
- the original pre-edit `.js / .mp3 / .txt` files (already there from before)

Purpose: aggregate over time → identify "what kinds of edits raised score most" → harness improvement. See `docs/research-database-plan.md` for the full design. Summary script: `bin/research-summary`. UI: per-piece "▸ revisions" toggle in `data.html`.

### `runtime/cc-bridge/*.jsonl` — see §8

### `scripts/gemini-fetch.ts.bak.<ts>` — PROMPT_BASE history

Auto-created on every `PUT /api/guideline`. Recover history with `cat`. Roll back with `cp <bak> scripts/gemini-fetch.ts`. There's also a `bin/rollback-guideline` helper.

---

## 6. All operational interfaces

### 6.1 Backend API (HTTP at `http://localhost:8765`)

| Method | Path | Body | Returns | Used for |
|---|---|---|---|---|
| GET  | `/`                              | —   | 302 → `/runtime/main.html` | |
| GET  | `/runtime/main.html`             | —   | HTML with `__PAGE_BUILD__` injected | served templated |
| GET  | `/api/recent?n=30`               | —   | `{items:[entry...],total}` | corpus tail |
| GET  | `/api/revisions?piece=X&n=N&diff=1` | — | `{items:[rev...],total_in_view,total_db}` | research-database revisions for piece X (diff=1 inlines diff text) |
| GET  | `/api/piece?name=X`              | —   | `{entry, code}` | one piece w/ source |
| GET  | `/api/guideline`                 | —   | `{prompt_base}` | current PROMPT_BASE |
| PUT  | `/api/guideline`                 | `{prompt_base}` | `{ok,backup}` | overwrite + auto-backup |
| GET  | `/api/version`                   | —   | `{main_html_build,serve_py_build,server_started}` | staleness check |
| GET  | `/api/chrome-status`             | —   | `{up,pid}` | port 9222 probe |
| POST | `/api/chrome-start`              | —   | `{ok,msg}` | spawn `gl` |
| GET  | `/api/gf-status`                 | —   | `{count,jobs:[{pid,started_at,model,extra,runtime}]}` | in-flight gf jobs (survives refresh) |
| POST | `/api/run-gf`                    | `{model?,extra?}` | SSE stream `start/log/done/error` | run pipeline. `model` ∈ `''` `3.5-flash`. Subprocess survives client disconnect; manifest append happens in `finally`. Prompt snapshot per piece. |
| POST | `/api/score`                     | `{name,score,note?}` | `{ok,name,score}` | patch corpus entry |
| POST | `/api/save-piece`                | `{code,name?}` | `{ok,entry,rendering:true}` | save edited code, render in bg |
| POST | `/api/render`                    | `{js}` | `{ok,mp3,stdout,stderr}` | re-render an existing .js |
| POST | `/api/midi`                      | `{code,name?,cycles?,cps?}` | binary `audio/midi` blob | queryHaps + SMF write |
| GET  | `/api/cc/state`                  | —   | `{inbox,replies,proposals,tasks,transcript,presets,cc_awake_marker,kick_pending}` | bridge snapshot |
| GET  | `/api/cc/stream`                 | —   | SSE `state` events on bridge mtime change | live web sync |
| GET  | `/api/cc/presets`                | —   | `{presets:[{id,label,tag,body}]}` | preset commands list |
| POST | `/api/cc/inbox`                  | `{text,tag?,context?}` | `{ok,entry}` | post chat or preset trigger |
| POST | `/api/cc/proposal-action`        | `{id,action:accept\|reject,note?}` | `{ok,id,action}` | accept/reject one proposal |
| POST | `/api/cc/task-action`            | `{id,action:cancel\|requeue}` | `{ok}` | task state change |
| POST | `/api/cc/kick`                   | —   | `{ok,marker}` | drop `.kick` marker (manual wake) |

### 6.2 File-write interfaces (you, as CC, write these directly — no HTTP)

- `runtime/cc-bridge/replies.jsonl` — append `{id,ts,in_reply_to,text,attached_piece?}` to send a chat reply to the user. ID format `rep-<unix-ms>`.
- `runtime/cc-bridge/proposals.jsonl` — append `{id,ts,title,body,diff?,status:"pending"}` to propose an action. ID format `prop-<unix-ms>`.
- `runtime/cc-bridge/tasks.jsonl` — append `{id,ts,kind,label,body,status,started_at?,ended_at?,result?}` to queue a task. Update by rewriting the file.
- `runtime/cc-bridge/inbox.jsonl` — mark entries status=`seen` by rewriting the file. ID format `in-<unix-ms>`.
- `runtime/cc-bridge/.kick` — delete after consuming.
- `producer-brain/failure-spine.jsonl` — append new finding. ID format `fs-<NN>` (next sequential).

**JSON Lines convention:** one JSON object per line, append-only when possible. Rewrites must preserve order. Always `ensure_ascii=False` (or equivalent) — Chinese characters everywhere.

### 6.3 CLI scripts (`bin/`)

Every action also has a bash wrapper in `bin/` so AIs without HTTP/Edit tools can still drive everything. See `bin/README.md` (or `ls bin/`). Coverage:

- `bin/health`            — server + Chrome + bridge state in 1 line
- `bin/peek [N]`          — last N corpus + last task/proposal/inbox
- `bin/state-refresh`     — regenerate `docs/STATE.md`
- `bin/recent [N]`        — list last N pieces with scores
- `bin/piece <name>`      — print piece's entry + code + prompt
- `bin/gen [model] [extra]` — fire generation (non-streaming wait for done)
- `bin/score <name> <num> [note]` — POST /api/score
- `bin/midi <name>`       — export MIDI for a piece, save to `~/Downloads/<name>.mid`
- `bin/guideline-get`     — print current PROMPT_BASE
- `bin/guideline-put <file>` — replace PROMPT_BASE with file contents (auto-backup)
- `bin/rollback-guideline <bak-suffix>` — restore from a `.bak.<ts>` backup
- `bin/spine-list [status]` — list spine entries, optionally filtered
- `bin/research-backfill` — one-shot: import existing `brain-edit-backups/*` into `revisions.jsonl` (idempotent)
- `bin/research-summary` — aggregate revisions by intent + kernel-hash, emit `docs/research/summary-<date>.md`, auto-propose strong signals
- `bin/checkpoint-create <name> [desc]` — snapshot prompt-system files for rollback (Phase 1-5)
- `bin/checkpoint-rollback <name>` — restore everything to a named checkpoint
- `bin/checkpoint-list` — show all checkpoints with size + description + latest marker
- `bin/spine-promote <fs-id>` — promote a render-quality spine entry into `kernel/50-spine-derived.md`
- `bin/kernel-audit` — read-only check: scan kernel for prescriptive language patterns + verify spine-ref integrity
- `bin/prompt-system-verify` — end-to-end Phase 1-5 sanity check (kernel compile, server reads kernel, Advanced UI compiles for all presets, prompt JSON schema, STATE.md freshness)
- `bin/spine-add`         — read stdin JSON, append to spine
- `bin/reply <inbox-id> <text>` — append a reply to inbox entry
- `bin/propose <title> <body> [diff]` — append a proposal (status=pending)
- `bin/task-add <kind> <label> <body>` — add a queued task
- `bin/chrome-up`         — ensure Chrome :9222 is up, launch if not
- `bin/check-inbox`       — quick all-queues dump for terminal review

All scripts: `bash`-only, depend on `curl` + `python3` + `jq` (optional). They never modify file state without printing what they did. `--help` on any of them.

### 6.4 Operations NOT exposed (intentional)

- **No delete from corpus.** A bad piece stays with `score_bowei = low`. Manually edit jsonl if you really need.
- **No multi-user.** Don't add auth.
- **No remote access.** Server binds 127.0.0.1 only.
- **No DAW iframe play API.** strudel.cc is cross-origin; user must click ▶ inside iframe. This is unavoidable; don't try.

---

## 7. The pipeline (gf flow end-to-end)

```
User clicks ▶ Generate in web
   │
   ▼
POST /api/run-gf {model?, extra?}              ─ SSE response opens
   │
   ▼ snapshot PROMPT_BASE from scripts/gemini-fetch.ts
   ▼ subprocess.Popen([GF]) with env GEMINI_MODEL=X, PROMPT_EXTRA=Y (start_new_session=True)
   │
   ├── gf wrapper:
   │    ├── tsx scripts/gemini-fetch.ts        ─ Playwright CDP attach 127.0.0.1:9222
   │    │     ├── ensure logged into Gemini    ─ fail-fast on login required
   │    │     ├── new chat, set model dropdown if env GEMINI_MODEL
   │    │     ├── type prompt = PROMPT_BASE + (PROMPT_EXTRA||"")
   │    │     ├── click submit, wait for ``` code block (max 4 min)
   │    │     └── write to producer-brain/pieces/gemini_auto_<ms>.js, print GEMINI_OUT=
   │    │
   │    └── tsx apps/cli/src/auto-render.ts <js>
   │          ├── boot @cactus/renderer (Playwright + headless renderer-page)
   │          ├── realtime capture cps × cyc = duration seconds of audio
   │          ├── encode to mp3, write to producer-brain/audio/gemini_auto_<ms>.mp3
   │          └── print path
   │
   ▼ server side: each stdout line emit('log', {line}). emit() silently noops if SSE dead.
   │
   ▼ on subprocess exit (finally):
   │   ├── if js + mp3 both exist:
   │   │     ├── compute sha + duration
   │   │     ├── write prompt snapshot to producer-brain/prompts/<basename>.txt
   │   │     ├── append corpus entry (includes prompt: field)
   │   │     └── emit('done', {entry})
   │   └── deregister from _gf_jobs
   │
   ▼ web: SSE 'done' triggers openPiece(entry.name)
       ├── fetch /api/piece?name=X → fill code editor
       ├── set audio.src = '/'+mp3, audio.play() (user-gesture inherited from Generate click)
       ├── focus #score input
       └── Recent re-poll picks up new entry
```

**Critical fix landed 2026-05-24**: SSE disconnect (page refresh, network drop) does NOT kill the subprocess. The `finally` block always runs corpus-append. The server tracks live jobs in `_gf_jobs` so the web's `gf-running` pill survives refresh. Don't regress this.

---

## 8. CC Bridge protocol (how user ↔ Claude Code talks via web)

5 jsonl files in `runtime/cc-bridge/` + a `.kick` marker file.

### File semantics

| File | Direction | When written | Schema |
|---|---|---|---|
| `inbox.jsonl`     | user → CC | user types in Chat tab OR clicks a preset command | `{id,ts,tag,text,context?,status,seen_at?}` |
| `replies.jsonl`   | CC → user | CC writes reply during `/check-inbox` | `{id,ts,in_reply_to,text,attached_piece?}` |
| `proposals.jsonl` | CC → user | CC proposes action; user accepts/rejects in web | `{id,ts,title,body,diff?,status,decided_at?,decision_note?,executed_at?,executed_result?}` |
| `tasks.jsonl`     | CC ↔ user | CC queues task; user cancels/requeues; CC updates status | `{id,ts,kind,label,body,status,started_at?,ended_at?,result?}` |
| `transcript-tail.jsonl` | auto | server's `transcript_watcher` daemon thread writes | `{ts,kind:user\|assistant\|tool,text,source_uuid}` |
| `.kick` | user → CC | exists when inbox has unread or action pending; deleted by CC after handling | (presence marker; content = unix ts) |

### Statuses

- inbox: `pending` → `seen`
- proposals: `pending` → `accepted` | `rejected`; `accepted` → also gets `executed_at` after CC executes
- tasks: `queued` → `running` → `done` | `failed`; user can request `cancel_requested`; user can `requeue` failed/cancelled

### How the web stays in sync

Web opens `EventSource /api/cc/stream`. Server pushes a `state` event whenever ANY of the 5 jsonl mtimes change. UI re-renders affected tabs + updates unread badges. Fallback: `GET /api/cc/state` on tab focus.

### Web side actions

- Chat tab textarea + Cmd+Enter → `POST /api/cc/inbox {text,tag:'chat',context?:{piece_name,code_excerpt,score,mp3}}`. "附 current piece" checkbox toggles whether context is attached.
- Proposals tab card → ✓ Accept / ✗ Reject button → `POST /api/cc/proposal-action {id,action,note?}`. Reject prompts for a free-text reason.
- Tasks tab row → ✕ Cancel / ↻ Requeue → `POST /api/cc/task-action {id,action}`.
- Commands tab → preset button click → `POST /api/cc/inbox {text:preset.body,tag:preset.tag,context}`. 4 presets defined in `serve.py` `PRESET_COMMANDS`. Add more there if needed.
- Stop All button → blanks iframes + pauses audio + reshows daw-empty placeholder.

### Presets currently defined

- `recheck-latest` (Re-analyze 最近 5 条)
- `spine-scan` (扫近期 negative 找 spine 候选)
- `diff-strongest` (Diff 最高分 vs 最低分)
- `guideline-audit` (Guideline 健康审计)

---

## 9. /check-inbox workflow (Claude Code's terminal-side ritual)

The user types `/check-inbox` in their Claude Code terminal. There's a project-level skill at `.claude/commands/check-inbox.md` that loads and gives you the instructions. Summary of what you do:

1. **Read all 4 queues + `.kick`**:
   ```
   cat runtime/cc-bridge/inbox.jsonl
   cat runtime/cc-bridge/proposals.jsonl
   cat runtime/cc-bridge/tasks.jsonl
   ls runtime/cc-bridge/.kick 2>/dev/null
   ```
2. **Triage**:
   - **New inbox** (`status==pending`): read message + context, investigate using full tool set (read pieces, spine, code), append a reply to `replies.jsonl`, mark inbox `status=seen` (rewrite). If action implied: enqueue a task too.
   - **Accepted proposals** (`status==accepted` && no `executed_at`): execute. Example: guideline patch → `curl PUT /api/guideline -d {prompt_base}`. Then set `executed_at` + `executed_result` (rewrite).
   - **Rejected proposals** (`status==rejected`): note Bowei's reason in your private state; don't re-propose the same direction this session.
   - **Cancel-requested tasks**: mark cancelled.
3. **Surface new findings**: if you found something during triage that warrants a guideline patch / spine entry, append a new `proposals.jsonl` row (status=pending) — Bowei will see it in the Proposals tab.
4. **Delete `.kick`** after consuming.
5. **Brief Bowei** in the terminal (concise summary of what you did, what's pending).

Reply tone: terse, evidence-led, no boilerplate. Reply IS the dialog he sees in the web Chat tab.

For non-Claude AIs: the same skill applies; the slash command file is just text instructions, not Claude-specific.

---

## 10. State snapshot (current as of session end)

Run `bin/state-refresh` to regenerate. Cached values:

- **Corpus**: 36 entries. Latest = `UI-1779680736` (2026-05-25 11:45:36). Top score = `UI-1779621053` = 7.8.
- **Spine**: 19 entries. Latest = `fs-019 VALIDATED-marginal` (lead-treatment defensive hint, mean 7.10 vs gate 7.15, n=3).
- **PROMPT_BASE**: 2580 chars. Lead-treatment defensive hint baked (since 2026-05-24 19:01:14). Backup at `scripts/gemini-fetch.ts.bak.20260524-190114` (2228 chars, pre-patch).
- **Active gf jobs**: 0 expected at rest. Check `GET /api/gf-status`.
- **CC Bridge state at session end**:
  - inbox: 1 historical entry (`in-1779620198175`, status=seen, "HR-07 我打 6.0...")
  - replies: 2 (round 1 attribution + round 2 execution confirmation)
  - proposals: 1 (`prop-1779620199002` lead-treatment, status=accepted+executed)
  - tasks: 1 (`task-1779620474001`, status=done, marginal pass)
  - transcript-tail: 60 entries (cap), auto-managed
- **UI version**: designer-redesigned main.html + data.html installed 2026-05-25 04:33. JS patched: `drawWaveform` no-op when `#wave` canvas absent; Recent active-class refresh fix (signature includes current.name); dawLoadBtn dual-role (no piece → Generate, with piece → Edit); A/B toolbar moved down to top:60px; Prompt tab next to Code in data.html cards (Bowei requested 2026-05-25).
- **Backups present** (don't delete, used for rollback):
  - `runtime/main.html.bak.20260524-173037`, `runtime/main.html.bak.20260525-043328`
  - `runtime/dashboard.html.bak.20260524-173037`, `runtime/dashboard.html.bak.20260525-043328`
  - `scripts/gemini-fetch.ts.bak.20260524-190114`

---

## 11. Validated + REJECTED patches (the spine in plain language)

### Validated / FIXED

- **`fs-017 FIXED`** (2026-05-21): Gemini wrote `$drums = stack(...)` → ReferenceError. Fixed by adding to PROMPT_BASE: "do NOT use $-prefixed names — $drums = ... throws ReferenceError". Live in current PROMPT_BASE.
- **arrange-hint** (baked 2026-05-21, not its own spine entry): "Compose with arrange() into at least 4 sections of varying layer density. Avoid a single monotone stack — give the piece a build/release arc." Added +0.55 over raw baseline → mean 6.98 became the new SSOT. **NOTE**: Bowei is now suspicious this is a style imposition (see §12).
- **`fs-019 VALIDATED-marginal`** (2026-05-24): lead-treatment defensive hint (triangle/sine + superimpose-octave fattening, no .off()-parallel, no sine-modulated lpf on lead). N=3 mean 7.10 vs pre-registered gate 7.15. Bowei accepted "勉强按7.15算". std 1.21 (vs baseline 0.18) → floor-collapse risk monitored. **NOTE**: Bowei is now suspicious this is a style imposition (see §12).

### REJECTED (do NOT re-try — burn evidence is in spine)

- **`fs-016 REJECTED`** (2026-05-21): bare "lead-hook" hint asking Gemini to write a "memorable melodic lead the focal point". Mean 6.38 (vs baseline 6.98). Floor collapsed to 5.0. Bowei: "Lead 都过于 detune 了". Root cause: Gemini's foregrounded leads use bare `.vib(N)` (large default depth) → warbly out-of-tune. **Do NOT add any focal-point-lead hint.**
- **`fs-018 REJECTED`** (2026-05-22): refined lead-hook with anti-vibrato constraint. Mean 6.62. Bowei on worst (5.8): "lead 很幼稚, 太干太直给了". Root cause: "Gemini's MELODIC lead-writing is naive; the lead-quality ceiling is Gemini's own taste, not a prompt-fixable surface knob". The takeaway: "expressive PROCESSING on the lead > asking for a better melody" — which fed into the fs-019 hint (currently VALIDATED-marginal).
- **Earlier spine entries** (fs-001 to fs-015) cover small bugs (broken `.q()` resonance, soundfont prefix typos, missing methods like `.stutter`/`.subdivide`/`.mod`/`.krush`/`.stut`/`.quantise`/`.quantize`, `.arp` string modes silent). All FIXED via PROMPT_BASE "Do NOT exist — never emit" line.

### When you find a new candidate

1. Run a pre-registered N≥3 batch with the candidate baked into PROMPT_BASE.
2. Score honestly. If mean < baseline 6.98 or std > 0.6 (floor collapse), **REJECT** + rollback.
3. If mean ≥ 7.15 (the validated gate), keep.
4. Always document: write to `failure-spine.jsonl` (VALIDATED or REJECTED), reference corpus piece names in `evidence:`.

---

## 12. The 4 open style-impositions (Bowei is reviewing, awaiting decision)

This is the LIVE THREAD in PROMPT_BASE. As of 2026-05-25, Bowei surfaced that several rules in the current PROMPT_BASE are **style impositions disguised as anti-error**. Pending decision:

| # | Rule | Why it's style not error |
|---|---|---|
| 1 | `sidechain: PREFER SUBTLE ... duckdepth 0.2-0.4` | Hard pump (>0.7) is a feature in Daft Punk / disco / dubstep / certain techno — forbidding it eliminates whole genres |
| 2 | `lead treatment (defensive — prefer triangle/sine, superimpose-octave, no .off()-parallel)` (= fs-019) | square/saw lead is core to acid / synthwave / big-room; `.off()`-parallel is 70s funk + baroque |
| 3 | `Compose with arrange() into at least 4 sections of varying layer density. Avoid a single monotone stack` | Forbids ambient / drone / minimalism / loop-based dub / deep techno-with-constant-groove |
| 4 | `FM is .s('sine').fm(4) (NO "superfm")` — back half is anti-error, front half locks carrier to sine | Excludes square/triangle/saw FM carriers (DX7 bass, hard synth lead) |

Plus 3 example-driven biases (mild — not rules but Gemini-mimic prone):
- `chord("<Cm9 Ab^7 Fm7 G7>")` — jazz ii-V-i bias
- `gm_pad_warm gm_flute gm_epiano1` only — narrows palette
- `RolandTR909 RolandTR808 LinnDrum` only — narrows drum palette

**Status**: Bowei said the 4 must REVERT + 3 should SCRUB, but hasn't yet pulled the trigger. Backup at `scripts/gemini-fetch.ts.bak.20260524-190114` covers the lead-treatment one. The arrange-hint goes back further — no backup; would need manual extraction.

If Bowei greenlights ("do it" / "rollback all" / similar): write the cleaned PROMPT_BASE, `PUT /api/guideline` (auto-backup), update fs-019 status to `ROLLED-BACK`, append a new spine entry documenting why.

---

## 13. Known footguns (avoid these)

- **Don't `kill -9` the subprocess pgid of gf naively** — `auto-render` is in the same group, killing kills render-in-flight. The new code uses `start_new_session=True` + does NOT kill on SSE disconnect.
- **Don't write to corpus without ts** — `data.html` sorts by ts.
- **Don't change DOM ids in main.html or data.html** — JS depends on ~50 ids by name. Full list in `~/Downloads/CactusStrudel-Pages-Redesign/SPEC.md`.
- **Don't break `__PAGE_BUILD__` placeholder** — server templates it into `runtime/main.html` at serve time. If you replace main.html, keep the literal `__PAGE_BUILD__` string in 2 places (visible build stamp + JS const).
- **Don't redesign the cc-bridge schema** — main.html JS expects exact field names.
- **Don't `cd` in Bash tool** — it can trigger permission prompt. Use `pnpm -C <dir>` and absolute paths.
- **`perl -pi` and `sed -i` break symlinks on macOS** — write to a temp file + mv.
- **`getpass()` fails in Claude Code Bash subprocess** (no controlling tty). Use AppleScript hidden-answer dialog for secret intake.
- **Chrome :9222 attach may hit "no Chrome on debug port"** — server's `/api/chrome-start` runs `gl` (the launcher) safely. Don't add `--user-data-dir` to Chrome here without coordinating; profile is `~/.cactus-gemini-chrome`.
- **macOS audio element default UI is light grey** — apply `color-scheme: dark` + `::-webkit-media-controls-panel { background: #000 }` for dark theme.
- **Browser may aggressively cache HTML** — `Cache-Control: no-store` on HTML/JS/CSS/JSONL is essential. The freshness pill (`/api/version` vs `__PAGE_BUILD__`) tells the user when a Cmd+Shift+R is needed.

---

## 14. Quick recipes (top 10 things you'll need)

### Generate a piece, wait, score it

```bash
# Bowei usually does this via web. If you need to drive it:
curl -sN -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:8765/api/run-gf > /tmp/gf.sse
# blocks until done. Find new piece in corpus tail:
tail -1 producer-brain/corpus-2026-05-21.jsonl
# (then ask Bowei to listen + score; never assign scores yourself)
```

### Read the current PROMPT_BASE

```bash
curl -s http://localhost:8765/api/guideline | python3 -c "import json,sys; print(json.load(sys.stdin)['prompt_base'])"
# or just
sed -n "/const PROMPT_BASE = /,/\`;/p" scripts/gemini-fetch.ts
```

### Rollback a guideline patch

```bash
# Auto-backups exist as gemini-fetch.ts.bak.<ts>
ls scripts/gemini-fetch.ts.bak.*
cp scripts/gemini-fetch.ts.bak.20260524-190114 scripts/gemini-fetch.ts
# Verify:
curl -s http://localhost:8765/api/guideline | python3 -c "import json,sys; print(len(json.load(sys.stdin)['prompt_base']))"
```

### Score a piece

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"name":"UI-1779680736","score":7.5,"note":"lead 干净"}' \
  http://localhost:8765/api/score
```

### Inspect a piece (entry + code + prompt-snapshot)

```bash
curl -s "http://localhost:8765/api/piece?name=UI-1779680736" | python3 -m json.tool | head -40
cat producer-brain/prompts/gemini_auto_1779680628163.txt
```

### Reply to a user message via the bridge

Append a single line to `runtime/cc-bridge/replies.jsonl`:
```bash
ts=$(date '+%Y-%m-%d %H:%M:%S')
ms=$(python3 -c 'import time; print(int(time.time()*1000))')
python3 -c "
import json
print(json.dumps({'id':f'rep-$ms','ts':'$ts','in_reply_to':'in-XXXXXXXXXXXX','text':'your reply here','attached_piece':'UI-...'}, ensure_ascii=False))
" >> runtime/cc-bridge/replies.jsonl
```

Then mark the inbox entry as `seen` by rewriting `inbox.jsonl`.

### Propose an action

```bash
python3 -c "
import json,time
prop = {
  'id': f'prop-{int(time.time()*1000)}',
  'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
  'title': 'Rollback lead-treatment hint',
  'body':  'fs-019 VALIDATED-marginal with floor 5.7 worry; bowei flagged as style imposition.',
  'diff':  '- lead treatment (defensive ...)\n(removes the line)',
  'status': 'pending'
}
print(json.dumps(prop, ensure_ascii=False))
" >> runtime/cc-bridge/proposals.jsonl
```

### Add a spine entry

```bash
python3 -c "
import json, time
e = {
  'id': 'fs-020',
  'symptom_heard': 'short description of what was heard',
  'root_cause':    'what the underlying issue is',
  'avoid_rule':    'what to do or not do in PROMPT_BASE going forward',
  'evidence':      'corpus piece names + numbers + std',
  'ts': '$(date +%F)',
  'status': 'candidate'   # candidate | VALIDATED | REJECTED | FIXED | CLOSED
}
print(json.dumps(e, ensure_ascii=False))
" >> producer-brain/failure-spine.jsonl
```

### Export a piece to MIDI

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d "$(python3 -c "
import json
code = open('producer-brain/pieces/gemini_auto_1779680628163.js').read()
print(json.dumps({'code':code,'name':'UI-1779680736','cycles':32,'cps':0.5}))
")" \
  http://localhost:8765/api/midi --output ~/Downloads/UI-1779680736.mid
file ~/Downloads/UI-1779680736.mid    # should report Standard MIDI File
```

### Restart everything cleanly

```bash
lsof -ti :8765 | xargs -r kill -9
sleep 1
~/CactusStrudel/runtime/serve >/tmp/cactus-serve.log 2>&1 &
sleep 2
curl -sI http://localhost:8765/api/version | head -3
```

---

## 15. Where else to look

- `CLAUDE.md` (this repo) — architectural ambition, 15-phase plan from earlier. Most of `packages/*` is from that era. Read only when you need a specific package's API.
- `~/.claude/projects/-Users-bowei/memory/MEMORY.md` — Bowei's personal memory index. Read `user_bowei_complete_profile.md` first if you have access. ~100 files spanning his projects, preferences, history.
- `.claude/commands/check-inbox.md` — the slash-command skill for /check-inbox workflow.
- `~/Downloads/CactusStrudel-Pages-Redesign/SPEC.md` — the designer's spec doc (functional requirements for main + data, no style). 18 KB. Useful if redesigning UI.
- `docs/HANDOFF.md` — the prompt Bowei pastes to the next AI to onboard them. Two variants (local-FS / chat-only) + sample good first response.
- `docs/research-database-plan.md` — design doc for the revisions.jsonl research database (Phase 4 prompt-JSON integration noted).
- `producer-brain/checkpoints/` — every Phase 1-5 checkpoint (snapshot.tar.gz + rollback.sh). `bash bin/checkpoint-rollback checkpoint-NN-<name>` restores cleanly.
- `~/Downloads/CactusStrudel-Design-v2/` — older bundle with screenshots from earlier handoff round.

### Memory files most relevant to CactusStrudel work

If you have access to `~/.claude/projects/-Users-bowei/memory/`:
- `project_cactusstrudel_validated_direction.md`
- `feedback_listen_dont_hide_behind_metrics.md`
- `feedback_formulaic_music_strength.md`
- `feedback_dont_over_govern_specialist_agent.md`
- `feedback_first_shot_beats_revision.md`
- `feedback_bowei_voice_constraints.md`
- `feedback_bowei_chatgpt_voice_contract.md`
- `feedback_bowei_pushback_signal.md`
- `feedback_renhua_brief_response.md`
- `feedback_never_types_code_proxy_execution.md`
- `feedback_default_delegate_to_deepseek.md` (only if you delegate; not if you ARE deepseek)

### Bowei's other product lines (context — not your job)

- **CactusMind** (~/CactusMind, ~/cactus-mind, ~/cactus-governance) — governance-amplifier for Claude; sprint 11d→2h velocity anchor; lots of spine-style failure tracking
- **CactusDSP** — distilled audio processor, pivoted 2026-04-26 to single Cactus-branded plugin (not a foundry/browser)
- **Cactus Local Agent / AgentLink Rescue** — Go + Gemma 4 offline portable macOS rescue tool
- **Cactus Audio Labs** — services business (~/Documents/Folder)

Don't conflate. They live in different repos. CactusStrudel is the music agent only.

---

## 16. When Bowei pushes back

Re-read §2.2. Drop defense, investigate his pointed direction. Examples from this session alone:

- "刷新了还是没有" → not a content issue → browser cache → added `Cache-Control: no-store` + auto-stale-detection
- "中间的DAW编辑器没有接上" → dawLoadBtn was disabled by default → re-purposed it to dual-role (no piece → Generate, with piece → Edit)
- "点RECENT的歌曲，光标没移到那个歌曲上" → loadRecent signature didn't include current.name → wasn't re-rendering → fixed by adding it
- "DAW 太快被隐藏了" → breakpoint too high (1180px) → lowered to 820px + flex-compress between
- "现在的 prompt_base 是不是限制太多了?" → it was; surfaced the 4 style impositions in §12

Pattern: Bowei sees the symptom faster than you see the cause. Trust + investigate + fix. Don't argue.

---

## Done. You're operating.

Drop a one-line "ok, I'm operational" + last 3 things in `state-refresh` output to Bowei when he hands you the keys. Then wait for his next steer.

**Maintenance note for whoever updates this file:** when you make a non-trivial change to the system, update §10 (state) + §11/12 if you touched spine/PROMPT_BASE. Append, don't rewrite. Keep §2 sacred.
