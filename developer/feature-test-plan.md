# Cactus Strudel — full feature manifest & brain test plan

> Goal: every UI feature must be reachable via chat with brain.
> Each row: feature → brain tool (or gap) → test prompt → success criterion.

## Status legend
- ✅ tool exists, tested OK
- ⚠ tool exists, untested or partial
- ❌ NO tool — need to add
- 🔧 in repair

---

## A. Workbench (main.html)

| # | Feature | Brain tool | Chat test prompt | Pass criterion |
|---|---|---|---|---|
| A1 | Generate piece via slot | `generate_piece` async | "用 GPT 5.5 生成一首 dub techno, BPM 120, 暗暗的" | corpus +1, preset=dub-techno |
| A2 | Cancel running generation | ❌ no tool | "取消我正在跑的 generation" | (need `cancel_gen` tool) |
| A3 | Pick a backend slot | implicit in generate_piece | "用 Gemini Pro 生成一首 ambient" | corpus +1 with source=gemini-pro |
| A4 | Read piece's Strudel code | `get_piece_code` ✅ | "给我看 CHP-001 的代码" | reply quotes JS |
| A5 | Save+Render code (edit existing piece's code) | ❌ no tool | "把 CHP-001 的鼓 gain 调高到 1.1" | piece updated + re-rendered |
| A6 | Save edited code as NEW piece | ❌ no tool | "基于 CHP-001 改个 fork, snare 加 room" | new piece created |
| A7 | Open piece (workbench load) | n/a (UI-only) | — | — |
| A8 | MIDI export | ❌ no tool | "导出 CHP-001 的 MIDI" | (need `export_midi`) |
| A9 | Score piece | `score_piece` ✅ | "给 CHP-001 打 7.5 分, note: 鼓干净" | score+note set |
| A10 | Update piece's note | `update_piece_note` ✅ | "改一下 CHP-001 的 note: '试听 5 遍'" | note updated |
| A11 | Stop all audio (DAW clear) | n/a (UI-only) | — | — |
| A12 | Edit code in DAW (strudel.cc iframe) | n/a (UI-only) | — | — |
| A13 | Mix sliders per-track | ❌ no tool (could be guided edit) | "把 CHP-001 的 bass gain 调成 0.8" | edit applied |
| A14 | Algorave mode | implicit in extras | "生成一首 algorave 模式" | corpus +1 with algorave flag |
| A15 | Workspace view toggle (Adv/DAW) | n/a (UI-only) | — | — |
| A16 | A/B slot snap | n/a (UI-only) | — | — |
| A17 | Read kernel fragment | `read_kernel_fragment` ✅ | "看一下 40-creative-freedom.md 写了啥" | reply quotes content |
| A18 | Edit kernel fragment | `dev_write_file` (sandbox blocks) | "在 kernel/40-creative-freedom.md 末尾加一句 X" | (needs override) |
| A19 | Recent list refresh | `list_recent` ✅ | "最近 10 首" | reply lists 10 names |

## B. Chat (right sidebar)

| # | Feature | Brain tool | Test | Pass |
|---|---|---|---|---|
| B1 | Send chat message | (this is the chat itself) | — | — |
| B2 | Tools tab — inbox messages | n/a | — | — |
| B3 | Proposals tab — view + accept/reject | ❌ no tool | "看 inbox 里最新 proposal" | (need `list_proposals` + `decide_proposal`) |
| B4 | Tasks tab — task queue | ❌ no tool | "看 task queue" | (need `list_tasks`) |
| B5 | Commands tab — preset CC commands | ❌ no tool | "运行 spine-scan preset 命令" | (need `run_preset_command`) |
| B6 | Live tab — Claude Code transcript | n/a (read-only) | — | — |
| B7 | Attach current piece context | implicit (`context` arg) | — | — |

## C. Catalog / Data page (data.html)

| # | Feature | Brain tool | Test | Pass |
|---|---|---|---|---|
| C1 | List/browse all pieces | `list_recent`/`search_corpus` ✅ | "列 corpus 里所有 dnb 的歌" | reply lists DB-* |
| C2 | Free-text search | `search_corpus` ✅ | "搜 corpus 里的 lo-fi" | reply lists matching |
| C3 | Filter by category | implicit via search | "看所有 jazz-electronic 类的" | reply lists CHP/LH/JH/BKB |
| C4 | Filter by model/source | implicit via search | "看 Opus 4.7 生成的所有 piece" | reply lists opus-4.7 |
| C5 | Sort (score/time/name) | `list_recent` sort | "按 score 高到低列前 5" | reply ordered by score |
| C6 | Open piece detail (code/prompt/revisions) | get_piece_code + ⚠ no prompt/revisions tools | "看 CHP-001 的 code + prompt" | code quoted; prompt missing |
| C7 | Read piece prompt | ❌ no tool | — | (need `get_piece_prompt`) |
| C8 | Read piece revisions | ❌ no tool | — | (need `get_piece_revisions`) |
| C9 | Score piece (catalog) | `score_piece` ✅ | "给 DB-001 打 6.5" | score updated |
| C10 | Note (catalog) | `update_piece_note` ✅ | — | — |
| C11 | Rename piece | ❌ no tool | "把 UN-002 重命名为 EXP-001" | (need `rename_piece`) |
| C12 | Archive piece | `archive_piece` ✅ | "归档 UN-002" | archived_at set |
| C13 | Permanent delete | ❌ no tool | "永久删除 UN-002" | (need `delete_piece` w/ 2-stage confirm) |
| C14 | Download piece audio | n/a (HTTP file) | — | — |
| C15 | Hero stats | n/a | "corpus 现在多少 pieces / mean score / top piece" | reply states totals |
| C16 | View Research Trajectory cards | n/a (UI display) | "每个 category 里多少 piece" | reply tabulates |
| C17 | View archive-v0 (104 frozen) | ⚠ no archive-specific tool | "看 archive-v0 里第一首" | (need `get_archived_piece`?) |
| C18 | Click piece → jump to workbench (deep-link) | n/a (UI nav) | — | — |

## D. Spine (spine.html)

| # | Feature | Brain tool | Test | Pass |
|---|---|---|---|---|
| D1 | List spine entries | `list_spine` ✅ | "列所有 spine 条目" | reply lists fs-* |
| D2 | Filter by status | `list_spine` w/ status arg ✅ | "列所有 validated 的 spine" | reply filtered |
| D3 | Search spine | ⚠ via list_spine (no q arg) | "spine 里关于 kick 的有几条" | (need `q` param in list_spine) |
| D4 | Add new spine entry | `add_spine_entry` ✅ | "记一条 spine: 听 X 时 Y" | new fs-N entry |
| D5 | Update spine status | `update_spine_status` ✅ | "fs-021 改成 fixed" | status changed |
| D6 | Browse archive-v0 spine (20 frozen) | ⚠ no archive tool | "看 archive-v0 spine 里 fs-005" | (need `get_archived_spine`?) |
| D7 | Cross-link piece ↔ spine | (regex render-time) | "spine fs-016 引用了哪些 piece" | reply lists pieces |

## E. Settings (settings.html)

| # | Feature | Brain tool | Test | Pass |
|---|---|---|---|---|
| E1 | View backend availability | ❌ no tool | "7 个 backend 各自状态" | (need `get_backends`) |
| E2 | Set CLIProxy key/URL | ❌ no tool | "把 CLIProxy URL 改成 X" | (need `update_settings`) |
| E3 | Test backend connectivity | ❌ no tool | "测一下 OpenAI 连不连得上" | (need `test_backend`) |
| E4 | Set vendor key (OpenAI/Anthropic/Google/xAI) | ❌ no tool | "设 Anthropic key 为 X" | (need `update_settings`) |
| E5 | Set AGY binary path | ❌ no tool | "AGY 在 ~/local/bin/agy" | (need `update_settings`) |
| E6 | Set default slot | ❌ no tool | "默认 slot 改 Opus 4.7" | (need `update_settings`) |
| E7 | Set validator mode | ❌ no tool | "validator 改成 off" | (need `update_settings`) |
| E8 | Toggle dev mode / write override | ❌ no tool | "关掉 dev mode" | (need `update_settings`) |
| E9 | Set brain chat model | ❌ no tool | "brain 用 gpt-5.5" | (need `update_settings`) |
| E10 | Set CC session dir | ❌ no tool | "session_dir 改成 X" | (need `update_settings`) |

## F. Backend dev (Developer Mode tools)

| # | Feature | Brain tool | Test | Pass |
|---|---|---|---|---|
| F1 | Read any repo file | `dev_read_file` ✅ | "看 runtime/serve.py 第 100 行" | reply quotes |
| F2 | List directory | `dev_list_dir` ✅ | "看 producer-brain/kernel/ 里有啥" | reply lists |
| F3 | Sandboxed write (developer/, producer-brain/) | `dev_write_file` ✅ | "在 developer/notes.md 写一行" | file written |
| F4 | Software-source write | `dev_write_file` (gated) | "改 settings.html" | refused unless override |
| F5 | Bash exec | `dev_run_bash` (gated) | "ls runtime/" | refused unless override |
| F6 | Create checkpoint | `dev_create_checkpoint` ✅ | "建个 ckpt-test-x" | ckpt dir created |
| F7 | Surgical patch | `dev_apply_patch` ✅ | "在 developer/notes.md 把 X 改成 Y" | applied |

## G. Persistent state / memory / planning

| # | Capability | Mechanism | Test | Pass |
|---|---|---|---|---|
| G1 | Recall prior conversations | brain-chat-history (24 turns) | "我刚才让你做啥" | brain quotes recent user msg |
| G2 | Persistent scratchpad | `developer/brain-scratchpad.md` (writable via dev_write_file) | "在 scratchpad 记 X，下次提醒我" | file written |
| G3 | Multi-step planning state | ❌ no dedicated tool | "做一个 5 步计划，先写下来" | (need `set_plan` + `get_plan`) |
| G4 | Read own pilot doc | `dev_read_file` ✅ | "你的 pilot doc 怎么定义你" | reply quotes |
| G5 | Read this manifest | `dev_read_file` ✅ | "看 developer/feature-test-plan.md" | reply quotes |

---

## Gap summary — ALL CLOSED (2026-05-29)

**Missing tools added (Phase 3) — all live in `runtime/serve.py` `BRAIN_TOOLS`:**
1. ✅ `cancel_generation` — cancels queued/running brain gen jobs
2. ✅ `update_piece_code` — edit existing piece's code + re-render
3. ✅ `save_piece_as_new` — fork a piece (parent lineage set)
4. ✅ `export_midi` — runs `midi-export.ts`
5. ✅ `rename_piece` — renames js/mp3/prompt files + corpus entry
6. ✅ `delete_piece` — 2-stage confirm (confirm==name)
7. ✅ `get_piece_prompt` — reads prompt sidecar
8. ✅ `get_piece_revisions` — revisions.jsonl filtered by piece
9. ✅ `list_proposals` + `decide_proposal` — CC bridge proposal queue
10. ✅ `list_tasks` — task queue
11. ✅ `run_preset_command` — fires configured CC presets
12. ✅ `get_archived_piece` — reads archive-v0 entry by name
13. ✅ `get_archived_spine` — reads archive-v0 spine entry by id
14. ✅ `list_spine` — added `q` (search) arg
15. ✅ `get_backends_status` — returns /api/backends data
16. ✅ `update_settings` — PUT settings sub-section
17. ✅ `test_backend` — backend connectivity probe
18. ✅ `set_plan` / `get_plan` — multi-step planning state (`developer/brain-plan.json`)

**Persistent memory + planning:**
- ✅ `read_scratchpad` / `append_scratchpad` (`developer/brain-scratchpad.md`)
- ✅ `set_plan` / `get_plan` survive chat-history truncation
- ✅ Pilot doc (`docs/cactus-strudel-opus-pilot.md`) now documents the full tool surface + a "use the scratchpad at the start of complex tasks" workflow.

**Two structural fixes that made all this actually work via chat:**
- **Concurrent render** (`apps/cli/src/auto-render.ts` + `packages/renderer/src/index.ts`):
  removed shared `/tmp/auto.wav` and fixed-port-5173 collisions so the brain's
  3-way async generation lands reliably (was `auto-render failed (exit 1)`).
- **Confabulation guard** (`runtime/serve.py` `_api_brain_chat`): if the brain
  answers a state question / claims a mutation with ZERO tool calls, it's forced
  to retry with a real tool call. Killed the "已打分 7.2。 / Inbox 无 proposal。"
  fabrication class. See `developer/brain-capability-evidence.md`.

**Evidence:** `developer/brain-capability-evidence.md` (per-feature chat transcripts + verdicts).
