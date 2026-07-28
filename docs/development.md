# Development guide

## Start with the seam

1. Run `bin/catch-up <area>`.
2. Read only that area’s `read_first`, target entrypoint, and focused tests from
   `docs/areas.json`.
3. Inspect adjacent layers only if the change crosses their contract.
4. Preserve unrelated dirty files.
5. Verify the changed seam; use the full gate only for cross-layer work.

Do not begin with `archive/`, a full documentation read, or a specialist-agent
swarm. The default ownership map is already explicit.

## Active source tree

```text
apps/
  producer-ui/       Preact UI
  render-worker/     validator/render/FFmpeg worker entrypoints
  renderer-page/     Strudel browser engine
packages/
  renderer/          Playwright driver
  strudel-validator/ deterministic source validator
  analyzer/          descriptive WAV features
runtime/
  serve.py           HTTP/static/SSE
  v3_api.py          application adapters and workers
  v3/                durable piece/revision truth
  agent/             CLIProxy, settings and Brain
producer-brain/
  kernel/            prompt fragments
  assets/            immutable v3 assets
  corpus/pieces/...  preserved legacy evidence
```

## Ownership discipline

- UI wire changes start in `apps/producer-ui/src/contracts.ts` and the API
  adapter together.
- HTTP handlers stay thin; domain rules belong in `runtime/v3/` or
  `runtime/agent/`.
- A store transition and its receipt must agree before emitting the normalized
  UI event.
- Render-worker stdout is diagnostic only; durable truth is the committed
  receipt and asset readback.
- Prompt-kernel changes preserve the technical-envelope boundary.
- Dynamic facts never become hard-coded onboarding prose.

`runtime/v3_api.py` is currently the largest integration module. New features
should extract a cohesive adapter/worker rather than growing unrelated regions
inside it. Do not perform a gratuitous rewrite of stable behavior.

## Focused checks

| Area | Command |
|---|---|
| docs/onboarding | `python3 scripts/check_docs.py` |
| Agent core | `python3 -m unittest discover -s tests/agent_v3 -v` |
| truth/migration | `python3 -m unittest discover -s tests/v3 -v` |
| HTTP/application | `python3 -m unittest discover -s tests/v3_api -t . -v` |
| UI | `pnpm --filter @cactus/producer-ui typecheck && pnpm --filter @cactus/producer-ui test` |
| validator | `pnpm vitest run packages/strudel-validator` |
| renderer | `pnpm vitest run packages/renderer packages/analyzer` |
| repo identity | `python3 -m unittest discover -s tests/repo_systems -t . -v` |
| build identity | `node --test scripts/build-receipt.test.mjs` |
| all deterministic seams | `scripts/verify-repo.sh` |

A real connection or render is warranted when its exact path changed. Music
quality still requires human listening.

## Workspace and generated builds

`pnpm-workspace.yaml` contains only active apps/packages. Historical packages
remain source-readable under `archive/research-v1/` but are not installed,
built, tested, or auto-discovered.

- Producer UI source builds to `runtime/app/`.
- Renderer page builds to `apps/renderer-page/dist/`.
- Other `dist/`, source maps, tsbuildinfo, caches, screenshots and logs are
  regenerable artifacts and do not belong to active source topology.

The production scripts for both web surfaces call
`scripts/build-receipt.mjs run`. That runner:

1. enumerates a declared input set and rejects task-input symlinks;
2. records current source, lockfile, builder and command identity;
3. builds into a temporary output;
4. replaces only the owned output tree;
5. rescans inputs before publication;
6. records output path, byte count and SHA-256 in
   `cactus-build-receipt.json`.

Read back current identities with:

```bash
bin/source-attest --pretty
node scripts/build-receipt.mjs check producer-ui --json
node scripts/build-receipt.mjs check renderer-page --json
node scripts/build-receipt.mjs verify-served producer-ui \
  --base-url http://127.0.0.1:8765 --json
```

`source-attest` keeps effective working bytes, Git-exposed index path/mode/OID/
stage/raw flags, untracked source and landing metadata separate. It deliberately
excludes generated builds, runtime data, generated STATE and ephemeral handoff
readbacks. A commit remains a separate landing action.

After changing workspace membership or dependencies:

```bash
pnpm install
pnpm typecheck
```

## Documentation changes

Update the smallest owning document. If ownership moves, update:

1. component README;
2. `docs/areas.json`;
3. `docs/architecture.md`;
4. `docs/API.md` if the wire contract changed.

Run `bin/state-refresh` after a material runtime/build/settings change. STATE
contains bounded readback of the same identities; the adjacent attestation and
build receipt remain the machine-readable evidence.
