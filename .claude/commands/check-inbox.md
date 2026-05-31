---
description: Read CactusStrudel web-side cc-bridge inbox/proposals/tasks; surface what needs Claude Code attention; act on Bowei's web actions.
---

# /check-inbox — CactusStrudel cc-bridge

You are the brain behind the CactusStrudel web UI. Bowei interacts with the web (`http://localhost:8765/runtime/main.html`); his messages, accepted proposals, task triggers, and command-panel clicks land as jsonl files in `runtime/cc-bridge/`. Web doesn't drive itself — when Bowei wants you to act on web-side state, he types `/check-inbox` in this terminal.

## What to do when invoked

1. **Read all 4 queues at once**:
   ```
   runtime/cc-bridge/inbox.jsonl       — Bowei's messages to you (status pending/seen/done)
   runtime/cc-bridge/proposals.jsonl   — your past proposals + Bowei's accept/reject decisions
   runtime/cc-bridge/tasks.jsonl       — task queue (queued/running/done/cancel_requested)
   runtime/cc-bridge/.kick             — if exists, web nudged you; consume + delete after handling
   ```

2. **Triage**:
   - **New inbox entries** (status=pending): read context (current piece name, code excerpt if attached), reply in `replies.jsonl` with a free-text response, mark inbox entry status=seen (rewrite jsonl). If the message implies action (e.g., "fix the lead in FLASH-05"), enqueue a task too.
   - **Newly accepted proposals** (status=accepted, no `executed_at`): execute the committed action (e.g., guideline patch — use PUT /api/guideline; or trigger a batch-N generate), set executed_at + executed_result. Newly rejected: respect it; don't propose the same thing again next session.
   - **cancel_requested tasks**: mark cancelled.
   - **`generate-agy` tasks** (status=queued):
      1. Immediately rewrite `tasks.jsonl` marking the task status="running", started_at="<current-ts>".
      2. Read `scripts/gemini-fetch.ts` to retrieve the current `PROMPT_BASE`.
      3. Compose a high-quality, creative Strudel piece yourself as the generator (following the `PROMPT_BASE` rules + the task `body` as `PROMPT_EXTRA`).
      4. Write the code to `producer-brain/pieces/gemini_auto_<ts>.js` (where `<ts>` is current timestamp in milliseconds).
      5. Render the audio to mp3 by executing: `pnpm -C apps/cli exec tsx src/auto-render.ts /Users/bowei/CactusStrudel/producer-brain/pieces/gemini_auto_<ts>.js`.
      6. Rewrite `tasks.jsonl` marking the task status="done", ended_at="<current-ts>", and result={"js": "producer-brain/pieces/gemini_auto_<ts>.js", "mp3": "producer-brain/audio/gemini_auto_<ts>.mp3", "prompt_snapshot": "<exact PROMPT_BASE contents used>"}.

3. **If you have a new proposal to make** (e.g., spotted a recurring failure, want guideline change, suggest stems split, etc.):
   Append to `proposals.jsonl`:
   ```json
   {"id":"prop-<ms>","ts":"<iso>","title":"...","body":"...","diff":"...","status":"pending"}
   ```
   `diff` is a unified diff or before/after pair; Bowei sees + clicks accept/reject in web.

4. **Reply format** (in `replies.jsonl`):
   ```json
   {"id":"rep-<ms>","ts":"<iso>","in_reply_to":"in-<ms>","text":"...","attached_piece":"<name>?"}
   ```
   Keep replies terse, evidence-first. If you ran tools to investigate, summarize what you found, not the tool output. Web renders this as inline assistant message.

5. **Logging**: every action you take from /check-inbox, also append a transcript-friendly note so the web's "what is CC doing" panel shows it (just normal tool use + assistant text — the watcher picks it up automatically).

## Conventions

- Read with `Read` (cap=100 lines is fine), rewrite with `Write` for the full jsonl.
- Don't poll across multiple /check-inbox calls; finish the current queue in one pass.
- If queue is empty or all-done, say "inbox clean" + show last 3 transcript entries so Bowei knows you looked.
- Bowei's "main brain in terminal" principle: he expects you in terminal between web-side actions. /check-inbox is a manual handoff — no daemon, no polling.
- Heavy actions (batch-N generate, full corpus analysis) must enqueue a `task` first, run it, update task status, then reply.

## Quick endpoints (reference)

| op | endpoint |
|---|---|
| read full state | `GET http://localhost:8765/api/cc/state` |
| post reply | append to `cc-bridge/replies.jsonl` (no endpoint — direct file write) |
| guideline patch | `PUT http://localhost:8765/api/guideline` body `{"prompt_base":"..."}` |
| trigger gf | shell `/Users/bowei/CactusStrudel/gf` with env `GEMINI_MODEL`, `PROMPT_EXTRA` |
| read piece code | `GET /api/piece?name=X` |

Start by reading all 4 bridge files (+ check .kick), then triage.
