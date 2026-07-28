# Archive map

Archive content is preserved evidence, not an alternate workspace. Normal
development, builds, tests, agent discovery and catch-up exclude it.

| Path | Contents | Restore boundary |
|---|---|---|
| `gui/ui-v2-baseline-20260728-95f85f6/` | frozen GUI source, screenshots and manifest | script-free screenshot viewer at `/legacy/*`; exact source restore only via `RESTORE.md` |
| `runtime-v2/` | old server, bridge, gf helpers, docs and commands | historical inspection only |
| `research-v1/` | SessionGraph/cookbook/critic packages, old CLI/UI, docs, tests and Claude swarm | not a pnpm workspace; restore only by an explicit new product decision |
| `migrations/` | frozen migration plans | exact-plan evidence |
| `local/` | ignored bulky local corpora, renders, screenshots and caches | machine-local; see `local/README.md` |

Do not patch archived files to look current. If a historical bug matters,
record the interpretation in a current review or migration receipt.

Archive moves are byte-identical by default. Five cutover files received
explicit annotations or transformations instead; they are not represented as
byte-identical copies. Their old/new paths, full Git blob OIDs, classifications,
and reasons are recorded in [`transformations.json`](transformations.json).

One archived file remains an intentional reconciliation input:
`runtime-v2/data/cc-bridge/tasks.jsonl`. Do not delete it as generic log debris.
