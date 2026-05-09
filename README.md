# Cactus Strudel

Autonomous Strudel-centered music producer. Talk → audio.

```
brief → BriefGraph → SongGraph IR → PatternBank/MixGraph
      → deterministic Strudel compiler
      → headless render
      → MIR/audio analysis + spectrogram critic
      → targeted revisions
      → master + stems + editable SessionGraph + Strudel code
```

The product is a closed-loop producer, not "LLM writes Strudel code". Generation, render, analysis, and critique are all required for an artifact to count.

## Status

Active build. See `docs/architecture.md` for the architecture and `docs/research/substrate-audit.md` for current substrate findings.

## Quick start

```bash
pnpm install
pnpm build
pnpm test
pnpm dev:renderer    # local renderer page on :5173
pnpm cactus -- produce --brief "dark spacious dub techno; 132 BPM; haunted; 909 core"
```

## License

AGPL-3.0-or-later. Strudel and essentia.js dependencies are AGPL; this repo matches to keep license boundaries clean.
