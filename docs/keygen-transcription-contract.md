# Keygen-music → Cookbook: Precise-Transcription Contract (for sign-off)

Path **C** (Bowei, 2026-05-17): hand-pick ~10–15 representative keygen
tracks, **precisely transcribe** them into the existing G9 cookbook,
use a **libopenmpt reference render as the acoustic ground-truth
oracle**, reuse the existing analyzer/critic closed loop. Then feed B.

Verdict on "同根同源": historically false (Strudel←TidalCycles 2010s;
trackers←Soundtracker 1987), but **representationally isomorphic** —
both are symbolic, pattern/loop-structured, effect-annotated music
*as data*. The isomorphism is strongest on exactly the axis we fail
(explicit harmony/melody/bass/arrangement) and breaks on the axis that
matters least for "难听" (sample timbre). So the precision budget goes
to pitch/rhythm/harmony/arrangement — **not** sample reproduction.

---

## 0. Foundational facts (verified, not assumed)

- Cookbook entry = `CookbookEntrySchema` v2.0.0 (packages/cookbook/
  src/schema.ts). Per-genre/role JSONL: `cookbook/<genre>/<role>.jsonl`.
  `source_type` already has `imported_public_domain`. `expected_
  movement` fields (onset_density, centroid_hz, rms_db, syncopation)
  are exactly analyzer outputs. `validation_status` ladder ends at
  `feature_match`. **The schema was built for this.**
- Transcription unit = a **per-role short loop** (1–4 bars; entries
  carry `bar_intent`, e.g. bass `"a1 ~ a1 ~"`), NOT a whole song. One
  keygen track → ~4–12 role-tagged cells.
- `getCookbookMode()` defaults to **`minimal`** — the rich G9
  retrieval is OFF by default; the 5 ear-test demos never used it.
  Transcribed entries only affect output under
  `CACTUS_COOKBOOK_MODE=enabled`.
- **Precedence conflict (highest-stakes):** the harmony-spine post-
  pass (step 4) makes `harmonic` outrank `mini_notation`. A
  transcribed melody is `mini_notation`; if its layer also gets a
  synthetic `roleDerivation`, **the spine silently overrides the real
  keygen melody** — destroying the entire value of the corpus.

## 1. Resolution of the precedence conflict (the crux)

A keygen module is **already harmonically coherent** — it is real
human music. Forcing it through our *synthetic* spine is not just
lossy, it is pointless.

- **Path C decision: literal transcription, spine-bypass.** A pattern
  entry sourced from a transcribed cookbook entry is emitted as its
  literal `mini_notation`; the step-4 spine post-pass MUST skip layers
  whose pattern came from a transcribed (`imported_public_domain`)
  entry. Add a provenance signal the post-pass honors. "精确转译"
  literally means *faithfully reproduce*, not *re-harmonize*.
- **Path B extension (later, not now):** also *extract* the module's
  real chord progression into `harmony.progression`, so the generator
  LEARNS the harmony rather than only replays it. Forward-compatible;
  out of scope for C.

## 2. Format subset (fidelity declared up front)

- **Symbolic extraction (Tier A):** start with **.xm** (FastTracker
  II — the dominant keygen format) and **.mod** (4-ch ProTracker).
  `.it`/`.s3m`/`.sid`/`.v2m` deferred (declared, not silently
  dropped). Favor low-channel modules for the curated set.
- **Acoustic oracle (all formats):** libopenmpt / `openmpt123`
  renders the reference WAV regardless of format — the oracle is not
  limited by the symbolic subset.
- A module outside the symbolic subset can still be an oracle-only
  A/B reference; it just yields no cookbook entries until its format
  is added.

## 3. Tick→cycle math (deterministic)

Tracker time = rows × speed (ticks/row) × tempo (BPM). Convention:
4 rows = 1 beat (16 rows = 1 bar in 4/4). Mapping:

- `bpm = module tempo (Txx)`; `cps = bpm / (60 * 4)` (existing
  `bpmToCps`). `bpm_range` on the entry = [bpm-4, bpm+4].
- A captured loop of `R` rows → a mini-notation grid of `R` steps
  with `~` for empty rows and `@n` for notes sustained over `n` rows
  (next-note / note-off delimits).
- Mid-pattern `Fxx`/`Txx` speed/tempo changes → **Tier B**
  (approximate; flagged in `known_failure_modes`).

## 4. Tracker → CookbookEntry mapping

| tracker | cookbook | tier |
|---|---|---|
| channel note/period stream | `mini_notation` (pitch+rest grid) | **A** |
| pattern loop length | `bar_intent` length, BPM grid | **A** |
| channel role (inferred: pitch-range + density + instrument reuse; confirmed at curation) | `role` (bass / lead_hook / chord_stab / pad_atmo / kick / hat / clap_snare / perc / fx) | A (curator-confirmed) |
| arpeggio `0xy` | `n(...).arp(...)` or expanded triad | A |
| portamento `1xx/2xx/3xx`, vibrato `4xy` | `.slide()` / `.vib()` (approx) | B |
| sample (PCM instrument) | nearest oscillator + ADSR; `sound_palette_tags` | **B (explicitly approximate)** |
| volume column / `Cxx` | gain in `bar_intent`, not pitch | A |
| effects with no clean analogue (9xx offset, retrig, tremor, E6x loop, funk) | dropped; listed in `known_failure_modes` | — declared |

Per entry: `source_type:'imported_public_domain'`,
`provenance_note` = module name + author + channel + format,
`validation_status` starts `candidate`.

## 5. Closed-loop validation (reuses existing infra, zero new scoring)

1. `openmpt123` renders the module → **whole-mix reference WAV**;
   per-channel solo render → **per-role reference WAV**.
2. Existing analyzer extracts features from the per-role reference →
   populate the entry's `expected_movement` (onset_density_*,
   centroid_hz_*, syncopation_*).
3. Our compiler renders the entry in isolation → analyzer features.
4. Distance(ours, reference):
   - **Tier A axes** (onset_density, syncopation, pitch-class
     histogram): within tolerance → promote `validation_status` →
     `feature_match` (retrieval boosts it +1).
   - **Tier B axes** (centroid/timbre): informational only — the
     oscillator renderer cannot match sampled timbre by design.
5. Fail Tier A → stays `candidate`, logged for manual review (do not
   auto-discard — the transcription, not the source, is suspect).

## 6. Integration

- Re-render the ear-test demos with `CACTUS_COOKBOOK_MODE=enabled` so
  the transcribed corpus is actually exercised (the prior 5 demos ran
  `minimal` — that is also why "有提升但还不好听": the rich cookbook
  was never on).
- New entries enter as `candidate` (retrievable, low score); the
  oracle loop promotes earned ones to `feature_match`.
- Spine-bypass provenance signal wired into the step-4 post-pass
  (§1).

## 7. Scope fence (what C does NOT do)

- No progression extraction into `harmony` (that is path B).
- No `.it/.s3m/.sid/.v2m` symbolic parsing yet (oracle-only).
- No sample/timbre reproduction (Tier B is explicitly approximate;
  consistent with the oscillator-only renderer and Bowei's own
  "音色单薄是独立问题").
- No mass scrape. ~10–15 **hand-picked** modules, `refs/keygen/`,
  gitignored, local only, research/transcription reference — never
  committed or redistributed (CLAUDE.md provenance hard rule;
  `source_type:'imported_public_domain'` + `provenance_note` on
  every derived entry).

## 8. Sign-off checklist (Bowei owns)

1. Approve **§1**: literal transcription + spine-bypass for
   transcribed layers (vs. re-harmonizing through the synthetic
   spine). This is the load-bearing call.
2. Approve **§2** format subset (.xm + .mod symbolic; libopenmpt
   oracle for all) as the C-phase scope.
3. Approve **§5** validation: Tier-A feature-match promotes; Tier-B
   timbre informational-only (renderer constraint).
4. Confirm **§6**: ear-test re-render runs `CACTUS_COOKBOOK_MODE=
   enabled`.
5. Confirm **§7** scope fence (no progression-extraction / no extra
   formats / no timbre repro in C).

On sign-off, implementation order: **toolchain proof (one freely-
licensed module end-to-end vs oracle) → transcriber + spine-bypass
wiring → curate Bowei's ~10–15 → enabled-mode ear-test re-render.**
No mass transcription before one module is proven against the oracle.

---

## 9. Sign-off record (2026-05-17)

Bowei, via AskUserQuestion at the post-contract checkpoint:

- **§1 — APPROVED: "照实转译 + 跳过骨架"** (literal transcription +
  spine-bypass for transcribed layers; *not* re-harmonizing through
  the synthetic spine). Progression-extraction into `harmony` remains
  path B, deferred.
- §2–§5 were stated as decided mechanism at the checkpoint and not
  overridden (route-correction model) — they stand: .xm+.mod symbolic
  subset + libopenmpt oracle for all formats; 4-rows-per-beat
  tick→cycle; analyzer closed-loop validation (Tier-A promotes,
  Tier-B timbre informational); `CACTUS_COOKBOOK_MODE=enabled` for
  the ear-test re-render.

§1 is wired (build-graph.ts `transcribedCells` spine-bypass; full
suite green, inert until enabled-mode + transcribed entries exist).
Dedicated bypass test deferred to task "prove one module end-to-end"
where it is exercised against a REAL transcribed entry + the oracle —
honest verification over a synthetic fixture for a not-yet-existing
corpus. Blocked on Bowei's curated modules in `refs/keygen/`.
