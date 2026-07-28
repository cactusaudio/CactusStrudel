# `/api/v2` contract

`runtime/serve.py` is the HTTP adapter; `V3Application` owns application
coordination. JSON errors are explicit. Mutating clients send an
`Idempotency-Key` where supported.

“v3” names the current product/runtime architecture; `/api/v2` is the second
wire schema. These versions are independent, so the route name is not a legacy
API alias.

## Reads

| Method | Route | Result |
|---|---|---|
| GET | `/api/v2/bootstrap` | UI snapshot: pieces, jobs, Brain, settings, cursor |
| GET | `/api/v2/health` | compact served-state readback |
| GET | `/api/v2/events?after=N` | SSE over normalized `api_events` |
| GET | `/api/v2/pieces?archived=active\|all` | library |
| GET | `/api/v2/pieces/<piece-id>` | piece and immutable revisions |
| GET | `/api/v2/brain/jobs/<job-id>` | Brain job, messages and receipt |
| GET | `/api/v2/settings/agent` | masked Agent draft/active/test/catalog/status |
| GET | `/api/v2/operations/<idempotency-key>` | exact prior outcome of one durable operation |

## Mutations

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/v2/generation-jobs` | create best-of-1/2/4 durable batch |
| DELETE | `/api/v2/jobs/<job-id>` | request generation cancellation |
| PATCH | `/api/v2/pieces/<piece-id>` | rename, tag, archive or restore |
| POST | `/api/v2/pieces/<piece-id>/previews` | validate/render immutable preview |
| POST | `/api/v2/pieces/<piece-id>/revisions` | promote named revision |
| PUT | `/api/v2/pieces/<piece-id>/revisions/<revision-id>/score` | score exact audio SHA |
| POST | `/api/v2/brain/jobs` | create durable Brain job |
| DELETE | `/api/v2/brain/jobs/<job-id>` | request Brain cancellation |
| POST | `/api/v2/settings/agent/catalog` | stage draft and fetch authenticated catalog |
| POST | `/api/v2/settings/agent/test` | test exact staged fingerprint |
| PUT | `/api/v2/settings/agent/apply` | Apply matching passing Test |
| POST | `/api/v2/settings/agent/reset` | discard candidate draft |
| POST | `/api/v2/settings/generation/sync` | derive generation profiles from current Test |
| PUT | `/api/v2/settings/generation/default` | select exact configured Studio default |

## Identity requirements

- Score body includes `audio_sha`.
- Score, generation, preview, and Brain intents send an `Idempotency-Key`;
  retrying the same key with changed evidence conflicts.
- Preview body includes the source revision ID.
- Preview success returns both the new revision and the refreshed piece graph.
- Promotion names the exact revision ID.
- Brain context pins piece/revision/audio identities.
- Unknown generation profiles fail; they do not fall back.
- Reusing an idempotency key with different canonical request bytes fails.
- The UI persists every idempotent mutation intent across browser restarts
  and reconciles it through the operations readback before creating a new
  durable operation.
- Draft staging carries `base_fingerprint`; a stale base is refused as 409
  so two tabs cannot silently overwrite each other's Agent draft.
- Every revision carries `usable`/`usability_reason`. Scoring or promoting an
  unusable revision fails as 409; static playback of drifted revision bytes
  also returns 409, while `receipt.json` stays readable as drift evidence.

Trailing slashes are canonicalized consistently for every HTTP verb. JSON
numbers must be finite JSON numbers; malformed endpoint bodies fail as 400
before entering the application boundary. While the runtime owner is
quiescing or released, mutations fail as 503 `runtime is shutting down`.

## SSE semantics

SSE is an observer, not the transaction log. The client bootstraps first, then
subscribes after the returned cursor. Reconnect uses the newest observed
cursor; a fresh bootstrap repairs missed UI state. Domain and Brain audit
tables remain separate from normalized `api_events`.

## Static assets

The server supports byte ranges for audio. Immutable prompt, code, audio,
feature and receipt URLs come from version metadata. `runtime/app/` serves the
SPA on clean routes. Frozen legacy pages are isolated at `/legacy/*`.
