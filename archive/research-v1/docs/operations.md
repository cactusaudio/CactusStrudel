# CactusStrudel v3 operations

The live product is the local Producer UI and `/api/v2` runtime.

## Start

```bash
runtime/serve
```

Open `http://127.0.0.1:8765/studio`. The desktop launcher points to the same
route. One server process owns durable generation and Brain workers; a browser
refresh only reconnects to their event stream.

## Readback

```bash
bin/health
bin/recent 15
bin/piece <piece-name-or-id>
```

Runtime state is in `~/.cactus-strudel/v3/runtime.sqlite3`. Immutable revision
assets are under `producer-brain/assets/`. A score is valid only for the exact
revision and audio SHA shown by the UI/API.

## Generate and score

```bash
bin/gen 2 --profile gemini-pro "human musical brief"
bin/score <piece-name-or-id> 7.8 "human listening note"
```

Use `--profile` for an explicit exact profile ID. An unknown ID fails instead
of falling back. Without it, the committed default generation profile is used.

Jobs and terminal receipts remain visible in Activity. Cancellation does not
delete a revision that already crossed the immutable commit barrier.

## Agent Settings

Use `/settings/agent`:

```text
Draft → Discover models → Test connection → Apply profile
```

Test is a real selected-model tool round-trip but does not activate the draft.
Only Bowei's Apply click changes the active Brain revision. The API key is
stored by Keychain reference and is never shown on readback.

## Verification boundary

Run `scripts/verify-repo.sh` for deterministic source/runtime checks. A real
generation receipt proves model, validator, renderer, and asset plumbing.
Neither proves musical quality; Bowei's listening score is the quality gate.

The earlier SessionGraph CLI operations are research history at
`docs/research/sessiongraph-operations.md`, not a second live control plane.
