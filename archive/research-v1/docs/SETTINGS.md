# Agent Settings v3

Agent Settings is an explicit Draft → Test → Apply workflow for a direct native
CLIProxy `/v1` connection. It does not hide connection decisions behind
defaults or fallbacks.

Open:

```text
http://127.0.0.1:8765/settings/agent
```

## Connection topology

```text
CactusStrudel
  └─ Base URL ending in /v1
       └─ authenticated live model catalog
            └─ exact selected model
```

The current local Base URL is:

```text
http://127.0.0.1:8318/v1
```

For a trusted LAN client, the same native service can be reached through the
machine’s `.local` name on port 8318. The product does not switch between
endpoints silently.

## Fields

### Base URL

The full native API root, including `/v1`. It is part of the settings
fingerprint. Changing it invalidates the last Test.

### API key

The UI accepts a key as a write-only input. The value is saved to macOS
Keychain and replaced in application state by an opaque `credential_ref`.

The raw key must not appear in:

- repo files;
- browser storage;
- HTTP responses;
- logs;
- SQLite rows;
- activity or job receipts;
- screenshots.

A masked “key present” state is enough for the UI.

### Model

The selector is populated from an authenticated `GET /models` against the
current draft connection. The saved value is the exact returned ID.

Important exact IDs in the current catalog include:

| Provider family | Exact ID |
|---|---|
| Anthropic | `claude-opus-5` |
| xAI | `grok-4.5` |
| Antigravity | `gemini-pro-agent` |
| OpenAI | `gpt-5.6-sol` |
| OpenAI | `gpt-5.6-terra` |

Do not invent aliases. A capability manifest may add UI metadata only after the
exact model is present in the live catalog.

### Reasoning effort

The selector only shows supported values for the exact selected model.

For `gpt-5.6-sol` and `gpt-5.6-terra`, the current supported set is:

```text
low · medium · high · xhigh · max
```

For models without a declared effort contract, the value is `null`. Do not
guess an effort and do not send one.

### Orchestration

`standard` makes one lead-model request/tool loop.

`ultra` is bounded client-side orchestration:

- one lead;
- at most two read-only scouts;
- only the lead may execute mutating tools;
- the upstream wire effort is capped at `max`;
- Ultra is never sent as an upstream effort value.

The visible reasoning-effort choice and the orchestration choice are separate.

## Catalog

`POST /api/v2/settings/agent/catalog`:

1. stages the connection fields;
2. authenticates with the Keychain-backed credential;
3. fetches the live model list;
4. records fetch time and connection fingerprint;
5. returns exact model IDs plus capability metadata.

A stale catalog is evidence, not permission to assume the model is still live.
Refresh it before testing a changed connection.

## Test

`POST /api/v2/settings/agent/test` performs a real, inert end-to-end probe:

1. authenticated catalog read;
2. selected exact model Responses request;
3. model emits the `agent_probe` tool call;
4. CactusStrudel sends `function_call_output`;
5. model finishes with `READY`.

The probe does not mutate music, pieces, scores, settings, or files. Its receipt
records:

- test ID;
- settings fingerprint;
- catalog ID and model count;
- exact selected model;
- selected and wire effort;
- orchestration;
- stage latencies;
- response IDs;
- final excerpt or error.

A successful Test proves the selected profile can complete the same kind of
tool round-trip the Brain needs. It does not apply the draft and does not judge
music.

## Apply

`PUT /api/v2/settings/agent/apply` requires:

- the full draft;
- the successful `test_id`;
- an unchanged matching fingerprint.

Apply writes a new immutable settings revision and then reads it back. The
active revision ID is what future Brain jobs pin.

Apply is rejected when:

- no successful Test exists;
- the draft changed after Test;
- the exact model disappeared from the tested catalog;
- the test receipt is stale or belongs to another fingerprint;
- the credential reference cannot be resolved.

Bowei owns the Apply decision. Agent Brain may explain or recommend a draft but
cannot call Apply.

## Reset

`POST /api/v2/settings/agent/reset` discards the current draft and restores the
active profile. If no active revision exists, it returns an empty inactive
draft. A transient unused Keychain credential created by the discarded draft
may be cleaned up when it is not referenced by generation settings.

## Active versus draft

The settings response keeps these separate:

```text
active
draft
draft_fingerprint
draft_is_active
test
catalog
revision_id
status
managed_overrides
```

UI labels must say “Test passed” and “Applied” separately. A successful test is
not activation.

## Generation profiles

Generation settings are separate from Agent Brain settings. A producer profile
pins an exact model, effort, and orchestration for each first shot. The current
profile set is derived only from IDs found in the authenticated catalog:

| Profile | Model | Effort | Orchestration |
|---|---|---|---|
| `gemini-pro` | `gemini-pro-agent` | `null` | standard |
| `terra-balanced` | `gpt-5.6-terra` | medium | standard |
| `sol-max` | `gpt-5.6-sol` | max | standard |
| `grok-creative` | `grok-4.5` | `null` | standard |
| `opus-producer` | `claude-opus-5` | `null` | standard |

There is no hidden model fallback. If a configured model is unavailable, the
job fails with that fact.

Generation has its own explicit settings mutations:

| Method | Path | Contract |
|---|---|---|
| POST | `/api/v2/settings/generation/sync` | Accepts the current matching passing Agent `test_id`, publishes profiles only from that authenticated catalog, and does **not** Apply or change the Producer Brain profile |
| PUT | `/api/v2/settings/generation/default` | Accepts an exact configured `profile_id`, writes the generation revision atomically, and returns the canonical readback; repeating the same choice is a no-op |

This separation is intentional: a tested Agent candidate can supply a verified
catalog to Generation without gaining authority to activate Agent Brain.

## Environment visibility

If a managed environment value affects Agent configuration, Settings lists its
name under `managed_overrides`. It must be visible to the user. The runtime
must not use an undeclared environment value as a silent alternative to the
active revision.

## Current activation boundary

As of 2026-07-28, the `claude-opus-5` standard draft passed the real inert tool
probe, but `active_revision_id` is still `null`. It remains a tested draft until
Bowei clicks Apply.
