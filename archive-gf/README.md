# archive-gf — frozen web-Gemini scraping path (decommissioned 2026-05-28)

This directory holds the **frozen** "gf path" code. Previously the runtime had two
generation backends:

1. **`agy-cli`** — calls the local Antigravity CLI binary (`/Users/bowei/.local/bin/agy`)
   as a subprocess, harness-style. The CLI uses an OAuth login session against
   the real Antigravity (Google) backend. Returns Strudel code via stdout.
2. **`gf` (web-Gemini scraping)** — wraps `pnpm exec tsx scripts/gemini-fetch.ts`,
   which drives a headless Chrome session through the public Gemini chat UI to
   harvest model output. Required `Chrome --remote-debugging-port=9222` running.

The `gf` path was decommissioned on 2026-05-28 because:

- The AGY CLI path is materially better (faster, no Chrome dependency, no scrape brittleness).
- We are introducing a third backend — **direct CLIProxy API key** mode — that calls
  `http://mac.local:8318/v1/chat/completions` (OpenAI-compatible) with a Bearer token.
  See `/Users/bowei/Downloads/CLIProxyAPI-MacBook-Air-LAN-API-Key-Usage.md`.
- Keeping the scrape path adds N-of-3 model branches without the value to justify.

The new runtime backend abstraction has just two slots:

- `agy-cli`  — current, default
- `cliproxy-api` — future (stub in `runtime/serve.py` `_api_run_cliproxy`)

## Files

- `gf`              — original zsh wrapper that called `gemini-fetch.ts` then `auto-render.ts`
- `gemini-fetch.ts` — TypeScript scraper that drove headless Chrome through the Gemini UI
- `gemini-fetch.ts.bak.*` — historical PROMPT_BASE snapshots from each guideline edit

## Restoring (do NOT unless explicit reason)

The serve.py `/api/run-gf` endpoint was renamed to `/api/generate` and the web-Gemini
branch deleted. A revival would need to:

1. Re-add `GF`/`FETCH` path constants and `_gf_jobs` registry to serve.py
2. Re-add a `web-gemini-scrape` backend in the backend registry
3. Restore the `#model` dropdown options in `runtime/main.html`
4. Move these files back to `gf` and `scripts/gemini-fetch.ts`

See `producer-brain/checkpoints/16-pre-severe-six-fix/` for the pre-archive snapshot.
