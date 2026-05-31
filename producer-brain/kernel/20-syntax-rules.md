# Render-breaking syntax

These produce silent tracks or runtime errors. Avoid for purely technical
reasons — none of these are stylistic suggestions.

## Chord quality suffixes via colon are invalid
NO:  `chord("c3:min9")`, `chord("bb2:dom9")`, `note("C4maj7")`
YES: `chord("Cm9")`, `chord("Bb9")`, `chord("Cmaj7").voicing()`

## Chord symbols belong in `chord()`, not `note()`
NO:  `note("Cmaj7 Am7")`, `note("C4maj7 A3m7")`
YES: `chord("Cmaj7 Am7").voicing()`  —  or  explicit stack `note("<[c4,e4,g4,b4] [a3,c4,e4,g4]>")`

## `.arp()` numeric indices must fit the voiced stack
`chord("Cm").voicing()` produces a 3- or 4-note stack. `.arp("0 1 2 7")` will
silently fail at index 7. Keep indices < stack length.

## `.struct()` contains structure only
YES: `.struct("x ~ x ~")`, `.struct("[x x] ~ x ~")`
NO:  `.struct("bd ~ sd ~")` — sample names go in `s(...)`, not `.struct()`.

## `setcpm()` is top-level
NO:  `stack(...).setcpm(120/4)`
YES: `setcpm(120/4); stack(...);`

## Voicing / arp ordering
- `chord("...").voicing().arp("...")` — arp sees the voiced stack (works)
- `chord("...").arp("...")` — arp without voicing has nothing to index into (silent)

## Reusable pattern names must not start with `$`
- `const drums = stack(...);`   — works
- `$drums = stack(...);`        — `ReferenceError: $drums is not defined`
