# CactusStrudel runtime v2 — frozen

This directory freezes the final pre-v3 operating surface for forensic
comparison. It is not the executable behind `runtime/serve`, is not an API
compatibility promise, and must not be started alongside the v3 runtime.

The matching GUI source and screenshots are in
`archive/gui/ui-v2-baseline-20260728-95f85f6/`.

Contents:

- `serve.py`: former single-file HTTP runtime;
- `user_config.py`: retired plaintext-compatible v2 settings loader; the
  live API key was cleared during v3 cutover;
- `tests/`: former single-file runtime helper tests;
- `data/cc-bridge/`: machine-local v2 bridge queues, transcripts, and edit
  evidence moved out of the live runtime; transient per-task logs and the live
  `.kick` marker were excluded as process residue;
- `gf/`: web-Gemini scraper, dedicated-Chrome launcher, and wrapper;
- `bin/`, `scripts/`, `claude-commands/`: former operator entrypoints;
- `docs/`: superseded handoff, packaging, milestone, pilot, and v2
  architecture documents;
- `developer/`: the superseded Developer Mode knowledge base.

Historical evidence remains readable here. None of these paths is part of the
v3 control plane.

Archive moves are byte-identical by default. The exceptions under this tree
are explicit annotations or transformations, not byte-identical copies. See
[`../transformations.json`](../transformations.json) for the original/new paths,
full Git blob OIDs, classification, and reason for each exception.
