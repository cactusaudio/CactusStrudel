# RuntimeTruth domain

`runtime/v3/` owns durable piece/revision/rating records, child jobs, model-run
receipts, staging and immutable asset promotion. It has no HTTP or UI concerns.

## Main facade

`RuntimeTruth` coordinates:

- stable piece/version/job identities;
- content-bound idempotency;
- explicit child-job transitions and cancellation;
- same-filesystem staging and atomic asset promotion;
- code/audio/prompt/features/receipt SHA-256 metadata;
- ratings bound to version ID and exact audio SHA;
- restart and receipt reconciliation.

Without explicit paths it uses:

```text
$CACTUS_V3_STATE_ROOT/runtime.sqlite3
or ~/.cactus-strudel/v3/runtime.sqlite3
```

and `producer-brain/assets/` for immutable version assets.

## Boundaries

- `job_events` is the RuntimeTruth/domain audit sequence.
- The Producer UI SSE cursor is `ApiEventLog.api_events`, owned by
  `runtime/v3_api.py`; it is not `job_events`.
- Generation parent batches are owned by the application’s
  `GenerationRepository`.
- Brain jobs and events are owned by `runtime/agent/`.
- Agent candidate/Test/Applied JSON is owned by `AgentSettingsService`.

All may share the canonical state root/database, but they are distinct
repositories and transaction boundaries.

Migration 1 also created `settings_*`, `brain_sessions`, `brain_turns`, and
`tool_calls` tables plus matching prototype store methods. They are inert
schema compatibility, not live Agent/Brain ownership. Operator status, new
tests, and application code must use `runtime/agent/`; do not build new work on
the prototype APIs.

## Render commit

`stage_render` writes a temporary directory. `commit_rendered_version` accepts
only complete staged bytes, atomically promotes the directory, then separately
inserts version/model-run records and closes the child job with a receipt. A
failure between filesystem promotion and SQLite registration can leave an
orphan promoted receipt. Read-only reconciliation reports both that direction
and the reverse direction: a registered version whose asset receipt is missing
or invalid. A receipt SHA match counts as `matched` only when the database
`piece_id`, version `id`, `asset_dir`, and `created_by_job_id` also equal the
receipt's `piece_id`, `version_id`, `asset_dir`, and `job_id`. A valid receipt
with any of those fields crossed is reported as
`registered_receipt_identity_mismatch`; its database version also remains in
`registered_without_valid_receipt`. A cancellation crossing the commit barrier
becomes `cancelled_after_commit`.

## Legacy

`LegacyReconcilePlanner` is dry-run. `LegacyImporter` consumes an exact frozen
plan, rechecks source hashes, copies bytes into immutable revisions and is
idempotent. Unknown provenance, duplicate evidence and recorded/observed hash
drift remain explicit. Recovery candidates are excluded from automatic import.

Focused tests: `tests/v3/`.
