# SessionGraph `harmony` — Complete Schema Design (for sign-off)

Date: 2026-05-17
Status: **DESIGN — awaiting Bowei sign-off before any compiler change**
Depends on: `docs/strudel-corpus-study.md` (the evidence base)

Per direction "先设计完整 harmony schema". This is the full schema +
compilation contract + the blocking prerequisite. No compiler code is
written until this is approved.

---

## Prerequisite-0 (BLOCKING — found by verification, not assumption)

The harmonic spine compiles to `scale`, `add`, `sub`, `struct`,
`layer`, `superimpose`, `run`, and depends on `setDefaultVoicings`.
Forensic check of `packages/strudel-validator/src/registry.ts`
(generated 2026-05-10 via `pnpm extract-registry`):

| function | in installed @strudel? | in validator registry? |
|---|---|---|
| `chord`, `voicing`, `voicings`, `anchor`, `mode`, `transpose`, `n`, `note`, `pickRestart` | yes | **yes** ✅ |
| `scale` | **yes** (`@strudel/tonal@1.2.6` exports `register('scale')`, `export const scale`) | **NO** ❌ |
| `add`, `sub`, `struct`, `layer`, `superimpose`, `run`, `setDefaultVoicings` | yes (core/tonal) | **NO** ❌ |

**The language supports the spine; the validator would falsely reject
it.** `n("0 2 4").scale("c#:minor")` — the single most common harmonic
primitive (48% of corpus) — fails validation today purely because the
registry extractor didn't cover `@strudel/tonal` + some core combinators.

→ **P0 task: extend `pnpm extract-registry` to cover `@strudel/tonal`
and the missing core combinators, regenerate registry, add a test that
`scale`/`add`/`sub`/`struct`/`layer`/`superimpose`/`run` are present.**
Without P0 the entire redesign is dead on arrival regardless of schema
quality. P0 is ~30 lines + a test; it ships first, standalone.

---

## 1. Where it lives + ownership

New top-level block `SessionGraph.harmony` (optional → back-compat).
It is song-structural (spans sections, modulates over song time,
parallels `/song`) → **owned by `producer-arranger`** (write boundary
`/harmony/*` added to the table). `producer-composer`'s pattern
entries *reference* it but never write it. Determinism preserved:
`harmony → chord/voicing` is a pure function given a fixed voicing
dictionary (see §5).

`BriefGraph.key` already exists but nothing consumes it. The brief
interpreter now resolves it into `harmony.key`; if the brief gives no
key, the arranger picks a genre-default (techno→A minor, etc.) and
records the choice.

## 2. The schema (zod, additive — schema_version 1.0.0 → 1.1.0)

```ts
export const ChordSymbolSchema = z.string().regex(
  /^[A-G][b#]?(m|maj7|m7|7|dim|aug|sus2|sus4|add9|6|9|11|13)?$/,
);
// e.g. "Dm" "A" "Bb" "Ebmaj7" "F#m7" — the plain chord names the
// corpus passes to chord("Dm A Bb Eb"). Voicing is NOT in the symbol;
// it's derived per layer (§4).

export const HarmonyModulationSchema = z.object({
  at_bar: z.number().int().nonnegative(),
  key: z.object({
    tonic: z.string().regex(/^[A-Ga-g][b#]?$/),
    mode: ModeEnum,
  }),
});

export const HarmonyGraphSchema = z.object({
  key: z.object({
    tonic: z.string().regex(/^[A-Ga-g][b#]?$/),
    mode: ModeEnum,                       // reuse existing ModeEnum
  }),
  // The shared spine. One progression for the song; sections index
  // into it. Plain chord symbols — voicing is per-layer.
  progression: z.array(ChordSymbolSchema).min(1),
  // How the progression maps to time. Mini-notation duration string
  // over the progression index space, e.g. "<0 1 2 3>/2" means one
  // chord per 2 cycles; "0@2 1 2@2 3" weighted. The compiler expands
  // this against progression[] — NOT free-text.
  progression_rhythm: z.string().min(1).default('<*>/1'),
  // Optional: the 2% modulating songs + modulating-scale form.
  modulation: z.array(HarmonyModulationSchema).default([]),
  // Per-role octave anchor (corpus: .anchor('c3') bass, 'c4' chord…).
  anchors: z.object({
    bass: z.string().regex(/^[A-G][b#]?[0-9]$/).default('c2'),
    chord: z.string().regex(/^[A-G][b#]?[0-9]$/).default('c4'),
    lead: z.string().regex(/^[A-G][b#]?[0-9]$/).default('c5'),
    pad: z.string().regex(/^[A-G][b#]?[0-9]$/).default('c4'),
  }).default({}),
}).strict();
export type HarmonyGraph = z.infer<typeof HarmonyGraphSchema>;
```

`PatternEntry` gains ONE new optional variant — the harmonic
derivation. Existing literal forms (`mini_notation`/`notes`/`raw`)
stay for drums + back-compat:

```ts
export const HarmonicDerivationSchema = z.object({
  source: z.literal('progression'),
  // How this layer realizes the shared spine:
  role_derivation: z.enum([
    'chord_voiced',   // chord(prog).voicing()                — pad/chord
    'root',           // chord(prog).mode('root').anchor(oct)  — bass
    'arp',            // n(arpPattern).chord(prog).voicing()   — arp/pluck
    'degree_line',    // n(degrees).chord(prog).voicing()      — lead/melody
  ]),
  // For arp/degree_line: scale-degree pattern in mini-notation
  // (the corpus's "<0 2 4 [1 3] …>" form). Ignored for chord_voiced/root.
  degrees: z.string().optional(),
  // Optional rhythm applied via struct() — separates WHEN from WHAT
  // (corpus uses .struct("x ~ x x") on harmonic lines, 34% of songs).
  rhythm: z.string().optional(),
  // Octave offset on top of the role anchor.
  octave_shift: z.number().int().min(-3).max(3).default(0),
});
// PatternEntrySchema gets:  harmonic: HarmonicDerivationSchema.optional()
// Refinement: exactly one of {mini_notation, notes, raw, harmonic, euclid}.
```

`SoundDecoration.source` gains GM support (corpus: 75% use `gm_*`):

```ts
// source.kind enum adds 'gm'; when kind==='gm', name is a GM program
// like 'gm_electric_bass_finger'. Pitched roles (bass/chord/lead/pad/
// arp) MUST carry an envelope: SoundDecorationSchema refinement
// requires .adsr/.attack/.release present when the layer is pitched.
```

## 3. Worked example (what the producer would emit)

Brief "peak time techno 132 BPM A minor". `harmony`:

```json
{ "key": {"tonic":"A","mode":"minor"},
  "progression": ["Am","F","C","G"],
  "progression_rhythm": "<0 1 2 3>/4",
  "anchors": {"bass":"a1","chord":"a3","lead":"a4","pad":"a3"} }
```

Layers reference it via `harmonic` PatternEntry; everything derives
from the ONE spine — the harmonic coherence the corpus has and we lack.

## 4. Compilation contract (harmony → Strudel, corpus-cited)

The compiler maps `(harmony, layer.role_derivation)` deterministically:

| role_derivation | emitted Strudel | corpus source |
|---|---|---|
| `chord_voiced` | `chord("<Am F C G>/4").voicing().anchor("a3").s(gm).adsr([…])` | edenontheair, savour `reed` |
| `root` | `chord("<Am F C G>/4").mode("root").anchor("a1").s(gm).lpf(300)` | savour `bass` |
| `arp` | `n("<0 2 4 2>".struct("x ~ x x")).chord("<Am F C G>/4").voicing().s(gm)` | warsaw `arpj`, sparky |
| `degree_line` | `n("<0 1 [2 3] 4>").chord(prog).voicing().add(octShift*7).s(gm)` | satiesfaction, swimmingsnake |
| drums (unchanged literal) | `s("<bd [sd bd] [~ bd] sd>").bank(kit)` | disto, warsaw `drums` |

Section form: the existing `arrange()` flat-gain-per-section is
replaced by the corpus's proven pattern — a song-time
`<phraseTok@bars …>.pickRestart({named phrases})` + a
`.gain("…@…".slow(songLen))` envelope. (Specified fully in the
compiler-change doc once this schema is approved; flagged here so the
schema's `progression_rhythm` + section indexing is designed to feed
it.)

## 5. Determinism & voicing dictionary (sub-item of P0)

`voicing()` output depends on the active voicing dictionary. The
corpus pins it with `setDefaultVoicings('legacy')` at file top.
`setDefaultVoicings` is **not** in the registry and the compiler must
emit it once per program for byte-stable output. P0 adds it to the
registry; the compiler-change will emit it as a deterministic preamble
(like `setcps`). Without pinning, voicing is non-deterministic →
violates the SessionGraph determinism rule.

## 6. Migration / versioning / write boundary

- **schema_version 1.0.0 → 1.1.0.** Additive only: `harmony` optional,
  `PatternEntry.harmonic` optional, `source.kind` enum widened. Per
  `migration-policy.md` an additive-optional change is a minor bump
  with **no destructive migration** — existing `iter_*.json` without
  `harmony` still validate and compile (drums-only / legacy path).
- Agent write boundary table gains: `producer-arranger → /harmony/*`.
  Add an `agent-write-boundaries` counter-example test.
- `producer-composer` may write `pattern_bank/*/*/harmonic` (it's
  inside `/pattern_bank/*`, already its boundary) but MUST NOT write
  `/harmony/*`.

## 7. Explicit scope fence (what this schema does NOT do)

- No LFO/automation-signal modeling (8% corpus long tail) — out.
- No per-note micro-timing/swing field — out (mini-notation `@`/`[]`
  already covers it; revisit only if the critic asks).
- No multi-progression / per-section different progressions in v1.1 —
  one spine + optional modulation only. (Corpus `savour` has
  per-section progressions via `pickRestart` of chord lists; that is
  v1.2 if evidence demands — schema's `modulation` + section indexing
  is forward-compatible with it, not a v2 break.)
- Does not touch the critic. But note the payoff: once `harmony`
  exists, the critic can finally score **harmonic coherence** (do all
  pitched layers derive from the spine?) — that is the real rubric fix
  for the "self-eval graded wrong homework" problem. Separate doc.

## 8. Sign-off checklist (Bowei owns)

1. Approve `harmony` as a top-level block owned by producer-arranger.
2. Approve the 4 `role_derivation` modes as the complete v1.1 set
   (chord_voiced / root / arp / degree_line) — or amend.
3. Approve P0 (registry fix) shipping first as a standalone commit.
4. Approve schema_version 1.0.0→1.1.0 additive-minor (no destructive
   migration).
5. Confirm scope fence §7 (one spine + optional modulation; no
   per-section progressions in v1.1).

On sign-off, implementation order is: **P0 (registry+test) →
schema+zod+migration test → compiler change → re-render demos for the
ear test.** No compiler line before P0 + schema are green.

---

## 9. Post-implementation correction — §5 FALSIFIED by render evidence (2026-05-17)

§5 (and sign-off via "全部批准") proposed emitting a
`setDefaultVoicings('legacy')` preamble to pin the voicing dictionary
for determinism. **Implementation + render evidence falsified this.**
The original §5 text is left intact above for provenance; this section
records the correction (verifiers/evidence own truth).

Finding (probe renders, @strudel/tonal@1.2.6):
- `chord("<Am F C G>").voicing()...` unpinned → **−1.5 dB, audible.**
- Same + `setDefaultVoicings("legacy")` → **0 haps, silent.**
- Same + `setDefaultVoicings("ireal")` → **0 haps, silent.**

Mechanism: `voicing()` reads `voicingRegistry[defaultDict]`. Any
user-code `setDefaultVoicings(x)` sets `defaultDict=x`; the registry
has keys `lefthand/triads/guidetones/legacy` only (no `ireal`) and
`legacy`'s dictionary lacks bare triads — so `renderVoicing` throws
and `voicing()` returns `silence`. The library's INTERNAL default
(set once at module load) works and is constant per build, so
determinism — §5's actual goal — holds **without** any pin.

Resolution: the compiler emits **no** `setDefaultVoicings` preamble.
This was the ambient-demo total-silence regression (pure voiced pads,
no drums to mask it). Sign-off item §5 is **withdrawn**; the other
four sign-off items stand. Determinism rule still satisfied (library
internal default is build-constant).
