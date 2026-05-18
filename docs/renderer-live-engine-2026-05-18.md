# renderer-page now runs the LIVE strudel.cc engine (option 3, 2026-05-18)

Bowei pivot: Claude can't hear; Gemini (multimodal) is the producer.
Unconstrained Gemini writes CURRENT strudel.cc idiom that npm @strudel
1.3.0 (stale) can't eval. Option 3 = make our renderer BE the live
engine.

Done: cloned codeberg.org/uzu/strudel (2026-05-07 source) into
refs/strudel-monorepo (gitignored — SETUP DEP: renderer-page requires
it present; `git clone --depth 1 https://codeberg.org/uzu/strudel.git
refs/strudel-monorepo && (cd refs/strudel-monorepo && pnpm i)`).
apps/renderer-page wired via vite alias (@strudel/* → monorepo) +
the monorepo's vite-plugin-bundle-audioworklet + fs.allow + soundfont/
dough/drum-machine prebake. The offline-render shim was rewritten to
ride the engine's OWN renderPatternAudio (hijack its WAV blob →
pcmBase64), so it tracks the engine instead of rotting. Pinned
compiler/validator untouched.

Verified: page boots, the live engine evaluates + renders; it now
emits REAL errors (e.g. `.stutter is not a function`) — exposing the
true remaining issue: unconstrained Gemini HALLUCINATES Strudel APIs.
Fix path = minimal, evidence-based API-correctness self-heal (the
engine's real error fed back), NOT the old creativity cage.

Known prebake gaps (non-fatal): ritchse/tidal-drum-machines + a
dirt-samples map 404 (moved sources) — refine later; soundfonts/dough
load.
