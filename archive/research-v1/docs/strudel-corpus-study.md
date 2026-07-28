# Strudel Corpus Study — Why Our Output Is 难听 and What the IR Must Become

Date: 2026-05-17
Corpus: eefano/strudel-songs-collection (85 songs) + terryds/awesome-strudel
Method: programmatic feature extraction across **all 85** files (no
sample-generalization) + close-read of the richest cluster AND the
simplest-still-musical songs.

This document is the forensic study Bowei asked for before any code.
It supersedes my first 5-song hot take, which over-indexed on the
three most sophisticated songs.

---

## 1. Hard frequency data (all 85 songs)

Corpus: 85 songs, 2750 lines, **mean 32 lines/song** (median 25, max
102). They are NOT 10× bigger than our output — they are a different
*kind* of writing.

Technique adoption (songs using ≥1):

| tier | technique | % | what it is |
|---|---|---|---|
| universal | `s()` sample | 95% | named sound source |
| universal | `@` weight | 93% | rhythmic emphasis / duration |
| universal | `<…>` angle-seq | 88% | per-cycle alternation (the spine of form) |
| universal | `*` speed | 81% | subdivision |
| universal | `gm_` instrument | 75% | General-MIDI timbre, not raw osc |
| universal | `const` part defs | 75% | song built from named musical phrases |
| universal | `!` replicate | 73% | repetition with control |
| core | `note()` literal | 64% | note names (NOT a crime — see §2) |
| core | nested `[…]` | 61% | polyrhythm / sub-grouping |
| core | `lpf/hpf` | 60% | spectral shaping |
| core | `n()` degrees | 59% | scale-degree melody |
| core | `pick/pickRestart` | 59% | **song form: a sequence picks named phrases** |
| core | `stack()` | 55% | layering |
| core | labeled parts `$:` | 55% | declarative multi-part score |
| core | chord-stacks `[a,b,c]` | 53% | simultaneous notes |
| core | `adsr/envelope` | 51% | amplitude shaping |
| common | `scale()` | 48% | key+mode interpretation |
| common | `bank()` | 40% | drum-kit selection |
| common | `transpose()` | 39% | octave/harmonic shift |
| common | `struct()` | 34% | rhythm applied to pitch (separates *when* from *what*) |

## 2. The corrected diagnosis (sharper than "use n() not note()")

64% use `note()` with literal names — so literal notes are **not** the
crime. The crime is the **intersection of three failures**, and our
output is the only thing in or out of the corpus that hits all three:

1. **Rhythmically inert.** The 4 most universal techniques
   (`@` 93%, `<…>` 88%, `*` 81%, `!` 73%) are exactly the
   mini-notation richness our compiler never emits. We emit
   `bd ~ ~ ~ bd ~ ~ ~`. They emit
   `<bd [sd bd] [~ bd] sd bd sd [~ <bd!3 sd>] [sd sd*2]>`.
2. **Sonically bare.** `gm_` 75% / `adsr` 51% / `lpf` 60% / `bank` 40%.
   We emit `s("sawtooth")` and `s("fm")` with no envelope, no filter,
   no kit. A held `s("fm")` note is not a pad.
3. **Harmonically incoherent.** This is the deepest one →

## 3. The single missing primitive: a shared harmonic spine

The smoking gun is `edenontheair.js` — **9 lines, 6 techniques, fully
musical**:

```js
const chrds = "A@2 E@2 A F#m B@2 E@2 A ~ F#@4 …".slow(25/4);   // ONE progression
stack(
  n(run(6).palindrome().fast(5)).chord(chrds).voicing().s("gm_electric_guitar_jazz"),
  chord(chrds).voicing().s("gm_piccolo")
).gain("0.4@12 1@4 …".slow(25/4)).cpm(95/4).room(0.5)
```

`savour.js` confirms it at full scale: `reed`, `bass`, `guit`, `melo`
are **all derived from one shared `ch0rds` progression** —
`chord(ch0rds).voicing().mode('root')` for bass, `.mode('above')` for
reed, `n(degrees).chord(ch0rds).voicing()` for the line. Every layer is
a *function of the same harmony*.

**Our SessionGraph has no shared harmonic source.** Each layer carries
an independent literal pattern; `brief.key` exists but nothing consumes
it; "chord" is a static `<a3 c4 e4>` that never moves with a
progression; bass is a stuck root. Layers do not agree on a key, there
is no progression, nothing resolves. *That* is why it is noise — not
"missing features", **missing harmonic agreement between layers**.

## 4. The minimal listenable skeleton (what to actually build)

From `edenontheair` (floor) + `savour`/`swimmingsnake` (scale), the
irreducible recipe is **five things**, in priority order:

1. **Harmonic spine**: one progression OR one (possibly modulating)
   scale, declared once per song.
2. **Every pitched layer derives from it**: chord = voiced spine;
   bass = roots/`mode('root')`; melody/lead = degrees voiced against
   the spine (`n(deg).chord(spine).voicing()`).
3. **Real timbre**: `gm_*` instruments (or `supersaw`+filter env), not
   raw oscillators; `.adsr()` on every voice.
4. **Rhythmic life**: patterns use `<…> [ … ] @ * !`, not flat grids;
   `struct()` to apply rhythm to the harmonic line.
5. **Form via pick**: a song-time `<phraseToken@bars …>` sequence
   `.pickRestart({named phrases})` + a `.gain("…".slow(songLen))`
   envelope — not flat per-section gain on the same primitive.

Drums are the *only* place literal sample patterns are right, and even
there they're `<nested , polyrhythmic>` through a `.bank()` kit with
per-hit `velocity/speed/pan`.

## 5. Proposed IR redesign (focused, evidence-derived — not "add 30 features")

The leverage is **one new IR block + a compiler that makes every layer
a function of it**. Concretely:

- `SessionGraph.harmony`: `{ key, mode, progression: Chord[],
  progression_rhythm, modulation? }`. This is the spine §3 says is
  missing. Authored once; the brief parser already extracts key.
- Layer roles re-typed as **derivations of the spine**, not literal
  strings:
  - `chord` → `chord(progression).voicing().s(gmInstrument)`
  - `bass`  → `chord(progression).mode('root').anchor(oct)` or
    `n("0").chord(progression)`
  - `lead`/`melody` → `n(degreePattern).chord(progression).voicing()`
  - `pad`   → `chord(progression).voicing()` long `.adsr`
  - `kick/hat/perc` → unchanged literal samples BUT compiled with
    `<…>` rhythmic templates from a real drum-pattern library, through
    `.bank()`
- `sound_palette` gains a `gm_instrument` field per pitched layer +
  mandatory `.adsr`; raw-oscillator fallback only if no GM match.
- The compiler's `arrange()` flat-gain-per-section is replaced by the
  §4.5 pick-form + gain-envelope pattern.
- Cookbook entries re-authored as **degree/scale phrases**, not the
  current dead literals (`tk-bass-001 = "a1 ~ a1 ~"` becomes a
  degree pattern over the spine).

This is a core redirection of the producer's musical model, scoped to
exactly what 100% of listenable corpus songs share. It does not chase
the 8% LFO/dist long tail.

## 6. Honest note on the prior 504-test "production-grade" verdict

Every gap I closed (measurement trust, genre honesty, taste
convergence, cookbook value) was real plumbing, and the gates now
measure honestly — but they measure **non-silence, LUFS, onset
density**, never harmony or melody. The system graded its own homework
on the wrong rubric. Bowei's ear falsified the entire self-eval stack
in 30 seconds. The corpus study is the new rubric: a track is musical
iff it has a harmonic spine that every layer derives from. The next
work is building that, then re-deriving the critic from it.

Next decision (Bowei owns): approve the §5 IR redesign as the path,
and whether to prove it on one genre vertical-slice first or design the
full `harmony` schema before any compile change.
