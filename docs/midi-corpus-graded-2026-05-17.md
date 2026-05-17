# MIDI Exemplar Corpus — Acquired + Cleaned + Ear-Graded (2026-05-17)

Scope: canonical SEQUENCED electronic (Strudel's wheelhouse). Source:
bitmidi free MIDI (fuzzy/noisy — that noise IS the quality problem).
Two-stage clean: (1) objective gate, (2) **I read each survivor's
transcription as a musician** (feedback_listen_dont_hide_behind_metrics).
Source .mid in refs/midi/ — gitignored, local research/structural
exemplar only, NOT redistributed; copyrighted compositions.

Pipeline (reusable): apps/cli/src/midi-acquire-clean.ts (acquire +
objective gate), midi-grade.ts (transcribe + musical fingerprint),
midi-transcribe.ts (the transcriber), midi-render.ts (render).

bitmidi coverage: 24 canonical targets attempted → 9 passed objective;
+3 Daft Punk hand-acquired earlier. Misses = bitmidi's fuzzy search
had no clean name-match (Blue Monday, I Feel Love, Air, Justice, Gary
Numan, Pet Shop Boys, Kraftwerk TEE) — "not available via this
source", not failures.

## Graded (my ear — keep/cut + why)

KEEP-STRONG (recognizable; real groove + bass + melody + arrangement):
- Kraftwerk – The Robots — complete interlocking electro kit
  (kick/snare/oh/16th-hh); the groove the synthetic gen never made.
- a-ha – Take On Me — moving bassline + iconic synth-riff lead.
- Eurythmics – Sweet Dreams — canonical sequenced ostinato.
- Daft Punk – One More Time — house groove + rhythmic bass + stab.
- Daft Punk – Da Funk — proven (full render listened); one-note
  grooving bass + riff + breakdown arrangement.
- Depeche Mode – Enjoy the Silence — driving bass + chord-melody hook.
- Jan Hammer – Crockett's Theme — Miami-Vice synth lead + comping.

KEEP-CANONICAL (good; minor flag):
- Kraftwerk – Computer Love — real arpeggiated melody.
- Kraftwerk – The Model — iconic sequence; one over-dense layer
  (n=2112) to watch for buzz.

KEEP-NICHE:
- Vangelis – Blade Runner — sparse sustained pads; AMBIENT-only
  exemplar (low note-count correct here, not a defect).

CUT (objective gate caught the junk free-MIDI is full of):
- Daft Punk – Around The World (24s fragment)
- Jean-Michel Jarre – Oxygène (28s remix fragment)
- Soft Cell – Tainted Love (corrupt: HTML/RIFF saved as .mid)
- 12 targets: no clean name-match via bitmidi.

Net: ~10 ear-verified canonical exemplars across electro / French
house / synthpop / synth-lead / ambient — a real exemplar base.
