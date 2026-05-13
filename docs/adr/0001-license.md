# ADR 0001 — License: AGPL-3.0-or-later

Date: 2026-05-10
Status: Accepted

## Context

Cactus Strudel depends on:
- All `@strudel/*` packages (AGPL-3.0-or-later).
- `essentia.js` 0.1.3 (AGPL-3.0).

Both license under AGPL with the network-distribution clause. Mixing AGPL deps inside a permissively-licensed core creates a legal gray area: even a "boundary" package that imports `@strudel/web` is effectively AGPL-bound for any user-facing distribution.

## Decision

The entire `CactusStrudel` monorepo is licensed **AGPL-3.0-or-later**.

## Consequences

- No license-boundary games inside the monorepo.
- Anyone running CactusStrudel as a network service must offer source per AGPL §13.
- Internal Cactus uses (Bowei's machines, private servers) are unaffected.
- We may later carve out a permissively-licensed IR-only spec package (`@cactus/ir-spec`) that contains only the SessionGraph JSON Schema and no Strudel/essentia code, if we ever want third-party reuse without AGPL contagion. **Not done now.**
