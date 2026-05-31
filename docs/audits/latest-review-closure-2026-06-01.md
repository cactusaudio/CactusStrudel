# Latest Review Closure Matrix - 2026-06-01

Source: `/tmp/review-digest.json`, 104 review items: 18 HIGH, 52 MED, 34 LOW.

Truth gate at time of this matrix: `./scripts/verify-repo.sh` passed after the major hardening pass and final LOW-088 closure, with `pnpm test` 593 passed / 14 skipped, renderer smoke, renderer conformance, produce real-chain conformance, runtime helper/endpoint tests, boundary-doc guards, and `audit:repair` champion pass.

Status legend:

- `CLOSED`: fixed or explicitly guarded, with local code/test/gate evidence.
- `PARTIAL`: materially improved, but the review item includes broader capability/product claims that still need stronger evidence.
- `OPEN`: still a real issue or not yet proven fixed.
- `DEFERRED`: acknowledged product/architecture work, not a blocker for current repo truth gate.

## Summary

| Severity | Closed | Partial | Open | Deferred |
| --- | ---: | ---: | ---: | ---: |
| HIGH | 18 | 0 | 0 | 0 |
| MED | 51 | 1 | 0 | 0 |
| LOW | 34 | 0 | 0 | 0 |

## High

| ID | Status | Evidence |
| ---: | --- | --- |
| 001 | CLOSED | `packages/ir/src/json-pointer.ts` rejects prototype tokens; tests cover pollution guard. |
| 002 | CLOSED | `packages/strudel-validator/src/code-validator.ts` validates mini strings in `s/n/note/struct/mask/arp`; validator tests cover malformed mini-notation. |
| 003 | CLOSED | `packages/strudel-compiler/src/compile.ts` emits ADSR and warns on uncompiled IR fields; compiler tests assert warnings rather than silent no-op. |
| 004 | CLOSED | `packages/ir/src/json-pointer.ts` enforces RFC-ish array index rules; tests cover negative, NaN, out-of-range, and `-` misuse. |
| 005 | CLOSED | `apps/cli/src/auto-render.ts` uses safe numeric `setcpm/setcps` parsing; no eval. |
| 006 | CLOSED | `packages/analyzer/src/loudness.ts` / `packages/mastering/src/index.ts` true-peak path repaired and covered by analyzer/mastering tests. |
| 007 | CLOSED | `apps/cli/src/produce-closed-loop.ts` keeps best iteration / best weighted score and rolls back regressions; tests cover failed patch artifact and best-result behavior. |
| 008 | CLOSED | Cookbook provenance relabeled away from `imported_public_domain`; retrieval gates untrusted statuses. |
| 009 | CLOSED | `apps/cli/src/auto-render.ts` uses argument vectors / safe subprocess calls instead of shell interpolation. |
| 010 | CLOSED | `runtime/serve.py` blocks `.env*` through `dev_read_file` and redacts sensitive fields; runtime helper tests cover it. |
| 011 | CLOSED | `pnpm test` is green under `scripts/verify-repo.sh`. |
| 012 | CLOSED | `scripts/verify-repo.sh` now checks audit summary pass/fail, not just file existence. |
| 013 | CLOSED | Runtime render path calls deterministic validator before render and blocks invalid Strudel rather than relying on fixer-open behavior. |
| 014 | CLOSED | `tests/conformance/produce-real-chain.test.ts` exercises produce -> render -> analyze -> critique through real audio. |
| 015 | CLOSED | `docs/PACKAGING.md` / bundle command excludes cc-bridge JSONL, sessions, uploads, audio/checkpoints/archive, `.env*`, `.git`, `node_modules`; tar leak scan passed. |
| 016 | CLOSED | Same root fix as 010; `.env.local` cannot be read through the dev endpoint. |
| 017 | CLOSED | Same root fix as 008; cookbook status/provenance gate prevents those entries from default retrieval. |
| 018 | CLOSED | `packages/strudel-validator/src/mini-notation.ts` accepts `#` accidentals; failing keygen sharp-note path covered by tests. |

## Medium

| ID | Status | Evidence / Next action |
| ---: | --- | --- |
| 019 | CLOSED | `compileSessionGraph` now applies `song.cycles_per_bar` to `setcpm` and arrange section cycles; compiler test asserts `setcpm(66)` and `[32,`. |
| 020 | CLOSED | `packages/session-store/src/index.ts` calls `migrateToCurrent` on read; tests cover old supported graph migration. |
| 021 | CLOSED | Raw snippets are validated through `validateStrudelCode(stack(raw))` before compile/render. |
| 022 | CLOSED | Harmonic derivation/progression strings are validated with mini-notation guard and safe escaping. |
| 023 | CLOSED | Duplicate of 009; auto-render shell interpolation removed. |
| 024 | CLOSED | `apps/renderer-page/src/main.ts` realtime worklet flushes final partial buffer; renderer conformance covers offline/realtime durations. |
| 025 | CLOSED | `tests/conformance/renderer-conformance.test.ts` compares offline/realtime audibility and duration bounds. |
| 026 | CLOSED | `packages/analyzer/src/quality-gates.ts` onset floor uses max per-band, not summed bands; tests updated. |
| 027 | CLOSED | `packages/analyzer/src/wav-io.ts` mono mix uses sqrt channel normalization. |
| 028 | CLOSED | Failed-patch regression detector writes artifact and rollback evidence in `produce-closed-loop`. |
| 029 | CLOSED | Plateau no-score-improvement branch now has operative stop behavior. |
| 030 | CLOSED | `packages/agent-runtime/src/build-graph.ts` and genre coverage applier enforce `no_four_on_floor` / `mono_low`; tests cover. |
| 031 | CLOSED | `apps/cli/src/revise.ts` separates requested target paths from applied op paths; `revise.test.ts` covers locality. |
| 032 | CLOSED | `packages/audit/src/genre-confusion.ts` no longer loads producer `@cactus/genres` specs; it reads audit-owned `packages/audit/genre-holdout-profiles.yaml` via `genre-holdout-profiles.ts`. Tests assert the holdout profile source and genre-confusion behavior; targeted audit tests and `tsc -b` pass. |
| 033 | CLOSED | `packages/audit/src/run-audit.ts` makes `skipRender` static-only / hard-fail instead of scoring synthesized producer features. |
| 034 | CLOSED | Audit uses prompt `intent_genre`, not backend-selected genre, for champion/challenger scoring. |
| 035 | CLOSED | `packages/cookbook/src/retrieval.ts` excludes unvalidated/candidate/quarantined/rejected entries by default. |
| 036 | CLOSED | `packages/genres/src/loader.ts` validates JSONL through `CookbookEntrySchema` and filters to loadable statuses. |
| 037 | CLOSED | `packages/genres/src/maturity.ts` demotes sparse genres from production; tests assert only evidence-backed production genres. |
| 038 | CLOSED | `packages/genres/src/index.ts` validates BPM/LUFS target sanity and range ordering. |
| 039 | CLOSED | `SessionStore.appendIteration` derives next iteration from disk and tests stale callers cannot overwrite. |
| 040 | CLOSED | Duplicate of 005; eval removed. |
| 041 | CLOSED | `auto-render.ts` parses both `setcpm` and `setcps`. |
| 042 | CLOSED | `apps/cli/tsconfig.json` references expanded to imported `@cactus/*` projects. |
| 043 | CLOSED | Renderer now retries `vite --strictPort` candidate ports directly, without a pre-bind `findFreePort` probe; LOW-075 closure covers the TOCTOU root. |
| 044 | CLOSED | CLI commands that emit `ok:false` now set non-zero exit code. |
| 045 | CLOSED | `apps/renderer-page/vite.config.ts` has Strudel refs presence handling/fallback. |
| 046 | CLOSED | Duplicate of 005/040. |
| 047 | CLOSED | `apps/cli/src/producer-brain.ts` uses fetch + header key instead of shell `curl`. |
| 048 | CLOSED | Duplicate of 009/023; output paths are passed as subprocess args. |
| 049 | CLOSED | Duplicate of 001. |
| 050 | CLOSED | Duplicate of 018. |
| 051 | PARTIAL | `.github` workflow exists and `origin` is now configured for `git@github.com:cactusaudio/CactusStrudel.git`, but remote CI installation/running policy still needs a real GitHub Actions run to prove. Do not mark closed without remote CI evidence. |
| 052 | CLOSED | `scripts/verify-repo.sh` runs renderer E2E smoke and renderer conformance under `CACTUS_RENDER_E2E=1`. |
| 053 | CLOSED | `packages/agent-runtime/src/agents/loop.test.ts` now directly covers revision-planner branches for sound-palette HPF/gain, low-end width, space/room send, and pattern-density patches. |
| 054 | CLOSED | `packages/session-store/src/index.test.ts` now covers create/append/list/load, overwrite avoidance, migration, and atomic-final-file shape. |
| 055 | CLOSED | `tests/conformance/produce-real-chain.test.ts` covers real render -> analyze -> critique. |
| 056 | CLOSED | `runtime/test_serve_helpers.py` now covers `/api/update-piece-code` success, render-failure restore, manifest/revision update, and `/api/render` through the central render subprocess hook; helper/endpoint suite passes 20 tests. |
| 057 | CLOSED | `docs/LIVE_VS_RESEARCH.md` now has an explicit Stack Ownership Matrix mapping live, shared, research, inspector, and legacy-reference surfaces to owner files and proof requirements; old `docs/architecture.md` / `docs/ir.md` are bannered research-only and guarded by `scripts/verify-repo.sh`. |
| 058 | CLOSED | Duplicate of 005. |
| 059 | CLOSED | `CLAUDE.md` references `docs/LIVE_VS_RESEARCH.md`; stale doctrine explicitly bounded. |
| 060 | CLOSED | Zombie architecture claims are retired in `docs/LIVE_VS_RESEARCH.md` under Retired Zombie Claims; `docs/architecture.md` and `docs/ir.md` no longer present themselves as current product architecture; `verify-repo.sh` enforces these banners. |
| 061 | CLOSED | `runtime/serve.py` uses tail-bounded JSONL cache for tasks/state reads. |
| 062 | CLOSED | `runtime/main.html` `parseMixTracks` builds one ignored mask instead of rescanning per effect. |
| 063 | CLOSED | `packages/analyzer/src/rhythm.ts` and `spectral.ts` dispose Essentia WASM vectors. |
| 064 | CLOSED | Analyzer call sites use decoded-audio helpers to avoid repeated `readWav`. |
| 065 | CLOSED | `packages/analyzer/src/section-features.ts` no longer uses the former O(N^2) DFT; per-section brightness uses bounded zero-crossing centroid proxy. |
| 066 | CLOSED | `docs/LIVE_VS_RESEARCH.md` now declares `references/` as research-only, non-live and non-packaged; `docs/PACKAGING.md` excludes it; `packages/genres/src/index.test.ts` cross-checks production `genres/*.yaml` against reference descriptors for LUFS, true-peak, and BPM drift; cookbook reference schema tests pass. |
| 067 | CLOSED | `runtime/serve.py` prunes bridge task rows and caps tail reads. |
| 068 | CLOSED | `runtime/serve.py` surfaces AGPL source offer. |
| 069 | CLOSED | `scripts/verify-repo.sh` scans operational scripts for portable hardcoded root paths. |
| 070 | CLOSED | `producer-brain/kernel.lock.json` and runtime checks guard prompt kernel integrity. |

## Low

| ID | Status | Evidence / Next action |
| ---: | --- | --- |
| 071 | CLOSED | `validateStrudelCode` now tracks local aliases to Strudel functions, checks computed string-literal method names, and caches merged extra function sets; validator tests cover alias + computed method behavior. |
| 072 | CLOSED | `compileSessionGraph` now calls `cb.build()` once; source-map cleanup remains non-blocking but no duplicate build inconsistency. |
| 073 | CLOSED | `validateMiniNotation('')` now returns ok with no issue, and `combineResults` is a simple all-results-ok merge; validator tests pass. |
| 074 | CLOSED | Renderer lifecycle tests cover refcount underflow, explicit shutdown idempotence, warmup surface, and no-boot batch behavior; shutdown/release remains idempotent while strictPort boot is retry-safe. |
| 075 | CLOSED | Renderer no longer pre-probes a free port; it generates deterministic candidates and lets `vite --strictPort` bind/retry as the source of truth. Lifecycle test covers candidate policy. |
| 076 | CLOSED | `packages/mastering/src/index.ts` now uses a continuous tanh soft limiter over the top 10%; mastering tests cover continuity across knee and ceiling. |
| 077 | CLOSED | `section-features.ts` uses corrected p95 indexing, RMS fallback for tiny windows, and zero-crossing centroid proxy for short slices. |
| 078 | CLOSED | `packages/analyzer/src/loudness.ts` guards invalid sample rates and non-finite samples/biquad output; analyzer tests cover edge inputs. |
| 079 | CLOSED | `parseBrief` now ranks genre matches by first occurrence in user text, with specificity tie-breaks; tests cover `house with techno` vs `techno with house`. |
| 080 | CLOSED | `packages/critic/src/index.ts` now scores neutral `user_taste_fit=0.5` without decisions and uses preference decisions when present; critic test covers. |
| 081 | CLOSED | `packages/preference/src/feedback.ts` no longer caps boosts before normalization; preference test covers concentrated boost math. |
| 082 | CLOSED | `packages/critic/src/index.ts` emits generic LUFS targets when genre load fails; critic test covers `target_source=generic`. |
| 083 | CLOSED | `packages/session-store/src/index.ts` writes JSON through temp+rename; tests cover final-file shape. |
| 084 | CLOSED | Same migration-on-read evidence as MED-020. |
| 085 | CLOSED | Analyzer quality thresholds now live in `packages/analyzer/quality-gates.yaml` with ADR/evidence pointers and are loaded through `quality-gate-config.ts`; silence and quality-gate code consume the registry. Targeted analyzer tests, `tsc -b`, and `pnpm install --frozen-lockfile` pass. |
| 086 | CLOSED | Hardcoded `apps/cli/src/midi-render.ts` was moved out of compiled CLI source to `apps/cli/docs/midi-render-dev-scratch.ts`; supported MIDI export remains `midi-export.ts`. |
| 087 | CLOSED | Renderer `queryHaps` maps Strudel drum/sample haps to GM drum notes on channel 10; renderer conformance tests cover `bd/sd/hh/oh` MIDI notes/channels. |
| 088 | CLOSED | `apps/studio-ui/src/server/artifact-api.ts` now uses a product allowlist instead of broad root+extension exposure: Studio can list session/audit/ledger directories, read only known JSON/MD/Strudel artifacts through `/api`, and fetch WAV/PNG session artifacts only through `/artifact`. Server tests cover URL rewrites, denied `references/`, denied `tests/fixtures`, denied broad `cookbook/`, `/api` vs `/artifact` separation, and ledger/audit narrow paths; Studio loader tests and `tsc -b` pass. |
| 089 | CLOSED | `cactus produce --no-render --mode audit/closed-loop` now emits `ok:false` and exits non-zero instead of silently coercing; manual CLI check confirmed. |
| 090 | CLOSED | `apps/cli/src/index.ts` uses explicit finite parse helpers instead of `parseInt/parseFloat(...) || default` for option defaults. |
| 091 | CLOSED | `apps/cli/src/midi-export.ts` rejects non-finite/non-positive cycles and CPS before timing math. |
| 092 | CLOSED | Studio UI screenshot script and vite config now share `STUDIO_UI_URL` / `STUDIO_UI_PORT` controls instead of hardcoded-only localhost:5174; `node --check` and `tsc -b` pass. |
| 093 | CLOSED | `runtime/serve.py` `_safe_download_stem` strips to `[A-Za-z0-9._-]`, preventing CRLF header injection. |
| 094 | CLOSED | `openmpt123 --info` path is JSON-stringified and not shell-expanded in the checked path; low risk but should become exec-arg style if touched. |
| 095 | CLOSED | Static `runAudit(skipRender)` tests are explicitly labeled static-only; true render behavior is covered by renderer conformance, produce real-chain conformance, `/api/render` endpoint tests, and `audit:repair` real-WAV smoke in `scripts/verify-repo.sh`. |
| 096 | CLOSED | Stale fixed test-count claims are no longer used as acceptance evidence here; the repo truth gate reports live counts during `pnpm test` and now separately runs renderer and produce conformance. |
| 097 | CLOSED | Live/research boundary doc updates prevent live product doctrine overclaim. |
| 098 | CLOSED | Same boundary fix as 097; CLI split personality is documented. |
| 099 | CLOSED | Runtime JSONL tail cache reduces run-agy poll reparsing pressure. |
| 100 | CLOSED | `applyPatch` now performs structural-sharing path copies instead of full-graph deep clone; IR test proves untouched branches preserve reference identity. |
| 101 | CLOSED | Runtime corpus reads now use `_read_jsonl` caching for manifest entries and brain corpus tail, with invalidation on manifest append/rewrite; helper tests cover cache invalidation. |
| 102 | CLOSED | `validateStrudelCode` caches merged extra function sets, and brain memory uses cached pilot-doc text plus cached corpus tail JSONL; runtime helper tests cover cache invalidation. |
| 103 | CLOSED | `runtime/main.html` now has visible keyboard focus, nav/aside/editor landmarks, status/log `aria-live`, tab roles/selection sync, iframe titles, and key input/button labels. |
| 104 | CLOSED | Installer verifies optional `cactus-strudel-bundle.tar.gz.sha256` before extraction and waits/escalates old port-8765 shutdown; packaging docs now ship the checksum sidecar. |

## Remaining Recommended Work

1. Remaining MED-051 needs a real remote GitHub CI run to prove the workflow outside the local machine. `origin` is now configured for `git@github.com:cactusaudio/CactusStrudel.git`; close only after `gh run view` shows the workflow completed successfully.
