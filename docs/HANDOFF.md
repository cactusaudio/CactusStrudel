# CactusStrudel — Handoff Prompts

Paste one of these as the first message to a new AI agent (Codex / DeepSeek / Gemini CLI / Grok Build / new Claude session) to onboard them as the operator of CactusStrudel.

---

## 2026-05-28 Full Claude Code Handoff — Current Source of Truth

This is the current handoff for Claude Code taking over CactusStrudel development from Codex. Read this section first. Older sections below are still useful historical receipts, but their live status claims may be stale unless they match `docs/STATE.md` and `bin/health`.

### 0. First Message Claude Code Should Send Bowei

After reading this document and running the checks below, reply to Bowei in Chinese, short and factual:

```text
Brief: 已接手 CactusStrudel。Claude Code / <actual model + entry>.
状态: server/chrome/corpus/bridge = <from bin/health>.
我已读 docs/HANDOFF.md + docs/STATE.md；当前最重要的风险是 <one sentence>.
等你下一条具体指令。
```

Do not send a manifesto, a table of contents, or an "excited to help" banner. Bowei dislikes AI-flavored ceremony. Use concrete evidence and keep moving.

### 1. How To Orient

Repository root:

```bash
cd /Users/bowei/CactusStrudel
```

Read these files in this order:

```bash
sed -n '1,260p' docs/HANDOFF.md
sed -n '1,220p' docs/STATE.md
sed -n '1,260p' AGENTS.md
sed -n '1,220p' docs/cactus-strudel-opus-pilot.md
sed -n '1,180p' docs/agy-strudel-generation-brief.md
```

Then run:

```bash
bash bin/health
curl -s http://localhost:8765/api/version
curl -s 'http://localhost:8765/api/recent?n=12' | python3 -m json.tool
```

Current verified state at handoff time:

```text
time: 2026-05-28 02:18 Asia/Shanghai
health: server ✓  chrome ✓  gf-running 0  corpus 96  inbox-pending 0  proposals-pending 0  kick ·
web: http://localhost:8765/runtime/main.html
STATE: regenerated 2026-05-28 02:18:16
latest piece: UI-1779898605
latest piece sha: 398b3612cd20810b
latest piece dur: 63.583188
```

If these commands disagree with this handoff, trust live commands and update `docs/STATE.md` with:

```bash
bash bin/state-refresh
```

### 2. Collaboration Contract With Bowei

Bowei wants an autonomous engineering partner, not a permission-seeking assistant.

Working style:

- Brief first.
- Verify local truth before claiming status.
- Continue through implementation and verification when the task is clear.
- Do not ask permission for ordinary local reversible changes.
- Do not push, publish, merge, delete large data, change secrets, or alter global host config unless explicitly asked.
- Do not revert unrelated dirty files.
- Preserve evidence at decision boundaries, not every tiny step.
- Bowei's listening score is ground truth for music quality. A clean render only proves harness success.

Response style:

- Chinese is fine and often preferred.
- Be direct, concrete, and evidence-oriented.
- Avoid ornamental summaries, broad "roadmap" banners, and motivational filler.
- If a route fails, say what failed, what was learned, and the next smallest useful move.

### 3. Runtime Overview

The local product is a single Python HTTP server plus a static app:

- server: `runtime/serve.py`
- launcher: `runtime/serve`
- UI: `runtime/main.html`
- URL: `http://localhost:8765/runtime/main.html`
- corpus: `producer-brain/corpus-2026-05-21.jsonl`
- pieces: `producer-brain/pieces/`
- audio: `producer-brain/audio/`
- prompts: `producer-brain/prompts/`
- bridge state: `runtime/cc-bridge/`

Start/restart:

```bash
cd /Users/bowei/CactusStrudel
pid=$(lsof -nP -iTCP:8765 -sTCP:LISTEN -t | head -1); [ -n "$pid" ] && kill "$pid" || true
sleep 1
./runtime/serve
```

Keep the server running if the user is actively using the app. Do not leave duplicate servers on `8765`.

Chrome status:

```bash
bash bin/chrome-up
curl -s http://127.0.0.1:9222/json/version
```

Important nuance: the web-Gemini `gf` path needs Chrome debug port 9222. `auto-render.ts` usually uses Playwright/headless Chromium and does not necessarily need that external Chrome session.

### 4. Current UI Shape

The app has:

- left column: generation controls, player, code editor, mix sliders, scoring/recent list;
- center workspace: switchable `Advanced Generation` panel and `DAW Editor`;
- right column: Cactus/Claude/Opus chat, proposals, tasks, commands, transcript.

Current center workspace:

- `Advanced Generation` is the default view.
- `DAW Editor` is an external `strudel.cc` iframe loaded from the local code.
- There is a top `Save+Render` button in the workspace bar.
- There is also a left Code panel `Save+Render` button.

Cross-origin limitation:

- The external `strudel.cc` iframe cannot be reliably inspected for edited code or precise playhead state from this local app.
- Do not promise direct DAW-internal edit capture or exact DAW playhead sync unless you replace the iframe with a local controllable Strudel engine.
- Current reliable source of truth is the local `textarea#code`; saving uses local code, not iframe-internal edits.

### 5. Latest UI/Chat Changes Made Right Before This Handoff

Files changed:

- `runtime/main.html`
- `runtime/serve.py`
- `docs/STATE.md`
- `docs/HANDOFF.md` (this section)
- `producer-brain/corpus-2026-05-21.jsonl` was also changed by the real Save+Render test because manifest metadata for `UI-1779898605` was updated.

Right sidebar chat improvements:

- Chat messages now render lightweight rich text rather than dry raw text.
- Fenced JavaScript code blocks render as `.md-code` cards with small JS syntax highlighting.
- Inline code renders as `.inline-code`.
- Parameter/method tokens such as `.lpf(1200)`, `.room(0.9)`, `.delaytime("3/16")` render as `.param-chip`.
- Bullet lists render as actual lists.
- Rendering is HTML-escaped before formatting; do not remove escaping.

Relevant code in `runtime/main.html`:

- CSS: `.inline-code`, `.param-chip`, `.md-code` around the CC chat/message styling section.
- JS helpers: `highlightJs`, `paramChipHtml`, `renderInlineRich`, `renderMsgBody`.
- Chat renderer now uses `renderMsgBody(m.text)` for both user and assistant messages.

Input behavior:

- Right chat textarea now sends on `Enter`.
- `Shift+Enter` inserts a newline.

Save behavior:

- The old `Render` button created a new edited piece through `/api/save-piece`.
- It is now `Save+Render` and overwrites the currently loaded piece through `/api/update-piece-code`.
- It requires a current piece name.
- It backs up the current JS/MP3/prompt/manifest entry before writing.
- It renders synchronously.
- On render failure, it restores the old JS from the pre-save copy and returns an error.

Backend endpoint:

```text
POST /api/update-piece-code
body: {"name": "<piece name>", "code": "<Strudel code>"}
returns: {"ok": true, "entry": <updated corpus entry>, "backup": <backup dir>, "stdout": ..., "stderr": ...}
```

Implementation location:

- dispatch: `runtime/serve.py`, `_dispatch_post`
- handler: `runtime/serve.py`, `_api_update_piece_code`

Verified test:

```text
piece: UI-1779898605
operation: same-code overwrite Save+Render
result: ok true
sha: 398b3612cd20810b
dur: 63.583188
backup: runtime/cc-bridge/brain-edit-backups/20260528-021314-UI-1779898605
```

Browser DOM verification after reload:

```text
Save+Render left button present
Save+Render workspace button present
codeBlocks rendered: 6
paramChips rendered: 7
Enter handler condition present: e.key === 'Enter' && !e.shiftKey
```

Static verification:

```bash
python3 -m py_compile runtime/serve.py
node - <<'NODE'
const fs=require('fs');
const html=fs.readFileSync('runtime/main.html','utf8');
const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
for (let i=0;i<scripts.length;i++) new Function(scripts[i]);
console.log('scripts ok', scripts.length);
NODE
```

### 6. Claude/Opus Brain Integration In The Right Sidebar

The right sidebar Chat is currently wired to CLIProxy API and routes to:

```text
model: claude-opus-4-8(xhigh)
base URL default: http://127.0.0.1:8318/v1
endpoint: POST /api/brain-chat
pilot doc: docs/cactus-strudel-opus-pilot.md
history: runtime/cc-bridge/brain-chat-history.jsonl
replies: runtime/cc-bridge/replies.jsonl
backups: runtime/cc-bridge/brain-edit-backups/
```

`runtime/serve.py` reads the API key from either:

- `CLIPROXY_API_KEY` environment variable, or
- `/Users/bowei/Downloads/CLIProxyAPI-MacBook-Air-LAN-API-Key-Usage.md`

Do not print or paste the key into docs or chat. It is local secret material.

The pilot doc is designed to make Opus a "CactusStrudel brain", but current behavior is only partially agentic:

- It can answer music/code questions.
- It has a local fast-path executor for simple filter edits.
- It does not generally apply arbitrary edits unless explicit backend execution logic exists.

Existing local direct actions:

- `lead` low-pass/filter commands can be detected and applied.
- `chords` low-pass/filter commands can be detected and applied.
- The executor backs up, edits JS, renders, and updates manifest.

Current known limitation:

- If Bowei asks Opus to "加大混响", "鼓大一点", etc., the model may reply with a code snippet instead of modifying the live code unless you implement a direct executor for that action or instruct Bowei to use `Save+Render` after manual code edit.
- Bowei explicitly disliked verbose Opus replies that explain too much and do not execute.
- Preferred future behavior: short confirmation + actual code/DAW/corpus update, with backup first.

Recent Opus-related piece:

```text
piece: UI-1779898605
js: producer-brain/pieces/gemini_auto_1779898522536.js
mp3: producer-brain/audio/gemini_auto_1779898522536.mp3
current sha: 398b3612cd20810b
current dur: 63.583188
brain_last_edit: chords.lpf(1200).lpq(1.5)
manual_last_save: 2026-05-28 02:14:36
```

Known edits on `UI-1779898605`:

- `lead` got `.lpf(1800)` and `.lpq(4)`.
- `chords` got `.lpf(1200)` and `.lpq(1.5)`.
- A same-code Save+Render was performed to verify the new save path.

### 7. AGY / Antigravity CLI Generation Path

Main generation mode:

- UI model dropdown defaults/uses `AGY CLI` for generation.
- The server owns queue state, file writes, rendering, and corpus registration.
- AGY is used narrowly as a Strudel code generator.

Important files:

- `runtime/serve.py`
- `docs/agy-strudel-generation-brief.md`
- `scripts/gemini-fetch.ts`
- `producer-brain/prompts/*.txt` per-piece prompt snapshots
- `runtime/cc-bridge/tasks.jsonl`
- `runtime/cc-bridge/.agy-run-task-*.log`

AGY model evidence from earlier verification:

- Antigravity CLI used OAuth consumer auth under Bowei's Gemini Pro subscription plan.
- Verified log labels showed `Gemini 3.5 Flash (High)`.
- Do not infer current AGY model from memory; if asked, inspect fresh `~/.gemini/antigravity-cli/log/cli-*.log`.

Current compact AGY brief:

```text
docs/agy-strudel-generation-brief.md
```

This brief intentionally balances:

- Strudel syntax safety;
- musicality;
- audible drums;
- avoidance of huge overfitted manuals that Gemini follows poorly.

Do not blindly expand it into a huge textbook. Bowei observed that AGY can read large context, but follow-guideline fidelity is weaker than Codex, so dense constraints can backfire.

### 8. Advanced Generation Panel

The Advanced Generation panel was designed to be more preset-first, less hardcore. It lives in `runtime/main.html`.

Preset philosophy:

- Presets first, advanced details expandable.
- Keep Roman numerals for progression identity.
- Put AGY-friendly styles first: house, techno, chillout, four-piece band, city pop, melodic house, etc.
- Avoid making everything "jazz".
- Make it easy to produce pop/smooth progressions like `IV-V-iii-vi-ii-V-I` / "4536251".
- Let user select key/root/mode but keep automatic defaults.
- Include a stable `Surprise Me`.

Current major controls:

- Production preset
- Mood
- BPM
- Key root
- Mode
- Chord progression
- Energy
- Density
- Conventional/experimental
- Variation
- Intent note
- Fine Tune:
  - Arrangement lens
  - Beats/cycle
  - Form
  - Groove feel
  - Palette
  - Drum path
  - Motif clarity
  - Texture
  - Harmonic spice
  - Reharm moves
  - Custom Roman/chord hint

Current preset defaults include:

- `house-pop`
- `techno-drive`
- `chillout`
- `four-piece`
- `city-pop`
- `melodic-house`
- `lofi-hiphop`
- `uk-garage`
- `bossa-lounge`
- `ambient-cinematic`
- `classic-soul`
- `jazz-blues`

Compiled prompt function:

```text
runtime/main.html: buildAdvancedPrompt()
```

Critical drum language currently included in compiled prompt:

```text
- Drum priority: for every non-drumless preset, the beat must be audible as a drum kit.
- Cactus drum reliability: put kick/snare/hat layers directly in each main/drop section stack.
- Do not define const drums = stack(...) and then nest that stack inside another stack or arrange section.
- Avoid satisfying drums with only very short sine/triangle bleeps; use percussive noise snare/hats or sample+fallback.
```

Reason: 080-093 had code-level drums but Bowei could not hear a real drum groove. The problem was not just syntax; it was generation/mix/audibility.

### 9. Corpus State And Listening Lessons

Current corpus:

```text
96 total pieces
60 scored
36 unscored
mean scored: 6.69
top: 038-Chillout = 8.2
latest: UI-1779898605
```

Important score interpretation:

- 080-093 were marked with `generation_issue: inaudible_drums`.
- Bowei scored them low partly because drums were missing or not clearly audible.
- Higher scores among 080-093 often mean non-drum material was promising and could improve significantly with audible drums.

Marked drum-failure group:

```text
080 UI-1779776133 score 6.0
081 UI-1779777819 score 6.0
082 UI-1779778040 unscored
083 UI-1779783976 score 6.8
084 house_pop_4536251 score 7.0
085 melodic_house_minor_6415 score 6.2
086 techno_drive_minor score 6.3
087 chillout_6415 score 6.1
088 four_piece_pop_1564 score 6.0
089 city_pop_4536251 score 6.7
090 uk_garage_minor_pop score 6.1
091 lofi_turnaround_pop score 6.7
092 classic_soul_1645 score 6.2
093 bossa_lounge_minor score 7.0
```

Drum-fix follow-ups:

```text
094 house_pop_4536251_drums score 7.0
095 bossa_lounge_minor_drums score 8.0
```

Interpretation:

- Drum-forward repair improved perceived quality.
- `095` is important: bossa/lounge + explicit audible drums worked well.
- The current "audible kit" guidance is justified by evidence, but continue validating with Bowei's listening, not just code inspection.

### 10. Strudel Syntax Lessons From 062-079 Audit

Codex previously audited 062-079 for official Strudel syntax and renderability. The distilled lessons are in:

```text
docs/agy-strudel-official-brief.md
docs/agy-strudel-generation-brief.md
docs/cactus-strudel-opus-pilot.md
```

Key recurring errors to prevent:

- Invalid invented methods: `.stutter()`, `.subdivide()`, `.mod()`, `.krush()`, `.stut()`, `.quantise()`, `.quantize()`.
- Wrong resonance method: use `.lpq()`, not `.q()`.
- Wrong GM prefix: `gm_`, not `gmm_`.
- Invalid sound names: avoid `"superfm"` and `"pulse"`.
- Invalid chord quality syntax in note patterns: use `chord("Cm9")`, not `note("c3:min9")`.
- Do not put chord symbols in `note(...)`.
- Do not chain `.setcpm(...)` onto a pattern; `setcpm(...)` should be top-level.
- `.arp(...)` string modes can be silent; use numeric indices and ensure the index range fits the voiced stack.
- `.struct(...)` should contain structure (`x`, `~`, grouping, repeats), not sample names.
- Avoid nested drum stacks in Cactus renders if they risk becoming inaudible; put kick/snare/hats directly in main/drop `stack(...)`.

### 11. Prompt Base Current State

Current `PROMPT_BASE` is still in:

```text
scripts/gemini-fetch.ts
```

Current size after state refresh:

```text
3541 chars
```

Backups:

```text
scripts/gemini-fetch.ts.bak.20260524-190114
scripts/gemini-fetch.ts.bak.20260525-132550
scripts/gemini-fetch.ts.bak.20260525-223033
```

History:

- A previous `PROMPT_BASE de-anchor` removed too many concrete examples.
- Bowei felt generation became worse / less musical.
- Later fixes moved more practical producer guidance into `docs/agy-strudel-generation-brief.md` and Advanced Generation compiled prompts rather than stuffing everything into `PROMPT_BASE`.

Current guidance:

- Do not treat the prompt as "done".
- Do not reintroduce one fixed C-minor/jazz/lounge anchor.
- Do not overload AGY with a giant manual in every run.
- Prefer compact, high-leverage constraints plus preset-specific prompt extra.
- Test prompt changes with real generation + Bowei listening. Syntax success is not enough.

### 12. API Surface Cheat Sheet

Common GET:

```text
GET /api/version
GET /api/recent?n=20
GET /api/piece?name=<piece>
GET /api/guideline
GET /api/gf-status
GET /api/cc/state
GET /api/cc/stream
GET /api/chrome-status
```

Common POST:

```text
POST /api/run-gf              # generation, including AGY CLI path
POST /api/score               # score corpus piece
POST /api/save-piece          # old path: save edited code as new piece
POST /api/update-piece-code   # current path: overwrite existing piece + backup + render
POST /api/render              # render JS path
POST /api/midi                # export MIDI
POST /api/rename-piece
POST /api/brain-chat          # right sidebar Opus brain
POST /api/cc/inbox
POST /api/cc/proposal-action
POST /api/cc/task-action
POST /api/cc/kick
POST /api/chrome-start
```

`/api/save-piece` still exists for creating a new piece from arbitrary code. The UI now uses `/api/update-piece-code` for Save+Render.

### 13. Bridge Files

Bridge directory:

```text
runtime/cc-bridge/
```

Files:

- `inbox.jsonl`
- `replies.jsonl`
- `proposals.jsonl`
- `tasks.jsonl`
- `transcript-tail.jsonl`
- `brain-chat-history.jsonl`
- `brain-edit-backups/`
- `.agy-run-task-*.log`

Use `bin/health` to see pending counts. Do not infer state from one JSONL file without checking status fields.

### 14. Rendering And Verification

Render command used by server:

```bash
cd /Users/bowei/CactusStrudel/apps/cli
CACTUS_RENDER_DEFAULT_CYCLES=24 pnpm -s exec tsx src/auto-render.ts /Users/bowei/CactusStrudel/producer-brain/pieces/<file>.js
```

Default behavior:

- AGY continuous loops often use 24 cycles to keep audition time reasonable.
- If code contains `arrange(...)`, renderer can infer/handle explicit length.
- Some older renders are 48+ cycles because older defaults were longer.

Smoke checks after UI/server changes:

```bash
python3 -m py_compile runtime/serve.py
node - <<'NODE'
const fs=require('fs');
const html=fs.readFileSync('runtime/main.html','utf8');
const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
for (let i=0;i<scripts.length;i++) new Function(scripts[i]);
console.log('scripts ok', scripts.length);
NODE
curl -s http://localhost:8765/api/version
```

For real product changes, also open `http://localhost:8765/runtime/main.html` and verify with browser automation or manually:

- page loads;
- recent list loads;
- selected piece loads code and audio;
- Generate / Advanced Generate path still queues and returns;
- Save+Render backs up and updates audio URL with new sha;
- right chat still sends and renders replies;
- no text overlaps at common viewport widths.

### 15. Git / Dirty Worktree

This repo currently has many untracked and modified files; it is not a clean upstream-style repo. Do not run destructive cleanup.

Observed at handoff:

```text
modified tracked examples:
  .gitignore
  apps/cli/src/midi-render.ts
  apps/cli/src/producer-brain-free.ts
  apps/renderer-page/src/main.ts
  packages/renderer/src/index.ts
  producer-brain/failure-spine.jsonl

untracked important surfaces:
  AGENTS.md
  bin/
  docs/HANDOFF.md
  docs/STATE.md
  docs/agy-strudel-generation-brief.md
  docs/agy-strudel-official-brief.md
  docs/cactus-strudel-opus-pilot.md
  gf
  gl
  producer-brain/corpus-2026-05-21.jsonl
  producer-brain/pieces/
  producer-brain/prompts/
  runtime/
  scripts/gemini-fetch.ts
```

Treat untracked files as live project state, not junk. Do not `git clean`, `git reset --hard`, or checkout over user/Codex changes.

### 16. Security / Secrets

Do not expose:

- CLIProxy API key from `/Users/bowei/Downloads/CLIProxyAPI-MacBook-Air-LAN-API-Key-Usage.md`;
- OAuth identity or token contents;
- any local credential files.

It is okay to mention paths and integration shape; do not paste secret values.

### 17. Immediate Recommended Next Moves

If Bowei asks Claude Code to continue product work, the best next deltas are:

1. Make Opus Brain actually execute more common edit intents:
   - `lead room/delay bigger`;
   - `drums louder`;
   - `bass lower/warmer`;
   - `chords softer/darker`;
   - `reduce reverb mud`;
   - all with backup + code edit + render + manifest update.

2. Improve Opus reply style:
   - If edit executed: short "done" + what changed + backup/render receipt.
   - If cannot execute: say exactly why and offer one concrete next action.
   - Avoid long explanatory code snippets unless Bowei asked for explanation.

3. Add a safer code-edit executor:
   - Parse `const lead = ...;`, `const chords = ...;`, `const bass = ...;` blocks.
   - Replace/add whitelisted chained calls.
   - Reject broad rewrites unless routed to manual review.
   - Always backup before write.

4. Improve Advanced Generation's "timbral exploration without chaos":
   - Add a small "Timbre character" preset field rather than freeform chaos.
   - Examples: clean electronic, warm GM keys, airy noise/percussion, pluck + pad, experimental accent only.
   - Keep drums direct and audible.

5. Add a render/listening quality gate:
   - static syntax scan;
   - render existence;
   - optional audio heuristic for drum transient energy;
   - human score remains final.

6. Consider replacing external DAW iframe later:
   - If exact playhead/editor sync matters, use a local Strudel engine/editor surface instead of cross-origin `strudel.cc`.
   - Until then, keep the current local Code + Save+Render path.

### 18. Known User Preferences From Recent Iteration

Bowei explicitly requested/indicated:

- Advanced Generation should be preset-first but expandable.
- More pop/smooth progressions, not over-jazzed.
- Keep chord progression identity in Roman numerals.
- Show key/chord info in small text for confirmation.
- Put AGY-strong arrangement styles first: house, techno, chillout, four-piece/band-like, etc.
- `Generate` is Fast Generation: baseline prompt + simple prompt extra.
- `Generate Advanced` is the compiled Advanced Generation prompt.
- UI should stay dark DAW-panel style, but compact and intuitive.
- Do not let prompt examples silently over-anchor AGY into one style.
- The biggest generation failure recently was "no audible drums".
- The right chat should be action-oriented and user-friendly, not verbose advisory prose.
- Before code edits that change a piece, create a small backup.

### 19. Current "If Something Breaks" Triage

Server down:

```bash
cd /Users/bowei/CactusStrudel
./runtime/serve
```

Port occupied:

```bash
lsof -nP -iTCP:8765 -sTCP:LISTEN
kill <pid>
./runtime/serve
```

Chrome down:

```bash
bash bin/chrome-up
curl -s http://127.0.0.1:9222/json/version
```

AGY run failed:

```bash
tail -n 120 runtime/cc-bridge/.agy-run-task-<id>.log
tail -n 120 ~/.gemini/antigravity-cli/log/cli-*.log
```

Piece won't load:

```bash
curl -s 'http://localhost:8765/api/piece?name=<piece>' | python3 -m json.tool
ls -lh producer-brain/pieces/<file>.js producer-brain/audio/<file>.mp3
```

Save+Render failed:

- Check JSON response `stderr`.
- The handler should restore old JS on render failure.
- Backup remains in `runtime/cc-bridge/brain-edit-backups/`.

### 20. Handoff Boundary

As of this handoff, Codex completed:

- refreshed live state;
- improved right chat rendering;
- implemented Enter-to-send;
- implemented current-piece Save+Render with backup/render/manifest update;
- added workspace Save+Render;
- verified the new save path with `UI-1779898605`;
- kept local server running at `http://localhost:8765/runtime/main.html`.

Claude Code should now treat `docs/HANDOFF.md` + `docs/STATE.md` + live repo checks as the starting truth and continue from Bowei's newest instruction, not from older speculative plans lower in this file.

---

## Variant A — for AIs with local filesystem access

Use this for: Claude Code, Codex CLI, Cursor agent, any terminal-based AI that can read `/Users/bowei/CactusStrudel/`.

```
你是 CactusStrudel 的新操盘 AI，替代之前那个 Claude session。立刻上岗：

1. 读 /Users/bowei/CactusStrudel/AGENTS.md（40 KB 一个 file，5 分钟读完）。
   关键节：§0 总览 · §2 Bowei 协作协议（最重要） · §6 全部接口 · §10 当前状态 · §11/12 已决+待决 · §14 recipes

2. 跑：
   bash /Users/bowei/CactusStrudel/bin/health
   bash /Users/bowei/CactusStrudel/bin/state-refresh
   cat  /Users/bowei/CactusStrudel/docs/STATE.md

3. 回我一条 Brief（最多 6 行）：
   - 一句话：你上岗了 + 你是谁（模型 + 入口）
   - server / corpus / spine / 桥的 1 行状态
   - 你看到最该决断的 1 件未决项
   - 等指令 或 单个澄清问题

之后等我下一句。不要主动 propose 改动、不要回 banner / 不要 process theater / 不要 AI 腔。
Brief first，大白话先，证据导向。pushback 是强信号，别辩护。
```

---

## Variant B — for AIs without local filesystem access

Use this for: web Gemini, Grok web, ChatGPT web, any chat-only AI. Paste the contents of `AGENTS.md` + `docs/STATE.md` inline before the instruction block.

```
[BEGIN AGENTS.md]
<paste full content of ~/CactusStrudel/AGENTS.md here>
[END AGENTS.md]

[BEGIN STATE.md — live snapshot]
<paste full content of ~/CactusStrudel/docs/STATE.md here>
[END STATE.md]

你是新接手 CactusStrudel 的 AI。上面是接手包。回一条 Brief（最多 6 行）：
- 你是谁（模型 + 入口）
- 当前状态摘要（从 STATE.md 抽 1 行）
- 你看到最该决断的 1 件未决项（参考 AGENTS.md §11/§12）
- 等指令 或 单个澄清问题

不要回 banner / 不要 process theater / 不要 AI 腔。Brief first，大白话先，证据导向。
pushback 是强信号，别辩护。
```

To paste content quickly:
```bash
cat ~/CactusStrudel/AGENTS.md ~/CactusStrudel/docs/STATE.md | pbcopy
```

---

## What a good first response looks like

Whichever variant you use, expect the new AI to come back with something like:

```
Brief: 上岗。Codex CLI (claude-opus-4-7-1m 替代为 codex-pro/whatever)，从 /Users/bowei/CactusStrudel 入口。
状态: server ✓, chrome ✓, corpus 36 (29 scored, mean 6.67), spine 19, 桥 0 pending.
最该决断: §12 列了 4 条 style-disguised-as-anti-error rules 已 surfaced 但未拍板执行 rollback。要不要先回滚这 4 条 + 3 条 example 偏置 scrub？
等指令。
```

If you get back a multi-paragraph banner / "I'm excited to help" / process theater / a markdown table of contents — the AI didn't read §2. Re-prompt with: "重读 AGENTS.md §2 然后再回。"

---

## When to use which

- **New AI taking over from current Claude** (most common): Variant A.
- **Asking a second AI for a second opinion** on a specific decision: Variant A + add the specific question after "等指令" line.
- **Backup AI in case primary breaks**: Variant A pre-pasted in a notes app.
- **Demo to someone else** (showing the architecture): Variant B paste-with-content version.

---

## What this prompt deliberately doesn't say

- Doesn't list every API endpoint (AGENTS.md §6 does).
- Doesn't list every footgun (AGENTS.md §13).
- Doesn't recap the spine (AGENTS.md §11 + bin/spine-list).
- Doesn't dictate how to write code (the new AI's style is its own).

All operational specifics are in AGENTS.md and bin/. The prompt's only job is to point + set tone + extract the orientation Brief.

---

## 2026-05-25 Status Supplement & Codex Handover Details

This section documents the latest state as of May 25, 2026, and provides a detailed analysis of the **AGY CLI automation bottlenecks** to help the next agent (Codex) resolve the remaining issues.

### 1. Latest State Summary (Refreshed 2026-05-25)
- **Runtime Server**: `http://localhost:8765` is **UP**. (Source: [serve.py](file:///Users/bowei/CactusStrudel/runtime/serve.py))
- **Corpus**: **39 pieces** (31 scored, 8 unscored). Mean score is **6.76**. Top score is **8.20** ([038-Chillout](file:///Users/bowei/CactusStrudel/producer-brain/pieces/038-Chillout.js)).
- **Spine**: 20 entries (latest: `fs-020 FIXED` rollback of 4 style rules + 3 biases).
- **Chrome Status**: **DOWN** (`chrome ✗` in `bin/health`). Playwright/Chrome debug port `9222` is not attached.

### 2. AGY CLI Mode Automation Bottlenecks & Blocker Analysis

When the user triggers **Generate (AGY CLI 模式)** on the web UI, it writes a `generate-agy` task to `cc-bridge/tasks.jsonl` and spawns:
`agy -p "check inbox strudel" --add-dir /Users/bowei/.agents/skills/check-inbox --dangerously-skip-permissions`

The following bottlenecks/blockers were identified and triaged:

#### A. Path Discovery (FIXED)
- **Issue**: `agy` runs in the repo CWD `/Users/bowei/CactusStrudel`, but the `check-inbox` skill is located externally at `/Users/bowei/.agents/skills/check-inbox`. Without mounting it, `agy` didn't find the skill, prompted for clarification on stdin, and hung.
- **Fix**: Added `--add-dir /Users/bowei/.agents/skills/check-inbox` to the `subprocess.Popen` arguments in [serve.py](file:///Users/bowei/CactusStrudel/runtime/serve.py) to mount the skill directory.

#### B. Stdin Pipe Blocking (FIXED)
- **Issue**: When `agy-bin` runs in a non-TTY environment (e.g. spawned by Python's `subprocess.Popen`), it checks if stdin is a pipe. If it is open, it blocks inside `io.ReadAll(os.Stdin)` waiting for a prompt from stdin. Because `serve.py` did not close stdin or redirect it, `agy-bin` hung forever on `syscall.Read`.
- **Fix**: Added `stdin=subprocess.DEVNULL` to `subprocess.Popen` in [serve.py](file:///Users/bowei/CactusStrudel/runtime/serve.py) to force immediate EOF.

#### C. Internal Go Agent CLI Crashes (ACTIVE BLOCKER for Codex to fix)
- **Issue**: Even with path and stdin fixes, `agy-bin` crashes or exits early. Debug logs in `~/.gemini/antigravity-cli/log/cli-*.log` show that `agy-bin` (jetski Go binary) fails with:
  `Model output error: failed to read file: open /Users/bowei/.gemini/antigravity-cli/brain/<conv-id>/.system_generated/tasks/task-X.log: no such file or directory`
  This is a framework-level file-read sync bug inside the Go agent CLI itself.
- **Goal for Codex**: Fix this internal Go CLI logging/task-reading error, or find a way to run the triage logic (via `python3 /Users/bowei/.agents/skills/check-inbox/scripts/check.py` or `bin/check-inbox`) directly without crashing the CLI.

#### D. Audio Rendering Dependency (ACTIVE BLOCKER)
- **Issue**: Once `agy` successfully triages the queue, it must run `auto-render.ts` to convert the generated Strudel code into an MP3. This requires a running Chrome instance with debugging port `9222` open. Since `chrome ✗` is down, any audio render command will fail or time out.
- **Goal for Codex**: Ensure Chrome is started via `gl` (launcher) or `/api/chrome-start` before attempting rendering.

### 3. Codex Follow-up — 2026-05-25 22:10

- **AGY path repaired**: `runtime/serve.py` no longer asks AGY to self-triage the inbox. The server now owns task state, file writes, render, and corpus registration; AGY is only used for a narrow one-shot Strudel code-generation prompt.
- **Chrome launcher repaired**: `gl` now clears dead `.cactus-gemini-chrome` singleton locks and uses `open -na` so debug Chrome can start alongside normal Chrome. `bin/chrome-up` and `/api/chrome-status` now require `http://127.0.0.1:9222/json/version`, not a loose transient `lsof`.
- **Verified**: health `server ✓ chrome ✓`; renderer smoke produced `/tmp/cactus_strudel_render_smoke.mp3`; `/api/run-gf` with `model=agy-cli` produced `UI-1779718208`, `producer-brain/pieces/gemini_auto_1779718093449.js`, and `producer-brain/audio/gemini_auto_1779718093449.mp3`.
- **Residual note**: `auto-render.ts` uses Playwright headless Chromium, not the Chrome 9222 session. Chrome 9222 is required by the web-Gemini `gf` path (`scripts/gemini-fetch.ts`). AGY ignored the requested 8-cycle shape and emitted a continuous `stack(...)`, so this verification render used the default 48-cycle duration (`101.2s`).

### 4. Detailed Codex Handoff to AGY — 2026-05-25 22:35

This section supersedes the older "ACTIVE BLOCKER" wording above. The old blockers are useful history, but they are no longer the live starting point.

#### Current live state

- `bin/health`: `server ✓  chrome ✓  gf-running 0  corpus 40  inbox-pending 0  proposals-pending 0  kick ·`
- Server: `http://localhost:8765/runtime/main.html`
- Current AGY mode in the UI: model dropdown defaults to `AGY CLI`.
- Current latest corpus item after Bowei's post-de-anchor retry: `UI-1779719570`, `i=40`, `producer-brain/pieces/gemini_auto_1779719513585.js`, `producer-brain/audio/gemini_auto_1779719513585.mp3`, `dur=48.987563`, `sha=3cb24e7bc9243ac3`.
- Important: Bowei's immediate feedback after this de-anchored run was that the new music "开始难听了". Treat the de-anchor as an unvalidated prompt experiment, not an improvement.

#### Code/control changes made by Codex

1. `runtime/serve.py`
   - Replaced the brittle `agy -p "check inbox strudel"` self-triage route with a deterministic local runner.
   - The server now owns:
     - appending `generate-agy` tasks to `runtime/cc-bridge/tasks.jsonl`;
     - marking task `queued -> running -> done/failed`;
     - extracting current `PROMPT_BASE` from `scripts/gemini-fetch.ts`;
     - calling `/Users/bowei/.local/bin/agy -p <narrow prompt> --print-timeout 4m --dangerously-skip-permissions`;
     - extracting one fenced Strudel code block from AGY stdout;
     - writing `producer-brain/pieces/gemini_auto_<ms>.js`;
     - running `apps/cli/src/auto-render.ts`;
     - writing task result `{js, mp3, prompt_snapshot}`;
     - registering the piece in `producer-brain/corpus-2026-05-21.jsonl`.
   - AGY is now only the code generator. It no longer needs to inspect bridge queues, run shell commands, or edit repo files for Generate.
   - Failure logs go to `runtime/cc-bridge/.agy-run-<task-id>.log`.
   - On failed task, `tasks.jsonl` result includes `{error, log}`.

2. `gl` and `bin/chrome-up`
   - Fixed Chrome 9222 false positives.
   - `gl` now:
     - probes `http://127.0.0.1:9222/json/version`;
     - clears dead `.cactus-gemini-chrome/Singleton*` locks;
     - starts a separate Chrome app instance via `open -na "Google Chrome" --args ...`.
   - `bin/chrome-up` now treats Chrome as up only if `/json/version` responds. A transient `lsof :9222` is not enough.
   - `/api/chrome-status` in `serve.py` was updated to use the same real HTTP probe.

3. `apps/cli/src/auto-render.ts` and `serve.py`
   - Added `CACTUS_RENDER_DEFAULT_CYCLES`.
   - Default remains 48 cycles for normal manual/render paths.
   - AGY path sets `CACTUS_RENDER_DEFAULT_CYCLES=24` when AGY emits a continuous `stack(...)` with no `arrange(...)`.
   - If the code contains `arrange(...)`, `auto-render.ts` still parses the arrangement lengths and renders the full explicit structure.
   - Rationale: the two AGY test outputs had no `arrange(...)`, so they rendered 48 cycles and took about 94-101 seconds. The 24-cycle AGY default cuts continuous-loop audition time roughly in half.

#### AGY verification facts

- `UI-1779718208` was generated by `agy -p`, not Codex, and Antigravity logs prove model label `Gemini 3.5 Flash (High)`.
  - Task: `task-1779718076204`
  - AGY CLI log: `~/.gemini/antigravity-cli/log/cli-20260525_220756.log`
  - Evidence lines in that log:
    - `Print mode: starting (promptLength=3248, model="", conversationID="")`
    - `OAuth: authenticated successfully as rduccchs15@gmail.com`
    - `authMethod=consumer`
    - `Propagating selected model override to backend: label="Gemini 3.5 Flash (High)"`
  - Render log: `runtime/cc-bridge/.agy-run-task-1779718076204.log`
  - Output was later deleted at Bowei's request.

- `UI-1779718674` was also generated by AGY CLI / Gemini 3.5 Flash High.
  - Task: `task-1779718548543`
  - AGY CLI log: `~/.gemini/antigravity-cli/log/cli-20260525_221548.log`
  - Render log: `runtime/cc-bridge/.agy-run-task-1779718548543.log`
  - AGY returned code in about 17 seconds; realtime render took about 94 seconds because there was no `arrange(...)` and the then-default was 48 cycles.
  - Output was later deleted at Bowei's request.

#### Deleted test outputs

Bowei asked to delete the two Codex test generations:

- Deleted corpus row `i=40`, `UI-1779718208`
  - deleted `producer-brain/pieces/gemini_auto_1779718093449.js`
  - deleted `producer-brain/audio/gemini_auto_1779718093449.mp3`
  - deleted `producer-brain/prompts/gemini_auto_1779718093449.txt`
- Deleted corpus row `i=41`, `UI-1779718674`
  - deleted `producer-brain/pieces/gemini_auto_1779718565666.js`
  - deleted `producer-brain/audio/gemini_auto_1779718565666.mp3`
  - deleted `producer-brain/prompts/gemini_auto_1779718565666.txt`
- Backup before deletion: `producer-brain/corpus-2026-05-21.jsonl.bak.20260525-223033`

After that deletion, Bowei generated another piece from the UI; that is why current corpus is 40 again. Do not confuse current `i=40 UI-1779719570` with the deleted earlier `i=40 UI-1779718208`.

#### Prompt changes made by Codex

Codex performed a `PROMPT_BASE de-anchor` in `scripts/gemini-fetch.ts`.

Backup before this prompt edit:
`scripts/gemini-fetch.ts.bak.20260525-223033`

What was removed or generalized:

- Removed literal harmony anchor `chord("<Cm9 Ab^7 Fm7 G7>")`.
- Removed literal scale anchor `n("0 2 4").scale("c:minor")`.
- Removed literal note-stack anchor `note("<[c4,eb4,g4] [ab3,c4,eb4]>")`.
- Removed specific GM examples from the prompt text: `gm_pad_warm`, `gm_flute`, `gm_epiano1`, etc.
- Removed specific drum-bank examples from the prompt text: `RolandTR909`, `RolandTR808`, `LinnDrum`, etc.
- Replaced concrete examples with format placeholders:
  - `note("<note pattern>")`
  - `n("<scale degrees>").scale("<root>:<mode>")`
  - `chord("<chord progression>")`
  - `.bank("<valid bank>")`

What was preserved:

- Valid API reference.
- Known anti-error rules:
  - no `$`-prefixed reusable names;
  - `.arp(...)` numeric index patterns only;
  - `.lpq()` not `.q()`;
  - GM prefix is `gm_`, not `gmm_`;
  - no invented methods `.stutter()`, `.subdivide()`, `.mod()`, `.krush()`, `.stut()`, `.quantise()`, `.quantize()`;
  - `"superfm"` is not a valid sound name.
- The lightweight anti-warble lead warning about large bare `.vib(depth)` was preserved, but not the old defensive lead timbre restrictions.

#### Current PROMPT_BASE warning

The current de-anchored prompt is not validated. Bowei suspects it made music worse. The likely failure mode is that removing all concrete examples removed too much musical prior, leaving AGY/Gemini with syntactically safe but aesthetically weaker or more generic choices.

Do not treat "de-anchor" as the final design. Better next moves for AGY:

1. Compare current de-anchored prompt against backup `scripts/gemini-fetch.ts.bak.20260525-223033`.
2. Preserve anti-error constraints, but reintroduce musical priors as diverse non-binding options instead of one C-minor lounge example.
3. Avoid one fixed chord progression, one fixed key, one fixed pad/flute/e-piano palette, and one fixed 808/909/Linn drum palette.
4. Consider a rotating or self-selected style brief: e.g. "choose one distinct idiom and commit to it", with no named default progression.
5. Run at least N=3 before calling any prompt change validated. Bowei's ear score owns truth; a clean render is only harness success.

#### Fast rollback options

- Full rollback to pre-de-anchor prompt:
  ```bash
  cp /Users/bowei/CactusStrudel/scripts/gemini-fetch.ts.bak.20260525-223033 /Users/bowei/CactusStrudel/scripts/gemini-fetch.ts
  ```
- Then regenerate state:
  ```bash
  bash /Users/bowei/CactusStrudel/bin/state-refresh
  ```

If AGY edits prompt again, create another backup first. Do not delete `scripts/gemini-fetch.ts.bak.*` or the corpus backup.
