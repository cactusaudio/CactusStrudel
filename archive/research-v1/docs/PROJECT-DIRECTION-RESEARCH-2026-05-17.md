# CactusStrudel — Direction Research (2026-05-17)

Bowei's verdict after the keygen ear test: **all 5 still 难听**, with
specific diagnoses. He asked for deep research on how the project
should continue. This is forensic, not reassuring.

## 1. The pattern that matters

Three iterations, each fixing **pitch content**, each still 难听:

| iter | fix | Bowei verdict |
|---|---|---|
| 1 | harmony spine (shared progression) | "有提升，但还是不好听" |
| 2 | keygen melody/harmony into cookbook | "都很难听" |
| (before) | baseline | "5首都难听爆了" |

Pitch content has been "fixed" three ways. The needle barely moved.
**The problem was never primarily pitch.** Continuing on this axis
(more keygen, §5 oracle, .mod parser) is predicted-low-ROI by this
track record.

## 2. Forensic root-cause (his 5 diagnoses → measured mechanism)

Evidence = the actual rendered graphs + analyzer features.

| demo | his ear | measured mechanism |
|---|---|---|
| 01 techno | "难听的arp实验; 很多地方没动次打次的鼓" | kick onset_density **0.8** (4-on-floor needs ~2.2); band_rms mid 1.0 high_mid 0.1 → **hats inaudible**; only low-end + keygen stab present → reads as aimless arp. Groove + mix failure. |
| 02 dub_techno | "有点和弦，但鼓声太小" | analyzer detects **62 BPM (brief 124)** → no perceptible beat; kick onset ~1.1. Chord (keygen) *does* come through. **Drums under-articulated/under-gained.** |
| 03 ambient | "从头到尾random模拟人声合成器" | only pad1/pad2, **on in ALL 3 sections — zero arrangement variation**; onset_density **4.5** (ambient should be ≈0) → the "pad" **re-triggers every step instead of sustaining**. Transcription model wrong for sustained roles. |
| 04 dnb | "全是贝斯" | band_rms sub 10 / low 12.8 / everything-else ≤2.9; analyzer detects **87 BPM (brief 174)**. Spectrum is literally all low. **Mix has no frequency balance; breakbeat buried.** |
| 05 idm | "开头还行的arp，后面同一个音超快重复" | best-balanced spectrum (sync 0.119) but the keygen lead **degenerates to a machine-gun single note** in the bridge — a per-row note-grid transcription artifact. |

**Cross-cutting invariant** (every demo, measured): the analyzer
locks to the **wrong/half tempo** in 4 of 5 (62↔124, 87↔174, 85↔65,
104↔110). There is **no perceptible beat**. That is not a pitch
problem. That is *no groove*.

## 3. Thesis (evidence-grounded)

The "难听" is dominated by **groove, arrangement, and mix** — the
three things this architecture does NOT model:

1. **No groove.** "动次打次" is a *produced feel* (a kick that knocks,
   transient design, sidechain, swing, velocity, sub-vs-click
   balance) — not a note pattern. The compiler emits notes; nothing
   produces feel. Measured: beat is imperceptible everywhere.
2. **Arrangement is crude on/off layer-toggling per section.** No
   tension/release, fills, automation, evolution. Real tracks (and
   keygen) *live* in the arrangement; ours has none within a section
   and almost none across.
3. **The mix controller demonstrably fails.** "鼓太小" / "全是贝斯"
   are literal: spectra are low-dominated, hats ≈0. The analyzer
   *measures* band_rms — that loop is open.
4. **Decompose→refill destroys musicality.** Keygen sounds good as a
   WHOLE (its arrangement, channel interplay, build). We rip one bar
   of one channel out of context and bolt it onto a weak skeleton.
   What made it good does not survive extraction. This is structural,
   not a tuning issue.

The SessionGraph → snippet-fill → deterministic-compile pipeline
produces **structurally-valid, musically-dead** output. Every gate is
green; the music is not music. This is the harness-vs-truth split the
whole project was supposed to respect, turned on the project itself.

## 4. Strategic options

**A — Re-architect around groove+arrangement+mix as first-class.**
Stop adding pitch content. Build: a groove engine (knocking kick,
swing, velocity, sidechain as primitives), arrangement as a real
generative model (tension curve, fills, automation — not on/off), and
close the mix loop against the analyzer's band_rms (already measured).
Keeps the deterministic-verifiable spine (the actual moat). *Risk:*
large; but it targets the evidenced bottleneck.

**B — Pivot to faithful whole-song transcription (transpiler).**
The keygen proof showed we can parse a whole module **exactly**.
Instead of decompose→refill→arrange (which destroys musicality),
transpile WHOLE tracks faithfully — all channels, real arrangement,
the actual song — and render. Not "AI composes" but "faithfully
convert this corpus." It *would* sound good (real music, modulo
oscillator timbre). *Risk:* a transpiler is a much smaller ambition
than an autonomous producer.

**C — Reframe the asset.** Maybe "autonomous producer that sounds
good" is not reachable here, and the defensible core is the
deterministic IR + compiler + analyzer + gate infra **as a
verification/eval harness** for music generation (not the generator),
or as tooling — aligned with the standing "我们团队不擅长做产品",
governance/eval-as-moat, M&A-exit thesis.

## 5. Recommendation — one cheap decisive experiment first

We have **zero evidence the substrate can carry 好听 anything**.
Before betting big on A or C, run the highest-information experiment
(maximize effective exploration rate under irreversible-risk):

> **Faithfully transpile ONE whole keygen track** (all channels, full
> order, real arrangement — option B mechanics, already 80% proven)
> and render it. One bit of truth: *does it sound good?*

- If **yes** → the renderer/compiler/substrate CAN carry good music;
  "难听" is isolated to the **generator** (groove/arrangement/mix) →
  Option A is justified and scoped.
- If **no** (even faithful real music sounds bad through our
  renderer) → the substrate itself is the ceiling → Option C
  (reframe) is the honest path; do not pour months into A.

This single experiment is ~1 day, reuses proven code (the XM parser +
the keygen-proof harness), and **gates the expensive decision with
evidence instead of hope**. It also directly answers Bowei's question
("how should this project continue") with a fact, not a plan.

**Stop doing:** adding pitch content (keygen curation, §5 oracle,
.mod) — that axis is falsified for three iterations.

## 6. Decision for Bowei

The fork is §4 A/B/C, but §5 says the next *action* is the decisive
experiment regardless — it cheaply tells us which of A/C is even
worth discussing, and whether B is the product. The only thing not
worth doing is more component-tuning on the current architecture.
