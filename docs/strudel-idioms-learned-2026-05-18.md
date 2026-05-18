# Strudel composition idioms — learned from the corpus (2026-05-18)

Evidence: 149 corpus files frequency-scanned + close-read of
Blue Monday cover, Mario theme, eefano/warsaw.js (the advanced model).

## What real Strudel composers actually do

1. **Tempo:** `setcpm(BPM/4)` (34% > setcps 23%).
2. **Harmony engine = scale-helper + degree patterns.** Factor a
   one-liner: `const nk = x => n(x).scale(["A#3","minor"])`. Write all
   melody/bass/chords as scale-DEGREE strings; `nk(...)` makes them
   auto-coherent. Chords = simultaneous degrees `"<[-2,0,2] [-3,-1,0]>/4"`.
   `.add(7)/.sub(14)` to transpose a part by degrees/octaves. (.scale
   34% + degree n() 25% — the dominant coherence idiom.)
3. **Patterns as named `const` degree-strings** using `<a b c>`
   alternation, `@n` weights, nested `[...]`, `~` rests, `,` for
   simultaneous. The musical content lives in these strings.
4. **Timbre = reusable helper fns:** `const deep = x => x.s("saw")
   .lpf(700).adsr([.02,0,1,.02]).gain(.8)`, applied `.apply(deep)`.
5. **Drums = `.bank("RolandTR909")`** (85 uses, dominant; also R8,
   Linn9000, AkaiLinn). Drum patterns: `"<bd [sd bd] [~ bd] sd>"`,
   `,`-stacked with hats. Bank carries the character.
6. **Arrangement, two tiers:**
   - simple: one `stack(` of const layers; each layer's own `<...>`
     alternation gives per-cycle variation/evolution.
   - advanced (warsaw): a master **score** pattern
     `"<0@2 [0,1]@2 ...>/16".pickRestart({0:partA,1:partB,...})`
     that selects/stacks named parts over song-time; a parallel
     `drums: "<...>/16".pickRestart({...}).pickOut({tok:sound})`.
     (arrange() only 9%, .mask 4% — NOT the main idiom.)
7. **Polish chain:** `.clip()` (note length! 40%), `.room()` 52%,
   `.lpf()` 41%, `.gain()` 67%, `.delay()`, `.adsr()/.lpa/.lpe`,
   `.pan()`, `.struct()` 20% for rhythm, `.fast/.slow`.
8. **Restraint:** perlin 1%, superimpose 3%, lpenv 0% — these are
   NOT idiomatic. Character comes from banks + clip + room + good
   degree-writing + `<...>` variation, not modulation tricks. (My
   earlier Nightfall over-used the rare fancy stuff.)

## Sounds palette (idiomatic)
drums via bank: bd hh sd cp oh lt mt cr rd. synth: sawtooth square
sine triangle tri saw supersaw; gm_* for bass/guitar/pad
(gm_synth_bass_1, gm_electric_bass_finger, gm_pad_*). Note: our
offline renderer lacks banks/gm_ → compose for strudel.cc; verify
structure on oscillators; deliver via link + mp3, honest re timbre.

## Method for my compositions
scale-helper → named degree consts (real melodic/harmonic content) →
timbre helpers → stack or pickRestart score → bank drums → clip/room
polish. Then render → read as musician → revise → only ship what I
judge good.
