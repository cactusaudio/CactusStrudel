# CactusStrudel Agent v3 integration contract

`runtime.agent` is the live Agent/Settings core behind `runtime/v3_api.py`.
The legacy v2 handlers are archived and cannot mutate it. Wiring the core into
the v3 API did not silently activate Bowei's draft or copy a plaintext key.

## Runtime ownership

- Direct backend only: the configured native CLIProxyAPI `/v1` endpoint on
  `8317`–`8320`. There is no vendor fallback, model fallback, shim, Router,
  Core, `84xx`, or `/chat/completions` path.
- Live Settings JSON: `~/.cactus-strudel/v3/agent/`. It contains draft state,
  immutable tested revisions, catalog snapshots, and test receipts.
- Secret: macOS Keychain service `com.cactusstrudel.agent.v3`. JSON contains
  only a random `credential_ref`, never the API key.
- Brain operational truth shares `~/.cactus-strudel/v3/runtime.sqlite3`.
  Jobs pin an immutable Agent config revision.

Construct all objects once in the server process:

```python
from runtime.agent import (
    AgentSettingsService,
    BoundedUltraCoordinator,
    BrainJobStore,
    BrainRunnerService,
    ToolRegistry,
)

ultra = BoundedUltraCoordinator(scout_count=2)
settings = AgentSettingsService(
    ultra_client_models=ultra.supported_models,
)
music_tools = ToolRegistry("music")
# Register existing piece/corpus tools here. Settings mutation tools are refused.
brain = BrainRunnerService(
    store=BrainJobStore(),
    settings=settings,
    toolsets={"music": music_tools},
    ultra=ultra,
)
brain.recover()
```

If the product does not instantiate `BoundedUltraCoordinator`, construct
`AgentSettingsService()` with no `ultra_client_models`. The catalog then shows
that Sol/Terra have catalog-level Ultra knowledge but `ultra_available=false`,
and an Ultra draft cannot pass Test Connection.

## Settings HTTP adapter

The HTTP layer should be a thin JSON adapter:

| Endpoint | Core call | Contract |
|---|---|---|
| `GET /api/v2/settings/agent` | `settings.ui_document()` | Producer UI shape; masked draft, active revision, effective wire effort |
| `POST /api/v2/settings/agent/catalog` | `settings.stage_ui_draft(body)` then `discover_catalog()` | Authenticated live IDs enriched only by exact-ID capabilities |
| `POST /api/v2/settings/agent/test` | `stage_ui_draft(body)`, `test_draft()`, then `ui_document()` | Catalog, selected-model Responses tool call, local inert output, final READY |
| `PUT /api/v2/settings/agent/apply` | `stage_ui_draft(body["draft"])`, `apply_draft(test_id)`, then `ui_document()` | Exact fingerprint match and filesystem readback |
| `POST /api/v2/settings/agent/reset` | app reset adapter | Discard the current candidate and restore the active profile, or the empty default when none is active |
| `POST /api/v2/settings/generation/sync` | app generation-settings adapter | Require the current matching passing Agent Test and its authenticated catalog; publish Generation profiles only, without Apply |
| `PUT /api/v2/settings/generation/default` | app generation-settings adapter | Persist one exact configured profile as Studio default, read it back, and treat an unchanged choice as a no-op |

The API key must be passed only as a transient handler argument. Never echo it,
put it in an event, or merge it into a JSON config object.

`stage_ui_draft()` ignores UI-only `key_present` and internal
`credential_ref`; a non-empty `api_key` is immediately moved to Keychain.
Re-staging an identical draft does not invalidate its test. The latest
authenticated catalog remains available while model/effort changes, but is
cleared when endpoint or Keychain credential changes.

The successful test receipt has three stages:

1. `catalog`: authenticated `/models`, selected exact ID present;
2. `response`: selected model calls inert `agent_probe`;
3. `tool_loop`: the client returns `function_call_output` and receives final
   `READY`/`OK`.

Each stage and the full test include latency. Apply is explicit; a successful
test never activates a draft on its own.

The optional explicit legacy helper
`settings.stage_legacy_connection(...)` moves a supplied key into Keychain and
creates an untested draft. It does not edit/delete the legacy file and does not
Apply.

## Brain jobs HTTP adapter

| Endpoint | Core call |
|---|---|
| `POST /api/v2/brain/jobs` | `brain.submit(text, toolset_id="music", idempotency_key=request_id)` |
| `GET /api/v2/brain/jobs/:id` | `brain.store.get_job(job_id)` |
| `DELETE /api/v2/brain/jobs/:id` | `brain.cancel(job_id)` |
| `GET /api/v2/events?after=N` | `brain.store.events(after_seq=N)` |

The POST returns a durable `job_id` immediately. SSE is only an observer over
the monotonic SQLite event sequence; disconnecting the browser cannot own or
cancel the job. A retried POST with the same idempotency key returns the same
job and rejects changed input. DELETE sets a cancellation event and closes all
in-flight HTTP connections for that job.

Tool calls are unique on `(job_id, call_id, arguments hash)`. A repeated call
reuses its recorded output. A cancel arriving after a mutating tool has
committed produces `cancelled_after_commit`, not a false cancellation. On
process recovery, read-only interrupted work may restart; any job with a
committed or uncertain mutation fails with a manual-reconciliation receipt.

## Responses and Ultra semantics

- The request sends the exact selected `model_id`.
- `reasoning_effort` and `orchestration` remain separate in the profile.
- Standard sends the selected supported effort.
- Ultra keeps the user's selected effort visible but every upstream scout and
  lead request sends `reasoning.effort=max`; `"ultra"` is never put on the wire
  or in a model suffix.
- Ultra uses one or two concurrent, tool-free, read-only scouts. Their advisory
  notes are given to one lead; only that lead receives product tools.
- A missing/failing scout fails the Ultra job. It never silently degrades to
  Standard.
- Music and developer tool registries are separate. No Brain toolset can
  Test/Apply/mutate Agent Settings; it may expose read/propose tools instead.
