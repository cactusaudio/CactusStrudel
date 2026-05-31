# AGY Strudel Generation Brief

Use this for CactusStrudel generation. Keep it compact: the goal is runnable,
musical Strudel with a clearly audible groove, not a defensive error report.

## Output Contract

- Return exactly one fenced `javascript` code block.
- Include top-level `setcpm(bpm/4)` or the requested cycle mapping.
- Final expression must evaluate to a Pattern, usually `stack(...)` or `arrange(...)`.
- Use `const name = ...` for reusable patterns. Never use `$name = ...`.
- Prefer a 24-cycle-friendly result unless the user requests another length.

## Safe Strudel Core

- Pitch: `note("c2 e2 g2")`, `n("0 2 4").scale("c:minor")`.
- Harmony: `chord("<Cmaj7 Am7 Fmaj7 G7>").voicing()`.
- Explicit stacks: `note("<[c3,e3,g3] [a2,c3,e3]>")`.
- Arp only after voiced/stacked notes: `chord("<Cm9 Fm9>").voicing().arp("0 2 1 3")`.
- Structure: `stack(...)`, `arrange([4, intro], [8, groove], [4, break], [8, drop])`.
- Mini-notation: `<a b>` cycles, `[a b]` subdivision, `~` rest, `*N` repeat/subdivide, `!N` repeat.
- Safe local sounds: `sine`, `saw`, `sawtooth`, `square`, `triangle`, `supersaw`, `piano`, `white`, `pink`, `brown`.
- Useful installed GM sounds: `gm_epiano1`, `gm_pad_warm`, `gm_acoustic_bass`, `gm_synth_bass_1`, `gm_flute`, `gm_synth_drum`.
- Exact bank names if samples are used: `RolandTR808`, `RolandTR909`, `RolandTR707`, `LinnDrum`, `AlesisHR16`.

## Hard No

- No invented methods: `.stutter()`, `.subdivide()`, `.mod()`, `.krush()`, `.stut()`, `.quantise()`, `.quantize()`.
- Use `.lpq(...)`, not `.q(...)`.
- Use exact `gm_` names, never `gmm_`.
- Do not use `"superfm"` or `"pulse"`.
- Do not chain `.setcpm(...)` on a pattern.
- Do not put chord symbols in `note(...)`: use `chord(...)`.
- Do not write note/chord hybrids like `C4maj7`, `A3m7`, `G37`.
- `.struct(...)` may contain structure only: `x`, `~`, grouping, repeats; not sample names.

## Audible Drum Requirement

This is the main generation correction. Previous Advanced runs had code-level
`kick`, `snare`, and `hats`, but Bowei could not hear drums. Do not repeat that.

For every non-drumless preset:

- The main groove/drop must clearly sound like a drum kit.
- Kick, snare/clap, and hats must be directly audible before pads/leads.
- Put `kick`, `snare`, and `hats` directly inside each main/drop `stack(...)`.
- Do not hide drums inside `const drums = stack(...)`.
- Do not satisfy drums with only soft sine/triangle bleeps.
- Prefer noise snare/hats or sample+fallback so transients read as drums.
- Keep drum room/delay controlled; lower pads/leads if they mask drums.

Reliable fallback kit:

```javascript
const kick = note("c2 ~ c2 ~ c2 ~ c2 ~")
  .s("sine").decay(0.12).sustain(0).release(0.03).gain(1.1).lpf(130)

const snare = note("~ ~ d3 ~ ~ ~ d3 ~")
  .s("white").decay(0.06).sustain(0).release(0.04).gain(0.45).hpf(1200).lpf(6500)

const hats = note("g5 g5 g5 [g5 g5] g5 g5 g5 [g5 g5]")
  .s("white").decay(0.015).sustain(0).release(0.01).gain(0.12).hpf(5000)
```

## Musical Priorities

- Stable groove and low end first.
- One clear harmonic center or progression.
- One memorable motif or groove identity.
- Repetition first; phrase-level variation second.
- Randomness should animate hats/percussion/fx, not replace bass, hook, or harmony.
- 4-6 roles usually work best: drums, bass, chords/keys, motif/lead, optional texture.
- Do not make every layer equally busy.
- Keep gain, room, delay, and low-frequency masking controlled.

## Preflight

Before returning, check:

1. Top-level tempo exists.
2. Final expression is a Pattern.
3. Chords use `chord(...)` or `.chord(...)`, not `note(...)`.
4. Any `.arp(...)` sees voiced/stacked notes.
5. Sound and bank names are exact.
6. Non-drumless pieces have an audible drum kit in main/drop.
7. Kick/snare/hats are direct in the main/drop stack.
8. The piece has a clear groove, harmonic center, and motif/groove identity.
