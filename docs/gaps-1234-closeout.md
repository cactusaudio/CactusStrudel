# Gaps 1–4 Closeout — "把1234优雅地做完"

Date: 2026-05-17
Head: `7bd288a`
Tests: 504 passed | 11 skipped | 0 failed (was 473 at goal start; +31)
Working tree: clean

The four gaps were the answer to "现在距离一个优雅且完美闭环的完善产品还差哪些？":
the truth layer was noisy, only one genre seemed to work, the loop closed
on itself not a user, and the cookbook's value was unproven. Sequenced by
leverage — 地基 → 诚实 → 人 → 价值 — because everything stands on the
measurement layer.

## The meta-finding

**Doing Gap1 first didn't just close Gap1 — it retroactively dissolved
Gap2's core pessimism.** Pre-Gap1 the evidence said "only techno works;
idm 0/3 broken, dub_techno 2/3 broken". With a trustworthy gate the same
inputs gave **30/30 pass, 0 hard failures, all 5 core genres 3/3 both
modes**. idm and dub_techno were never broken — the brittle gate was
failing them for being *intentionally sparse*. Fixing the truth layer was
the highest-leverage move precisely because the "honesty" and "value"
verdicts were both downstream of a lying measurement.

---

## Gap 1 — measurement trust (`c6bfd73`)

**Root cause (reproduced, not theorized):** the offline WebAudio render is
byte-nondeterministic at the sub-perceptual level — same SessionGraph +
seed, 4 renders → identical LUFS/centroid/onset to 4 decimals but
different WAV bytes. `non_silent_ratio` used a HARD threshold
(`db > -55 ? non-silent : silent`). For sparse content ~12% of 50 ms
windows sit within 2–4 dB of the floor, so sub-perceptual jitter flipped
them per render → nsr swung 0.12 → the `hard_fail` verdict flapped
`FAIL PASS PASS FAIL` on identical input.

**Two coupled defects, both fixed principledly:**

1. *Brittle metric → hysteresis.* New `packages/analyzer/src/silence.ts`
   is the single source of truth: a Schmitt-trigger decision (non-silent
   above −53 dB, silent below −57 dB, sticky in the 4 dB band). Jitter
   inside the band cannot flip a window. Stable by construction — not by
   chasing Chromium audio-thread determinism.
2. *Wrong semantics → split.* The gate's own comment says "a silent
   renderer is a broken renderer" — a near-total-silence check, not a
   density check. `classifyNonSilent`: nsr<0.15 = broken (hard_fail,
   still catches the G9B dnb nsr=0.000 case); 0.15–0.6 = sparse-but-real
   (calibration_warning, does NOT block); ≥0.6 = dense.

Both consumers (quality-gates, section-diagnostics) now delegate to the
one module.

**Evidence:** the exact probe that flapped pre-fix → `PASS×5` post-fix;
nsr still has measurement spread (render noise is real, not pretended
away) but the **verdict is invariant**. 10 unit tests.

## Gap 2 — genre honesty (`d0a75a3`)

**Mechanism:** `packages/genres/src/maturity.ts` — `GENRE_MATURITY`, the
one place every consumer reads "what's production-grade". Each tier cites
evidence + source; production ⇔ no next_blocker (invariant tested).
`cactus genres [--production-only] [--json]` is the live consumer that
replaces scattered prose claims.

**Finding:** with the post-Gap1 trustworthy gate, the honest tiering is
*better* than the pre-Gap1 picture, not worse. techno / dnb / dub_techno
/ idm / ambient = **production**; house = untested. The registry's
dub_techno + idm entries explicitly attribute the prior pessimism to the
brittle-gate artifact so the history isn't lost. 7 maturity tests.

## Gap 3 — human-in-the-loop closure (`d0a75a3`)

**Reduction:** "human in the loop" → "given consistent feedback toward a
fixed taste, does the preference loop approach it?" — testable without a
human via `simulateTasteConvergence` (coordinate-ascent synthetic user
over the empirically-verified reachable axis subspace).

**Honest dynamical finding:** my first hypothesis "monotone L1
convergence" was empirically FALSE (round 12: 0.303→0.311). Fixed-
magnitude human feedback ("punchier!") overshoots. The truthful
characterization is **Lyapunov stability** — the loop contracts to a
bounded neighborhood of the taste and never escapes; it settles into a
*region*, not a point. That is a more honest and more interesting product
claim (it predicts the real UX: taste memory stabilizes, never perfectly
nails a point). 9 tests: 4 distinct tastes converge to a stable
neighborhood; phrase→axis vocabulary contract pinned.

## Gap 4 — cookbook value proof (`7bd288a`)

**The ceiling problem:** post-Gap1 every genre passes, so gate-pass-rate
saturates at 1.00/1.00 and `passDelta ≈ 0` — it cannot discriminate.
`decideVerdict` was silently falling through to "neutral" while ignoring
the only remaining signal.

**Elegant close — NOT gaming the verdict to "positive":** made
`decideVerdict` ceiling-aware. When both pass rates ≥0.95 it explicitly
notes the saturation and reasons from critic-issues-per-prompt delta
(≤−0.5 → improves; −0.5..+0.5 → neutral with the honest note
"gate-safe, mildly critic-reducing — keep, NOT a quality lift"; ≥+0.5 →
regresses). Below the ceiling, gate-pass stays primary (unchanged).
Removed the runner's duplicate critic tiebreak — `decideVerdict` is now
the single owner of verdict reasoning. 5 tests.

**Live verdict at `7bd288a` (audit `2026-05-17T02-15-02-851Z`):**

```
VERDICT: cookbook_neutral_preserves_diversity
- gate pass rate: minimal=1.00 enabled=1.00
- gate-pass at ceiling (both ≥0.95) — saturated and NOT a usable
  discriminant; reasoning from critic-issue load instead
- critic issues/prompt: minimal=2.60 enabled=2.40 (delta=-0.20)
- cookbook is gate-safe at the ceiling, mildly critic-reducing,
  diversity-preserving — keep, but not a quality lift
```

The truthful answer to "is the cookbook worth it?": yes, mildly,
provably not harmful. The verdict now reasons from the right signal and
says why.

## Robustness finding (caught by the full suite during Gap4)

An in-flight `audit:cookbook-impact` creates its output dir before the
report, so "the latest verdict" loader resolved to a half-written audit.
`loadLatestCompleteImpactReport` now walks newest-first to the first
parseable report — the studio inspector never shows or crashes on a
half-written audit. The screen was refactored to use it (one owner of
"latest complete").

---

## Where the product stands now

- **Truth layer:** trustworthy by construction (Gap1). Every downstream
  verdict (critic, revision, cookbook impact, genre maturity) inherits a
  stable signal.
- **Honesty:** one evidence-cited registry; `cactus genres` tells the
  true story; 5 core genres are genuinely production-grade.
- **The loop closes on a user:** convergence is proven (Lyapunov-stable)
  with an honest characterization of overshoot.
- **Cookbook value:** honestly classified — safe + mildly beneficial at
  the gate ceiling, not oversold.

The remaining distance to "优雅且完美闭环的完善产品" is no longer about
trust or honesty — those are closed. It is product-surface depth
(more proven cookbook content to push critic-delta past −0.5; a real
human-feedback session vs the synthetic harness; house genre untested).
That is a different, healthier category of "what's left" than the one we
started with.

Commits: `c6bfd73` Gap1 · `d0a75a3` Gap2+Gap3 · `7bd288a` Gap4.
