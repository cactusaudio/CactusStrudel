---
description: Reference for Strudel mini-notation, common pattern functions, sample bank names, and known failure modes. Load when generating, validating, or compiling Strudel code.
---

# Strudel reference

Concise reference; full per-function docs in `reference.md`.

## Mini-notation

- `~` rest
- `*N` repeat
- `/N` slow
- `|` choice
- `<a b c>` alternation
- `[a b c]` group as one cycle
- `{a, b, c}` polyrhythm
- `bd(3, 8)` Euclid
- `a@2 b` weighted

## Common functions (whitelist subset)

`s`, `n`, `note`, `freq`, `gain`, `pan`, `room`, `delay`, `lpf`, `hpf`, `bpf`, `cutoff`, `resonance`, `crush`, `distort`, `coarse`, `shape`, `vowel`, `attack`, `decay`, `sustain`, `release`, `speed`, `cps`, `setcps`, `bpm`, `setBpm`, `stack`, `cat`, `seq`, `slow`, `fast`, `rev`, `every`, `mask`, `struct`, `degradeBy`, `sometimes`, `chunk`, `swing`, `swingBy`, `iter`, `palindrome`.

The runtime whitelist lives in `packages/strudel-validator/src/registry.ts` and is generated from the installed packages.

## Known failure modes

- Hallucinated `.reverb()` — it's `.room(value)` for verb, `.delay(value)` for delay.
- Duplicated single-use effects: `.lpf(800).distort(0.4).lpf(800)` is a mental-model error 99% of the time. Validator flags it.
- Mini-notation must be inside a string passed to `s(...)`, `n(...)`, or `note(...)`. Bare expressions don't work.
- `setcps(0.5)` ≠ `setBpm(120)`. cps is cycles per second; bpm assumes 4 beats per cycle (typical) so `bpm = cps * 60 * 4 / cycles_per_beat`.

## Cycles, bars, BPM

- `cps = bpm / (60 * beats_per_cycle)`. Default beats_per_cycle = 4.
- 132 bpm 4/4 → cps ≈ 0.55. Set via `setcps(0.55)` at the top of the pattern.

## Files

- `reference.md` — full function index per Strudel docs.
- `mini-notation.md` — extended mini-notation rules with examples.
- `failure-modes.md` — observed validator-catchable mistakes.
