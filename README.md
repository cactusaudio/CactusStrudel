# Cactus Strudel

Autonomous Strudel-centered music producer substrate. Talk → audio.

```
brief → BriefGraph → SongGraph IR → PatternBank/MixGraph
      → deterministic Strudel compiler
      → headless render
      → MIR/audio analysis + spectrogram critic
      → targeted revisions
      → master + stems + editable SessionGraph + Strudel code
```

The product is a closed-loop producer, not "LLM writes Strudel code". Generation,
render, analysis, and critique are all required for an artifact to count.

## Status

Active build. Phase 15 (champion baseline repair + rubric calibration) is the
latest committed milestone. Phase 14 introduced the adversarial audit harness;
Phase 15 repaired the deterministic rules champion against the failures the
harness surfaced. See `docs/architecture.md` for the architecture and
`docs/audits/` for audit findings + ADR-recorded calibration decisions.

## Quick start

```bash
pnpm install
pnpm exec tsc -b        # project-references build
pnpm test               # unit suite (~250 tests; 6 E2E gated behind CACTUS_RENDER_E2E)
pnpm cactus -- audit:repair                       # real-WAV smoke audit
pnpm cactus -- produce -b 'dark dub techno 130 BPM, haunted'
pnpm cactus -- audit --suite genre-core --seeds 3 # full 150-render audit
```

`scripts/verify-repo.sh` runs the full G0 reproducibility gate (install + tsc + test + audit:repair).

## CLI commands

| Command | Purpose |
|---|---|
| `cactus produce` | Generate a full track from a brief; writes session bundle. |
| `cactus sketch` | N-candidate parallel sketches at different seeds. |
| `cactus revise` | Apply natural-language feedback to an existing session. |
| `cactus stems` | Per-orbit stem export for an existing session. |
| `cactus explain` | Dump iteration history for a session. |
| `cactus taste` | Inspect preference memory across sessions. |
| `cactus audit` | Run an adversarial audit suite (smoke / genre-core / custom). |
| `cactus audit:repair` | Champion baseline repair audit (smoke + real WAV + diagnostics). |

Run `pnpm cactus -- <cmd> --help` for full options.

## Backends

| Name | Status |
|---|---|
| `rules` | Permanent champion. Deterministic build-graph + compile + render. |
| `claude-shadow` | Seam in place; requires injected Claude dispatcher to actually run. Throws `ClaudeBackendNotConfigured` otherwise. |
| `hybrid` | Rules baseline + Claude JSON Patch overlays. Same dispatcher requirement. |

## License

AGPL-3.0-or-later (matches Strudel + essentia.js to keep license boundaries
clean — see ADR 0001).
