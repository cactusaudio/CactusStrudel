# Operations

## Start and read back

```bash
runtime/serve
bin/health
bin/catch-up
```

The server binds `127.0.0.1:8765`; the desktop launcher opens `/studio`.
`CACTUS_NO_BROWSER=1 runtime/serve` starts without opening a page.

One runtime owner per state root: startup acquires `owner.lock` before the
port and before any migration/recovery. A second launch against the same
state root exits with code 3 and mutates nothing, even when its port is
free; a port conflict on a free state root exits with code 4 before any
state change. `owner.json` reads back the current epoch and lifecycle stage.

Daily reads:

```bash
bin/recent 15
bin/piece <piece-name-or-id>
bin/v3-truth status
```

Mutations:

```bash
bin/gen 2 --profile gemini-pro "human musical brief"
bin/score <piece-name-or-id> 7.8 "listening note"
```

## State locations

| Data | Location |
|---|---|
| canonical database | `~/.cactus-strudel/v3/runtime.sqlite3` |
| runtime owner lease | `~/.cactus-strudel/v3/owner.lock` + `owner.json` |
| Agent settings | `~/.cactus-strudel/v3/agent/` |
| work staging | `~/.cactus-strudel/v3/work/` |
| immutable assets | `producer-brain/assets/` |
| served UI | `runtime/app/` |
| prompt kernel | `producer-brain/kernel/` |
| legacy source evidence | `producer-brain/{corpus.jsonl,pieces,audio,prompts}` |

Do not create a repo-local SQLite database as a second truth store.

## Job recovery

Generation and Brain jobs are server-owned. Refreshing or closing a browser
does not cancel them. On process restart:

- interrupted read-only work may be retried where the store contract allows;
- durably queued Brain jobs that were never submitted are redispatched;
- an in-flight mutating Brain call is reconciled against its durable effect
  by idempotency-key lookup: observed → committed reconciled receipt
  (`effect_observed`), proven absent → the job requeues safely, undecidable
  → `reconciliation_required` for a human;
- cancellation detected after a commit is reported as
  `cancelled_after_commit`;
- a generation parent never terminalizes around a live child: children are
  drained or explicitly abandoned, and the terminal summary derives from
  durable child rows.

Activity and `bin/catch-up` provide the first readback. Inspect exact job and
tool-call receipt rows before retrying; the parent terminal state alone is not
yet a complete effects summary.

Recovery runs only in the process that holds the owner lease, before HTTP
work is accepted. Job events stamp the recovering `owner_epoch`, so restart
markings are attributable to the exact owner that made them.

Render commits are intent-guarded: recovery first adopts promoted asset
directories whose receipts exactly match their durable commit intent
(finishing those jobs as the succeeded work they were), then marks the
remaining in-flight jobs interrupted. Abandoned intents and their staging
directories are retained as evidence and reported by `bin/v3-reconcile`.

Unusable revisions (missing or drifted assets, receipt/identity mismatch)
stay listed with a reason, but playback returns 409, and scoring, promotion,
and Brain context refuse them until the exact bytes verify again.

## Shutdown

SIGINT and SIGTERM take the same bounded path:

```text
quiesce (refuse new dispatch)
  → cancel in-flight generation/Brain work
  → drain up to CACTUS_SHUTDOWN_TIMEOUT (default 10s)
  → close pools
  → release ownership (owner.json stage becomes closed)
```

In-flight work that finalizes inside the drain window records its honest
terminal state. Work that cannot drain is abandoned with the lease released:
its late finalization attempts fail closed, and the next owner's recovery
marks the rows `interrupted`. During quiescing, mutating API calls return
503 `runtime is shutting down`.

## Backup and restore

There is currently no repo-owned command that captures and restores the
canonical SQLite database together with immutable assets, Agent state and
generation revisions. Per-setting revision history and asset receipts are not a
full runtime backup. Full snapshot/restore automation remains outstanding.

## Builds

```bash
pnpm --filter @cactus/producer-ui build
pnpm --filter @cactus/renderer-page build
node scripts/build-receipt.mjs check producer-ui
node scripts/build-receipt.mjs check renderer-page
node scripts/build-receipt.mjs verify-served producer-ui \
  --base-url http://127.0.0.1:8765
```

The first command owns `runtime/app/`; the second owns
`apps/renderer-page/dist/`. Both are controlled builds. They reject task-input
symlinks, rescan source before publication, replace only their declared output
tree, and write an adjacent `cactus-build-receipt.json` containing source,
lockfile, builder, command and output identities.

The renderer driver uses preview output only when its receipt is current and
the preview server returns the receipted bytes. Otherwise it starts from
current source. It waits for the old Vite child to exit before reusing a port.
The Producer UI `verify-served` command compares every receipted file with the
running server.

Read the effective source separately:

```bash
bin/source-attest --pretty
```

This attests current source and Git-exposed index flags without pretending that
the uncommitted v3 cutover is already reproducible from HEAD.

## Settings and generation

Agent candidate Test does not activate Brain. Apply remains a Bowei-owned UI
action. Generation profiles can be synchronized from the current matching
passing Test without applying Agent settings. See `docs/SETTINGS.md`.

## Legacy and archive

- `/legacy/main`, `/legacy/data`, `/legacy/settings`, `/legacy/spine` are
  script-free screenshot viewers for the frozen GUI evidence. Exact archived
  HTML remains available only through the archive restore boundary.
- old bookmark URLs redirect to the new workspace;
- old mutation APIs return not found;
- `bin/v3-reconcile` is dry-run by default;
- `archive/` is not on the operational path.

The archived v2 `tasks.jsonl` remains an input to recovery-candidate
reconciliation. Do not delete it as generic log debris.

## Handoff and state

```bash
bin/state-refresh
bin/handoff start "objective"
bin/handoff check
bin/handoff close "outcome"
```

`docs/STATE.md` is a generated observation with a timestamp. Live readback wins
if it has changed since generation. Its repository section is derived from the
effective source attestation, including Git-exposed raw index flags and
untracked source. Its build section reads both controlled receipts and the
Producer UI served-byte comparison. Treat STATE as an orientation snapshot:
the JSON output from `bin/source-attest` and each adjacent build receipt are
the durable machine-readable identities, while a commit remains a separate
landing action.
