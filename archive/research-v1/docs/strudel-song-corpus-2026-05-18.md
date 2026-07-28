# Local Strudel Song Corpus — Acquired 2026-05-18

Real human-written, idiomatic Strudel songs = the highest-value
learning substrate (already native, already sound good on
strudel.cc — unlike keygen/MIDI transcription which feeds the lossy
pipeline). Bowei-directed: "全网找 strudel song library 并下载到本地".

Provenance (CLAUDE.md hard rule): everything under
`refs/strudel-songs/` — **gitignored, local study reference only,
NOT redistributed, NOT trained-on-for-a-distributed-model**.
Community-contributed code; this manifest is index + provenance only,
no song bodies.

## Sources acquired

| source | how | songs | notes |
|---|---|---|---|
| eefano/strudel-songs-collection | git clone | 64 (+32 short) | the main corpus; studied earlier (docs/strudel-corpus-study.md) |
| terryds/awesome-strudel | git clone; README is a link index | — | followed its links + "Tracks" section |
| awesome-strudel "Tracks" (embedded `strudel.cc/#base64`) | decoded directly (no network) | 11 | canonical hand-written COVERS: New Order – Blue Monday, Mario theme, Toby Fox – Determination, Grimes cover, … — best idiomatic examples |
| Revolver86/strudel.cc-scripts | git clone | 5 | large multi-section original pieces (up to 469L) |
| thedudesinc/strudel-library | git clone | 1 (+3) | |
| Claffystic/StudelProjects, prismograph/departure, eddyflux/crate, mot4i/garden, QuantumVillage/quantum-music | git clone | 3 | single-song project repos (strudel.json REPL saves normalized → .js) |
| terryds/learning-music-production-with-strudel | git clone | — | Notion-export tutorial book (learning text, not songs; snippets extracted but flagged) |

`/samples` repos from the awesome list were skipped (audio sample
packs, not song code).

## Inventory

- **~83 substantial songs** (≥14 lines, ≥3 layers, structured) +
  ~63 shorter examples/fragments.
- Top by size: Revolver86 EXAMPLE_PATTERNS (469L), Mario theme
  (350L), neural_collapse_song (320L), ghost_in_the_static (275L),
  Determination (112L), eefano swimandsleep (102L), piazzadegliaffari
  (79L), warsaw (78L).

## Use

The corpus is the reference/learning base for composing idiomatic
Strudel directly (the validated direction: hand-write music, listen,
iterate — not the lossy IR→compiler pipeline). The embedded-source
canonical covers are the cleanest exemplars of real arrangement
(`arrange()`/`mask`/`stack`), `scale()`-based harmony, and sound
design as a human writes it.

Tooling: extraction script logic lives in this session's history
(decode `strudel.cc/#base64`, normalize `strudel.json`); re-runnable.
