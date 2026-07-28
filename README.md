# CactusStrudel

CactusStrudel is Bowei’s local Strudel producer workspace: generate independent
first shots, listen to immutable rendered revisions, score the exact audio, and
use an Agent Brain to inspect evidence or create reversible work.

[Open Studio](http://127.0.0.1:8765/studio)

## Product loop

1. Write a musical brief.
2. Generate 1, 2, or 4 independent candidates.
3. Listen and compare exact revisions with the global transport.
4. Score the exact revision and audio currently auditioned from 0–10.
5. Ask Brain for evidence or a reversible preview.
6. Promote only when the human chooses.

The validator proves that source and rendered assets are usable. Bowei’s ear is
the only music-quality gate.

## Start

```bash
runtime/serve
bin/health
bin/recent 10
```

Generate and score:

```bash
bin/gen 2 --profile gemini-pro "human musical brief"
bin/score <piece-name-or-id> 7.8 "listening note"
```

## Architecture

```text
Producer UI
  → local /api/v2
      → durable generation / Brain jobs
      → canonical SQLite + immutable revision assets
      → direct native CLIProxy /v1
      → deterministic validator → faithful realtime renderer
```

| Area | Location |
|---|---|
| UI | `apps/producer-ui/` |
| HTTP/application | `runtime/serve.py`, `runtime/v3_api.py` |
| truth layer | `runtime/v3/` |
| Agent/Brain | `runtime/agent/` |
| render worker | `apps/render-worker/` |
| renderer | `packages/renderer/`, `apps/renderer-page/` |
| runtime data | `~/.cactus-strudel/v3/`, `producer-brain/assets/` |

## Developer entry

- Agents: read [AGENTS.md](AGENTS.md), then run `bin/catch-up [area]`.
- Documentation map: [docs/README.md](docs/README.md).
- Current generated state: [docs/STATE.md](docs/STATE.md).
- Full verification: `scripts/verify-repo.sh`.

Historical implementations and generated research artifacts are isolated under
`archive/`; they are not alternate operating surfaces.
