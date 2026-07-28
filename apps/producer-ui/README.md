# Producer UI

The current v3 producer surface: Studio, Library, Research, Activity, Agent
Settings, Generation Settings and System.

## Develop and build

```bash
pnpm --filter @cactus/producer-ui dev
pnpm --filter @cactus/producer-ui typecheck
pnpm --filter @cactus/producer-ui test
pnpm --filter @cactus/producer-ui build
```

Development proxies `/api` and `/producer-brain` to
`http://127.0.0.1:8765`. Production builds into `runtime/app/`.

## Ownership

- Current `/api/v2` wire types: `src/contracts.ts`.
- HTTP/SSE calls: `src/api-client.ts`.
- Shared state and selection invariants: `src/store.ts`.
- Sole audio object: `src/audio-engine.ts`.
- Route screens: `src/screens/`.

The exact revision and audio SHA currently auditioned by the global transport
own the score target, receipt and Brain context. Editor A/draft may remain
different while B is auditioned; the UI names both identities instead of
silently retargeting either one. A/B preserves playback position when both
durations are usable. Agent Apply is enabled only for the server’s current
matching passing Test. Missing model capability remains `null`; the UI does
not guess.

`fixtures/bootstrap.json` is visual-development data, never production truth.
