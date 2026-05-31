# developer/ — Brain's knowledge base for Developer Mode

This folder is the Brain's working memory when Developer Mode is enabled in
Settings. It contains everything the Brain needs to act as a peer platform
engineer alongside (or in place of) the human Claude Code instance.

**Default mode** (Developer Mode OFF): Brain is restricted to producer-brain
data layer (corpus, spine, scoring, generation). Cannot touch repo source.

**Developer Mode** (toggle in Settings): Brain gains read+write+bash access
across the whole repo. Same permissions Claude Code has. Use with intent.

## Index

| File | What's in it | When to read |
|---|---|---|
| [README.md](README.md) | This index | Always first |
| [architecture.md](architecture.md) | High-level system layout: runtime / producer-brain / backends / dispatch logic | Before any architectural change |
| [file-map.md](file-map.md) | File-by-file what it does, what it owns | Before editing any unfamiliar file |
| [conventions.md](conventions.md) | Coding/UX/visual conventions enforced across the repo | Before writing new code or UI |
| [recent-decisions.md](recent-decisions.md) | Sprint history (ckpt 16-34) — what changed and why | Before reverting or re-doing |
| [dev-workflow.md](dev-workflow.md) | Safe-change workflow: checkpoint → edit → smoke → ckpt | Every time you make a substantive change |
| [known-issues.md](known-issues.md) | Bugs that came up + fixes that worked, gotchas to avoid | Before reaching for `sudo` or `pnpm install` |
| [cross-mac-context.md](cross-mac-context.md) | Mesh layout (mac/mbp/Mac-Studio), CLIProxy ports, ssh targets | Before any cross-Mac operation |
| [brain-vs-dev.md](brain-vs-dev.md) | Explicit boundary between music role and platform role | When unsure if a task is yours |
| [packaging-quick-reference.md](packaging-quick-reference.md) | TL;DR of docs/PACKAGING.md + caveats from real deploys | Before building a bundle / installer |
| [brain-scratchpad.md](brain-scratchpad.md) | Your own working notes — append freely | During multi-turn long tasks |

## Quick triage

User asks for X — which file tells you how?

| User asks | Read first |
|---|---|
| "fix this bug" | known-issues.md → file-map.md → conventions.md |
| "add a new endpoint" | architecture.md (endpoint table) → conventions.md → dev-workflow.md |
| "refactor X" | recent-decisions.md (was this just done?) → dev-workflow.md (ckpt first!) |
| "deploy this to mbp" | cross-mac-context.md → packaging-quick-reference.md |
| "is this a brain task or your task" | brain-vs-dev.md |
| "what's the architecture" | architecture.md |
| "where is X" | file-map.md |

## Authority boundary (Developer Mode)

Even with Developer Mode ON, **you still don't have authority to**:
- Run `sudo` or any system-level installs (xcode-select, brew without explicit ask)
- `git push` to remote (`git push` to LAN/local origins is fine)
- Force-push to main/master anywhere
- Edit `~/.cactus-strudel/config.json` directly (it has API keys — would be a leak path)
- Write outside ROOT (`/Users/bowei/CactusStrudel/`) or `/tmp/`
- Initiate `bash ~/.claude/skills/mesh/mesh.sh sync` (could cause cross-Mac sync mess; alert Bowei)
- Touch `~/.claude/` (the Claude Code state for the human side)

When in doubt: **append to `brain-scratchpad.md` and ask Bowei in chat reply**
rather than execute.

## When you finish a non-trivial change

1. Append a one-paragraph entry to `recent-decisions.md`.
2. Create a checkpoint via `bash bin/checkpoint-create <name> "<description>"`.
3. Update `brain-scratchpad.md` if there are open follow-ups.
4. Report concisely to Bowei: what changed, what to verify, any decisions he should make.
