# Render worker

Production-only Node entrypoints used by `runtime/v3_api.py`:

- `validate-strudel.ts` validates generated source with the deterministic
  registry;
- `auto-render.ts` performs the faithful realtime Strudel capture, writes MP3,
  and emits descriptive audio features.

Run these through the v3 job system in normal operation. Direct invocation is
for focused renderer development:

```bash
pnpm -C apps/render-worker -s exec tsx src/validate-strudel.ts --json --stdin
pnpm -C apps/render-worker -s exec tsx src/auto-render.ts /absolute/piece.js
```

This package does not choose models, score music, or own durable state.
The runtime executes the TypeScript source through `tsx`; there is no
production `dist/` ownership for this package.
