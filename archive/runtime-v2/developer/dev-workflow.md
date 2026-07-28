# Dev workflow (Developer Mode)

How to make changes safely. This is the playbook Claude Code (your peer) uses.

## Core loop

```
1. CHECKPOINT   bash bin/checkpoint-create N-name "<description>"
2. READ         understand the state before editing (Read file, grep, list dir)
3. EDIT         atomic surgical changes (one concern per edit)
4. SMOKE        py_compile, restart server, curl key endpoints
5. CHECKPOINT   bash bin/checkpoint-create N+1-name "<change summary>"
6. NOTE         append entry to developer/recent-decisions.md
7. REPORT       reply to Bowei: what changed, what to verify
```

Skip checkpoints only for purely cosmetic CSS tweaks. Otherwise: ALWAYS
bracket substantive work with pre + post checkpoints.

## Pre-checkpoint discipline

Before editing serve.py, BACKEND_REGISTRY, kernel compiler, settings schema,
nav structure, brain tool surface, or any persistence format:

```bash
bash bin/checkpoint-create <N>-pre-<task> "Pre-snapshot before <one-line>"
```

Why: rollback path stays clean. `producer-brain/checkpoints/N/rollback.sh`
restores EXACT state if the change goes sideways.

## Reading before editing

Don't write into an unfamiliar file blind. The cost of one wasted Read tool
call is tiny vs the cost of stepping on something.

```
1. grep for the symbol you're touching
2. Read the surrounding 20 lines minimum
3. Check file-map.md if you're unsure who owns this file
4. Cross-reference conventions.md if it's a new pattern
```

## Atomic surgical edits

ONE concern per Edit. If a change touches 3 unrelated things, do 3 edits.
That way a partial revert is possible.

For substantive multi-file changes:
- Phase the work as PHASE A → B → C in TaskCreate
- Smoke after each phase
- Checkpoint after each phase if the system is in a working state

## Smoke testing

After any serve.py change:

```bash
# 1. syntax
python3 -m py_compile /Users/bowei/CactusStrudel/runtime/serve.py

# 2. restart
pid=$(lsof -nP -iTCP:8765 -sTCP:LISTEN -t 2>/dev/null | head -1)
[ -n "$pid" ] && kill "$pid" && sleep 1
python3 /Users/bowei/CactusStrudel/runtime/serve.py >/tmp/cactus-serve.log 2>&1 & disown
sleep 2

# 3. health
curl -s http://localhost:8765/api/version
curl -s http://localhost:8765/api/backends | python3 -m json.tool | head -25
curl -s http://localhost:8765/api/setup-status

# 4. (if you touched generation) end-to-end via brain or /api/generate
```

For UI changes:
```bash
curl -s -o /dev/null -w "main=%{http_code} data=%{http_code} spine=%{http_code} settings=%{http_code}\n" \
  http://localhost:8765/runtime/main.html \
  http://localhost:8765/runtime/data.html \
  http://localhost:8765/runtime/spine.html \
  http://localhost:8765/runtime/settings.html
```

Manual browser-side verification: just say "刷新 X.html 看一下" and let
Bowei verify visually.

## Tool delegation

Use subagents (`Agent` tool) when:
- You need to audit a large codebase area (>5 files) — dispatch general-purpose
- You need to research a specific question — dispatch general-purpose with focused prompt
- The task is parallelizable into independent investigations

Don't dispatch when:
- Single targeted lookup (just grep)
- The task is short
- You'll need the raw exploration output yourself

## Safe operations vs dangerous ones

### Safe (no permission needed)
- `Read` any file in ROOT
- `Edit` files in runtime/, docs/, developer/, bin/
- `Bash` for: grep, find, ls, cat, curl, python3, tar (within tmp/repo), pnpm
- `Write` new files in developer/, docs/
- Append to `developer/brain-scratchpad.md`
- Create checkpoints
- Update `developer/recent-decisions.md`

### Ask before
- `Edit` any user_config.py default
- `Edit` BACKEND_REGISTRY (changes contracts)
- `rm` of producer-brain/* or developer/* files
- Any change to corpus.jsonl format
- Cross-Mac rsync to mbp / Mac-Studio
- Creating a new tar bundle

### NEVER
- `sudo` anything
- `git push` to remote (local commits are OK if Bowei asks; pushing is not)
- Force-push to main/master
- `chmod` outside of installer-related files
- Touch `~/.claude/` (Claude Code's own state)
- Edit `~/.cactus-strudel/config.json` directly (API keys live there — use the API)
- Delete checkpoints
- Touch `.git/`

## When you don't know what to do

```
1. Append a "STUCK:" entry to developer/brain-scratchpad.md
2. Report to Bowei: "I want to do X but [specific concern].
   Options: A) ... B) ... C) ... — which?"
3. Wait for his reply
```

Bowei prefers an "I'm stuck on this specific decision" question over either
silent attempt or vague concern.

## After finishing

```
1. Final smoke test
2. bash bin/checkpoint-create N-name "<short summary>"
3. Append to developer/recent-decisions.md
4. Reply to Bowei in chat:
   - What changed (1-2 sentences)
   - Where (file:line)
   - What to verify (1 specific action)
   - Any decisions he should make
```

Terse, honest, evidence-based. Bowei reads quickly — don't bury the verdict.
