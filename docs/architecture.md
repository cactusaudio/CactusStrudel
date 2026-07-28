# Live v3 architecture

This is the current product architecture. Historical SessionGraph, cookbook,
critic, specialist-agent, gf, browser-bridge, and v2 GUI designs are isolated
under `archive/`.

## Request and ownership graph

```text
Producer UI
  │ bootstrap + mutations + SSE
  ▼
runtime/serve.py
  ▼
V3Application (runtime/v3_api.py)
  ├─ RuntimeTruth
  │    ├─ pieces / immutable revisions / ratings
  │    ├─ child render jobs and model-run receipts
  │    └─ version asset staging + atomic promotion
  ├─ GenerationRepository
  │    └─ best-of-N parent batches and cancellation
  ├─ BrainJobStore + BrainRunnerService
  │    └─ Brain turns, tool calls, receipts and cancellation
  ├─ ApiEventLog
  │    └─ normalized UI `api_events` cursor used by `/api/v2/events`
  ├─ AgentSettingsService
  │    ├─ candidate/catalog/test/apply JSON
  │    └─ Keychain credential references
  └─ generation settings adapter
       └─ exact profiles derived from a matching passing Agent test
```

These services share one state root and, where applicable, the canonical
SQLite file. They are not one repository or one transaction abstraction.

## Runtime owner

Exactly one process may own a state root at a time (`runtime/v3/owner.py`).
`serve.py` acquires a non-blocking `owner.lock` flock before binding the port
and before `V3Application` exists, so a losing double launch exits without
constructing stores, running migrations, or touching recovery. The lease
carries a monotonic owner epoch persisted in `owner.json` and an explicit
lifecycle:

```text
owner_acquired → migrated → recovering → accepting → quiescing → closed
```

Migrations and recovery run only under the lease; HTTP work is accepted only
after recovery finishes. Every store mutation is fenced through the lease:
new dispatch (job/batch/Brain creation and starts) is refused once the owner
is quiescing, and all finalization/publication fails closed after release —
a late worker from a released owner cannot finalize, publish, or mutate
truth. Store events additionally stamp `owner_epoch` for durable attribution.
This is one local lock plus one epoch, deliberately not a cluster
coordinator.

## Persistent stores

| Store | Owner | Purpose |
|---|---|---|
| `~/.cactus-strudel/v3/runtime.sqlite3` | runtime/v3, generation, Brain, API events | operational records and receipts |
| `producer-brain/assets/<piece>/<revision>/` | runtime/v3 assets | immutable code/audio/prompt/features/receipt |
| `~/.cactus-strudel/v3/agent/` | Agent Settings | draft, catalogs, tests and immutable applied revisions |
| `~/.cactus-strudel/v3/generation.json` + `generation-revisions/` | generation settings | current pointer and immutable profile/route revisions |
| macOS Keychain | Agent Settings | API-key bytes referenced by opaque ID |
| `~/.cactus-strudel/v3/owner.lock` + `owner.json` | runtime owner lease | flock target plus epoch/stage readback |
| `runtime/app/` | Producer UI controlled build | served static application plus adjacent build receipt |
| `apps/renderer-page/dist/` | renderer-page controlled build | previewable browser engine plus adjacent build receipt |
| `producer-brain/kernel/` | prompt compiler | technical prompt envelope |

The database does not contain API-key bytes. The asset tree does not own
mutable piece metadata. The UI build does not own jobs.

## Identity model

- A piece is stable library identity.
- A revision is immutable rendered truth.
- A preview is a new immutable revision not yet active.
- Promotion changes the piece’s active revision pointer.
- A rating binds to revision ID and exact audio SHA.
- A generation parent job owns 1/2/4 independent child jobs and durably pins
  one immutable generation-config snapshot plus one compiled-kernel snapshot.
- Brain and generation jobs pin the configuration used for that run.

Rendering writes into same-filesystem staging. Only a successful render with
non-empty audio, positive duration, full hashes, and a receipt is promoted into
the final asset directory. The directory rename is atomic and the SQLite
registration is a separate transaction, so a durable `render_commit_intents`
row binds the exact receipt and full registration payload before the rename.
At startup — before interrupted-job marking — recovery adopts a promoted
directory whose receipt matches its intent byte-for-byte and finalizes the
job/version/model-run rows idempotently; anything else is abandoned and
retained as explicit orphan evidence for reconciliation. A crash between
promote and register therefore completes as the succeeded work it truthfully
was instead of leaving a silent orphan.

## Revision usability

Every product action consumes one `RevisionUsability` verdict
(`runtime/v3/service.py`):

```text
usable =
  database revision exists
  AND receipt parses
  AND receipt identity matches database identity
  AND source/audio bytes match receipt
  AND revision lifecycle permits the requested action
```

Listing exposes unusable revisions with their reason; scoring, promotion,
playback, and Brain context refuse them. The static server consults
`asset_request_gate` before serving revision bytes: drifted files return 409,
staging and unregistered asset paths are never served, and `receipt.json`
stays readable as drift evidence. Verification is receipt/byte-based — a
`legacy_partial` revision with fully verified bytes remains real heard truth —
and is cached per revision keyed by file mtime/size so steady assets are not
re-hashed on every listing. A rating binds to revision ID and exact audio SHA
only after the served bytes re-verify against the receipt.

## Event model

There are deliberately different audit/event sequences:

- `job_events`: RuntimeTruth child-job/domain audit;
- `brain_job_events`: Brain execution audit;
- `api_events`: normalized Producer UI reconnect cursor.

`GET /api/v2/events?after=N` observes `api_events`. Adapters append normalized
events after durable state transitions. The UI treats SSE as an observer:
bootstrap/readback remains authoritative, and disconnect never cancels work.

## Generation path

```text
human brief + exact generation profile
  → prompt kernel compile
  → direct CLIProxy `/v1/responses`
  → extract Strudel source
  → deterministic Strudel validator
  → render worker
       → renderer-page + Playwright + realtime capture
       → FFmpeg MP3 + descriptive features
  → staged immutable assets
  → atomic asset-directory promotion
  → transactional SQLite revision registration
  → human listening and optional score
```

There is no second model pass marketed as validation. A failed mechanical step
fails visibly; a successful render makes no aesthetic claim.

A best-of-N parent derives its terminal summary only from durable child
terminal rows: it cannot terminalize while an allocated child is still live.
The failure path cancels, drains for a bounded interval, and then abandons
any straggler explicitly — the abandonment is recorded on the child in the
same finalization transaction, never implied.

## Agent Brain path

Brain uses the Applied Agent settings revision only. The user message is stored
once and tool calls are idempotent. Every mutating call carries an effect
state (`executing → effect_observed | finalized | reconciliation_required`)
beside its `committed` marker. The mutating tools create durable rows under
the deterministic idempotency key `brain:{job_id}:{call_id}`, so restart
recovery reconciles an in-flight mutating call by lookup, never by replay: an
observed effect is recorded as a committed reconciled receipt (the job ends
`failed`/`cancelled_after_commit` with the reason that the conversation is
not resumable), a proven-absent effect makes the job safely requeueable, and
an undecidable one stays `reconciliation_required` for a human. Durably
queued jobs that were never submitted are redispatched at recovery instead of
stranding. Standard sends the selected supported effort. Ultra runs bounded
read-only scouts and one lead; only the lead receives mutating product tools,
and upstream effort is `max`, never `"ultra"`.

Brain cannot Test or Apply Agent Settings. It may read evidence or propose work;
Bowei owns Apply, revision promotion, scoring, and musical acceptance.

## Legacy boundary

The v2 GUI is read-only evidence at `/legacy/*`: these routes show captured
screenshots and execute no archived scripts. Old APIs are closed. Legacy corpus
files remain in `producer-brain/` because reconciliation and provenance need
their exact bytes. Old source architectures and their automatic agent surfaces
live under `archive/` and are excluded from the active workspace.
