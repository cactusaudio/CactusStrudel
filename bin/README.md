# Operator and developer commands

The supported product commands target local `/api/v2`.

## Daily product commands

| Command | Purpose | Mutates |
|---|---|---|
| `bin/health` | compact live readback | no |
| `bin/recent [N]` | newest active pieces and scores | no |
| `bin/piece <name-or-id>` | one piece, revisions and provenance | no |
| `bin/gen [1\|2\|4] [--profile ID] [brief]` | durable generation batch | yes |
| `bin/score <piece> <0-10> [note]` | score exact active audio SHA | yes |

## Developer context

| Command | Purpose |
|---|---|
| `bin/catch-up [area] [--json]` | live state plus minimal read/test route |
| `bin/state-refresh [--stdout\|--check]` | generate/check `docs/STATE.md` |
| `bin/handoff start\|show\|check\|close` | current delta handoff |
| `bin/check-docs` | fast documentation/topology contract check |
| `bin/source-attest [--pretty\|--include-paths]` | effective source, index flags and landing identities |

`catch-up` is read-only and bounded: it does not run tests, contact a model, or
scan archive content. Its repo section uses the same source attestation and
build-receipt readers as the commands below.

## Build identity

The two production build commands are controlled publications: each refuses
task-input symlinks, hashes the pre-build input set, replaces only its declared
output tree, hashes that output and writes `cactus-build-receipt.json`.

```bash
pnpm --filter @cactus/producer-ui build
pnpm --filter @cactus/renderer-page build
node scripts/build-receipt.mjs check producer-ui
node scripts/build-receipt.mjs check renderer-page
node scripts/build-receipt.mjs verify-served producer-ui \
  --base-url http://127.0.0.1:8765
```

`check` proves current inputs and built bytes still match one receipt.
`verify-served` additionally compares the declared output tree with bytes from
the running surface. Neither is a listening or product-acceptance claim.

## Truth and migration

| Command | Purpose |
|---|---|
| `bin/v3-truth init\|status` | canonical truth-store readback |
| `bin/v3-reconcile` | dry-run legacy reconciliation plan |
| `bin/kernel-audit` | read-only prompt-kernel inspection |
| `bin/spine-list [status]` | read-only historical findings |

Applying a reconciliation plan requires explicit target database and asset
paths. Unknown profiles, names or identities fail rather than falling back.

Superseded v2 mutation helpers are frozen under `archive/runtime-v2/`.
