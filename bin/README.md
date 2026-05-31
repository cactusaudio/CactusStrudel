# CactusStrudel — bin/

POSIX bash wrappers around the runtime API + on-disk state. Built so any AI (Claude / Codex / DeepSeek / Gemini CLI / Grok) can drive CactusStrudel via plain shell, no special tools needed. Every action documented in `AGENTS.md §6.3` has a script here.

All scripts:
- Depend on `curl` + `python3`. `jq` is optional (graceful fallback).
- Run from anywhere (use absolute paths internally).
- Take `--help` for usage.
- Refuse to make destructive changes silently — they print what they did.
- Server URL is hardcoded `http://localhost:8765`.

## Index

| Script | Purpose |
|---|---|
| `health` | server + Chrome + bridge state in one line |
| `peek [N]` | last N corpus entries + latest task/proposal/inbox |
| `recent [N]` | list last N pieces with scores |
| `piece <name>` | print entry + code + prompt snapshot for a piece |
| `gen [model] [extra]` | fire a generation, wait for done event |
| `score <name> <num> [note]` | score a piece via API |
| `midi <name>` | export MIDI for a piece → `~/Downloads/<name>.mid` |
| `guideline-get` | print current PROMPT_BASE |
| `guideline-put <file>` | replace PROMPT_BASE (auto-backup before overwrite) |
| `rollback-guideline <bak-suffix>` | restore PROMPT_BASE from a backup |
| `spine-list [status]` | list spine entries, optionally filtered by status |
| `chrome-up` | ensure Chrome :9222 is up, launch if not |
| `check-inbox` | quick all-queues dump for terminal review |
| `state-refresh` | regenerate `docs/STATE.md` |

## Adding a new script

Keep them small (<60 lines). Use `set -euo pipefail`. Print one line per action. Document in this README.
