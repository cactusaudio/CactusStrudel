# API surface

Anything not in this list either does not exist, or breaks the render with no
audible result. Stay inside this surface; freely compose anything within it.

## Pitch
- `note("<note pattern>")` — written pitches (e.g. `note("c3 e3 g3")`)
- `n("<scale degrees>").scale("<root>:<mode>")` — scale-relative degrees
- `.add(N)` / `.sub(N)` — transpose
- `.arp("0 1 2 3")` — numeric indices only; string modes (`"up"`, `"updown"`) are silent
- `.off(0.25, x => x.add(7))` — offset + transform

## Chords
- `chord("<chord progression>")` — symbol stream, e.g. `chord("<Cmaj7 Am7 Fmaj7 G7>")`
- `.voicing()` — automatic voicing of the chord stream
- explicit stacks via `note("<[c4,eb4,g4] [ab3,c4,eb4]>")` (commas = parallel events)

## Structure / control
- `stack(...)` — parallel layers
- `<a b c>` — slowcat (one per cycle); `[a b]` — subdivide; `~` — rest; `*N` `!N` `@w`
- `.slow(n)` / `.fast(n)`, `.every(n,f)`, `.superimpose(f)`, `.layer(f)`
- `.jux(rev)`, `.segment(n)`, `.palindrome()`, `.range(a,b)`
- `arrange([length, p1], [length, p2], ...)` — sectioned timeline (each `length` is in cycles)
- `.mask("<1 0>")`, `.struct("x ~ x x")` — structure-only patterns (no sample names inside `.struct`)

## Reusable patterns
- `const name = ...;` then reference `name`
- `$`-prefixed names throw ReferenceError — never write `$drums = stack(...)`

## Signals (modulators)
- `sine` `saw` `tri` `perlin` `rand`
- `signal.range(a,b).slow(n)` → pipe into `.lpf()`, `.gain()`, `.pan()`, etc.

## Sound source — `.s("<valid name>")`
- local synths: `sine` `saw` `sawtooth` `square` `triangle` `supersaw` `piano` `white` `pink` `brown`
- GM soundfonts (prefix is `gm_`, never `gmm_`): `gm_epiano1` `gm_pad_warm` `gm_acoustic_bass` `gm_synth_bass_1` `gm_flute` `gm_synth_drum` (any installed `gm_*` works)
- FM: any oscillator carrier + `.fm(N)` — e.g. `.s("sine").fm(4)`, `.s("square").fm(4)`

## Drums — sample triggers
- `s("<tag> ...").bank("<bank name>")` — banks are case-sensitive
- valid banks: `RolandTR808` `RolandTR909` `RolandTR707` `LinnDrum` `AlesisHR16`
- valid tags: `bd` `sd` `hh` `oh` `cp` `rim` `lt` `mt` `ht`
- common case mistakes that render to nothing: `tr808`, `linn`, `rolandtr808`, `halo_pad`, `mimic`

## Shaping (chainable, any combination)
`.gain` `.lpf` `.lpq` `.hpf` `.room` `.roomsize` `.delay` `.delaytime` `.delayfeedback`
`.attack` `.decay` `.sustain` `.release` `.pan` `.crush` `.shape` `.vib` `.clip` `.detune` `.speed` `.coarse`

## Sidechain
- kick side: `.duckorbit(N)`, `.duckattack(t)`, `.duckdepth(d)`
- bed side: `.orbit(N)`
- `duckdepth` is a continuous fraction; no enforced range, choose freely.

## Tempo
- `setcpm(<bpm>/4)` at the top level only.

## Methods that do NOT exist (silent or throw)
`.stutter()`  `.subdivide()`  `.mod()`  `.krush()`  `.stut()`  `.quantise()`  `.quantize()`  `.q()` (use `.lpq()`)

## Sound names that do NOT exist
`"superfm"`  `"pulse"`  (use a valid oscillator name; for FM use `.s("<carrier>").fm(N)`)
