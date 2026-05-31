# AGY Strudel Official Brief

Read this before generating CactusStrudel music. This is a syntax, local-render compatibility, and producer-discipline memo. It is not a style lock: keep full creative freedom for genre, harmony, arrangement, timbre, density, and form.

## Official Source Anchors

- Tempo: `refs/strudel-monorepo/packages/core/repl.mjs` documents `setcpm(140/4)`.
- Chord control: `refs/strudel-monorepo/packages/core/controls.mjs` registers `chord`.
- Voicing: `refs/strudel-monorepo/packages/tonal/voicings.mjs` says `voicing()` needs a `chord` control and shows `n("0 1 2 3").chord("<C Am F G>").voicing()`.
- Arp: `refs/strudel-monorepo/packages/core/pattern.mjs` shows `.arp("0 [0,2] 1 [0,2]")` selecting indices from stacked notes.
- Mini-notation: `refs/strudel-monorepo/packages/mini/test/mini.test.mjs` confirms commas make parallel events, brackets group events, and angle brackets slowcat across cycles.
- Mask: `refs/strudel-monorepo/packages/core/pattern.mjs` documents `.mask("<1 [0 1]>")`.

## 062-079 Error Inventory

- 062, 067, 068 used `gm_electric_piano_1`; installed Strudel soundfonts use `gm_epiano1`.
- 065 used `gm_warm_pad`; installed Strudel soundfonts use `gm_pad_warm`.
- 066 used `gm_halo_pad`; no such installed GM soundfont. Use a real key such as `gm_pad_warm`.
- 066 and 079 applied `.arp(...)` directly to raw `chord(...)` values. Use `chord(...).voicing().arp("0 2 1 3")` so arp sees stacked notes.
- 070, 074, 076, 077 used chord symbols inside `note(...).voicing()`. Chord symbols belong in `chord(...)` or `.chord(...)`, not `note(...)`.
- 071 used invalid note tokens: `C4maj7 A3m7 F3maj7 G37`. Write chord symbols as `Cmaj7 Am7 Fmaj7 G7`, then call `.voicing()`.
- 071 and 072 used `.bank("linn")`; exact installed bank name is `LinnDrum`.
- 076 used `.bank("tr808")`; exact installed bank name is `RolandTR808`.
- 078 used `.bank("rolandtr808")`; bank names are case-sensitive, use `RolandTR808`.
- 079 used `.bank("mimic")`; no such installed drum bank. Use a real bank such as `RolandTR808`, `RolandTR909`, `RolandTR707`, `LinnDrum`, or `AlesisHR16`.
- 067 had official-looking sample drum code, but in the current Cactus realtime renderer `s("bd/sd/hh")` drum-only renders can be silent. The repaired version uses pitched synth/GM drums and expands the final stack.
- 064 was not a syntax error: `chord("[Dm9, Bbmaj9, C9, Am9]")` means parallel comma events. If a progression is intended, use `chord("<Dm9 Bbmaj9 C9 Am9>")` or `chord("Dm9 Bbmaj9 C9 Am9").slow(4)`.

## Producer Discipline Addendum

These rules are distilled from Bowei's AI Music Producer handoff. They are musical operating rules, not mandatory genre templates. Do not paste long handbook examples verbatim; choose the relevant moves and still obey the local syntax/render constraints below.

Core production flow:

```text
intent -> form -> groove -> harmony -> bass -> motif -> texture -> variation -> mix -> runnable code
```

Musical priorities:

- Repetition makes the piece memorable; phrase-level variation keeps it alive.
- Stable anchors matter more than clever syntax: clear pulse, simple low end, harmonic center, and one recognizable motif or groove identity.
- Use 4-6 coherent layers by default: drums/groove, bass, chords/pad/keys, motif/lead, percussion or texture/fx.
- Keep frequency ownership clear: kick/sub and bass should not fight; chords own midrange identity; hats/texture own air and motion.
- Do not make every layer equally busy. Grid, syncopation, stabs, sparse motif, and slow texture should each have different jobs.

Randomness discipline:

- Main hook: mostly deterministic.
- Bass and kick: nearly deterministic.
- Hats/percussion: lightly variable.
- FX/ear candy: may be more probabilistic, but low gain and sparse.
- Prefer `degradeBy`, `sometimes`, `someCyclesBy`, `lastOf(4)`, `lastOf(8)`, and `arrange(...)` for bounded variation.
- Avoid pure random pitch as the lead idea. A short motif with small transforms is usually better than scale wandering.

Harmony and melody:

- Prefer `chord(...).voicing()` for harmonic material when the style benefits from chords.
- Let bass follow roots, fifths, octaves, or simple chord-derived tones before adding syncopation.
- Let melody come from a short `n(...).scale(...)` motif or from `n(...).set(chords).voicing()`.
- Use one tasteful harmonic surprise or borrowed move if it serves the brief; do not stack complex extensions every cycle without a motif anchor.

Arrangement:

- If no explicit form is requested, make the loop work for a 24-cycle render.
- Minimum phrase behavior: small change every 4 cycles, clearer fill or deletion every 8 cycles, section contrast if using `arrange(...)`.
- Fills belong at phrase endings; do not randomize every event to create fake movement.

Mix discipline:

- Most layer gains should stay below `.9`; very quiet texture layers are fine.
- Keep room/delay controlled unless ambient is explicitly requested.
- Separate conceptual roles with `orbit(...)` when using space/delay, but do not let orbit tricks replace audible musical structure.
- Do not use destructive FX, dense 32nd-note patterns, or heavy reverb as default excitement.

## Generation Contract

- Output exactly one fenced `javascript` code block. No explanation.
- The code must be complete and pasteable into Strudel.
- Put tempo on its own line: `setcpm(120/4)`. Do not write `stack(...).setcpm(...)`.
- The final expression must evaluate to a Strudel Pattern, usually `stack(...)` or `arrange(...)`.
- Prefer a 24-cycle-friendly loop or an explicit `arrange([len, pattern], ...)`.

## Safe Core Syntax

Tempo:

```javascript
setcpm(120/4)
```

Notes and scales:

```javascript
note("<c2 eb2 g2 bb2>")
n("<0 2 4 6>").scale("c:minor")
```

Chords and voicings:

```javascript
chord("<Cmaj7 Am7 Fmaj7 G7>").voicing()
n("0 1 2 3").chord("<Cmaj7 Am7 Fmaj7 G7>").voicing()
```

Explicit note stacks:

```javascript
note("<[c3,e3,g3,b3] [a2,c3,e3,g3]>")
```

Arp after voicing or explicit note stacks:

```javascript
chord("<Cm9 Fm9 Bb9 Ebmaj7>").voicing().arp("0 2 1 3")
note("<[c4,eb4,g4,bb4] [f4,ab4,c5,eb5]>").arp("0 2 1 3")
```

Mini-notation:

- `<a b c>` = slow alternation across cycles.
- `a b c` = sequence inside a cycle.
- `[a b]` = grouped faster subdivision.
- `c3,e3,g3` = parallel events at the same time.
- `~` = rest, `!N` = repeat, `*N` = subdivide/repeat, `@N` = elongate.

Structure:

```javascript
const a = stack(part1, part2)
const b = stack(part3, part4)
arrange([8, a], [8, b])
```

For Cactus realtime compatibility, avoid wrapping a stack variable inside another stack. Prefer:

```javascript
stack(kick, snare, hats, chords, bass, lead)
```

over:

```javascript
const drums = stack(kick, snare, hats)
stack(drums, chords, bass, lead)
```

## Names That Are Known Good Here

Synth/audio names that have rendered in this repo:

- `sine`, `saw`, `sawtooth`, `square`, `triangle`, `supersaw`, `piano`

GM soundfonts that are installed and useful:

- `gm_epiano1`
- `gm_pad_warm`
- `gm_acoustic_bass`
- `gm_synth_bass_1`
- `gm_flute`
- `gm_synth_drum`

Exact drum bank names known from installed tidal drum machines:

- `RolandTR808`
- `RolandTR909`
- `RolandTR707`
- `LinnDrum`
- `AlesisHR16`

Do not invent English-like GM names. These failed in 062-079:

- `gm_electric_piano_1`
- `gm_warm_pad`
- `gm_halo_pad`

Do not use lower-case or nickname banks:

- bad: `linn`, `tr808`, `rolandtr808`, `mimic`
- good: `LinnDrum`, `RolandTR808`, `RolandTR909`

## Drum Reliability For Cactus

Important correction from the 084-093 Advanced run: code-level drum variables are not enough. AGY wrote `kick`, `snare`, and `hats` for all 10 pieces, but Bowei could not hear drums. Treat this as a failed drum outcome. The goal is an audible drum kit / groove anchor, not merely syntactically present drum layers.

Default rule for non-ambient presets:

- Drums are required in the main groove/drop unless the prompt explicitly says drumless.
- Kick, snare/clap, and hats must be directly audible and mixed forward enough to identify as drums.
- Put kick/snare/hat layers directly in every main/drop section stack.
- Do not let pads, leads, room, or bass mask the drum transients.
- Do not satisfy the drum requirement with ultra-short pitched sine/triangle bleeps only. Those can render but may not read as drums.
- Prefer a percussive fallback kit using kick body + noise snare + noise hats. Official samples may be layered only as color, not as the only drum path.

Official Strudel sample drums use `s("bd sd hh").bank("RolandTR909")`, but the current Cactus realtime renderer can produce silent sample-drum-only renders. For Cactus, use a locally audible fallback kit like this:

```javascript
const kick = note("c2 ~ c2 ~ c2 ~ c2 ~")
  .s("sine").decay(0.12).sustain(0).release(0.03).gain(1.1).lpf(130)

const snare = note("~ ~ d3 ~ ~ ~ d3 ~")
  .s("white").decay(0.06).sustain(0).release(0.04).gain(0.45).hpf(1200).lpf(6500)

const hats = note("g5 g5 g5 [g5 g5] g5 g5 g5 [g5 g5]")
  .s("white").decay(0.015).sustain(0).release(0.01).gain(0.12).hpf(5000)
```

`gm_synth_drum` and triangle hats are allowed as extra color, but do not rely on them as the only snare/hat identity when the prompt asks for an audible beat.

Do not put `.duckorbit(...)`, `.duckdepth(...)`, or `.duckattack(...)` on a sound-producing synth kick unless you have validated it. In 067 this made the drum path inaudible in local checks. If sidechain is needed, keep it simple or omit it.

Do not hide drums inside a nested stack variable. This failed again in Advanced piece 083: AGY wrote `const drumsFull = stack(kick, snare, hats)` and then used `stack(drumsFull, bass, chords, lead)`, which can make the drum path inaudible in the local renderer. Put drum layers directly into the audible section stack:

```javascript
const groove = stack(kick, snare, hats, bass, chords, lead)
```

not:

```javascript
const drums = stack(kick, snare, hats)
const groove = stack(drums, bass, chords, lead)
```

## Hard No

- Do not put chord symbols in `note(...)`: bad `note("Cmaj7 Am7").voicing()`.
- Do not write note/chord hybrids: bad `C4maj7`, `A3m7`, `G37`.
- Do not use colon chord quality in notes: bad `c3:min9`; use `Cm9` in `chord(...)`.
- Do not use unknown methods: `.stutter()`, `.subdivide()`, `.mod()`, `.krush()`, `.quantise()`, `.quantize()`.
- Do not use `.q(...)` for resonance; use `.lpq(...)`.
- Do not use `gmm_` soundfont prefixes; use exact `gm_` names.
- Do not use `$drums = ...`; declare reusable patterns with `const`.
- Do not put sample names inside `.struct(...)`; `.struct("x ~ x ~")` is for structure.

## Preflight Before Returning

Check these mentally before final output:

1. `setcpm(bpm/4)` is top-level.
2. Final line is a Pattern expression.
3. Chords use `chord(...)` or `.chord(...)`, not `note(...)`.
4. Any `.arp(...)` sees voiced or explicit stacked notes.
5. All `gm_*` names and `.bank(...)` names are exact.
6. Drum path is clearly audible as a drum kit in Cactus: kick/snare/hat are direct, forward, and percussive.
7. Drum layers are not hidden inside a nested `stack(...)` variable.
8. There is a stable groove or pulse, a harmonic center, and one motif or groove identity.
9. Randomness is bounded and phrase-aware, not the main composer.
10. Gains, density, room, delay, and low end are controlled.
11. Output is only one fenced code block.
