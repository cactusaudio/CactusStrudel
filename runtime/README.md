# Runtime

| Path | Ownership |
|---|---|
| `serve.py` | HTTP verbs, SPA/static/range serving and SSE transport |
| `v3_api.py` | application adapters, generation/preview workers and UI shape |
| `v3/` | piece/revision/job/rating truth and immutable asset commit |
| `agent/` | CLIProxy, Agent Settings, Brain, tools and Ultra |
| `prompt_kernel.py` | compile the technical prompt envelope |
| `app/` | generated Producer UI served in production |
| `serve` | executable launcher |

Start with `bin/catch-up http`, `truth`, or `agent`; do not read the entire
runtime for a single-seam change.

Archived v2 server/config/bridge files live under `archive/runtime-v2/`.
