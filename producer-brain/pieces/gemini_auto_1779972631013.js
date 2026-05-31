setcpm(90/4);

const prog = "<Am9 Dm7 Fmaj7 E7b9 G6 Fmaj7 Dm7 E7b9>";

const kick = s("<[bd ~ ~ bd] [bd ~ bd ~] [bd ~ ~ ~] [bd ~ ~ bd]>")
  .bank("RolandTR808")
  .gain("<0.86 0.78 0.82 0.74>")
  .lpf(950)
  .shape(0.18)
  .duckorbit(1)
  .duckattack(0.035)
  .duckdepth(0.42);

const snare = stack(
  s("~ sd ~ sd")
    .bank("LinnDrum")
    .gain(0.46)
    .hpf(170)
    .lpf(3300)
    .shape(0.22)
    .room(0.28)
    .roomsize(0.55)
    .delay(0.06)
    .delaytime(0.03)
    .delayfeedback(0.12),
  s("~ rim ~ rim")
    .bank("RolandTR707")
    .gain(0.16)
    .hpf(900)
    .lpf(5200)
    .room(0.25),
  s("<[~ ~ rim ~] [~ rim ~ ~] [~ ~ [rim ~] ~] [~ rim ~ rim]>")
    .bank("RolandTR707")
    .gain(0.09)
    .hpf(700)
    .lpf(4300)
    .room(0.18)
);

const hats = stack(
  s("hh*16")
    .bank("RolandTR909")
    .gain("<0.11 0.035 0.075 0.045 0.105 0.04 0.08 0.055 0.12 0.04 0.07 0.035 0.095 0.05 0.065 0.03>")
    .hpf(6200)
    .lpf(10500)
    .pan(rand.range(-0.16, 0.16).slow(2)),
  s("~ ~ ~ ~ ~ ~ ~ oh")
    .bank("RolandTR909")
    .gain(0.13)
    .hpf(5200)
    .lpf(9400)
    .room(0.2)
);

const crackle = stack(
  note("c6*16")
    .s("pink")
    .gain(rand.range(0.008, 0.026).slow(6))
    .hpf(3200)
    .lpf(8200)
    .crush(5),
  note("a2*8")
    .s("brown")
    .gain(rand.range(0.01, 0.032).slow(8))
    .hpf(900)
    .lpf(4200)
    .room(0.12)
);

const drums = stack(kick, snare, hats, crackle);

const bass = note("<[a1 ~ e2 g1] [d2 ~ a1 c2] [f1 ~ c2 e2] [e1 b1 f2 e2] [a1 c2 e2 g1] [d2 a1 c2 d2] [f1 c2 d2 e2] [e1 g1 f1 e1]>")
  .s("gm_acoustic_bass")
  .attack(0.025)
  .decay(0.22)
  .sustain(0.38)
  .release(0.18)
  .lpf(720)
  .lpq(0.35)
  .gain(0.52)
  .room(0.08)
  .orbit(1);

const rhodesHit = chord(prog)
  .voicing()
  .struct("x ~ ~ [~ x]")
  .s("gm_epiano1")
  .attack(0.035)
  .decay(0.75)
  .sustain(0.36)
  .release(0.85)
  .detune(0.09)
  .lpf(2200)
  .lpq(0.45)
  .room(0.38)
  .roomsize(0.68)
  .gain(0.36)
  .pan(perlin.range(-0.24, 0.24).slow(8))
  .orbit(1);

const rhodesArp = chord(prog)
  .voicing()
  .arp("0 [~ 1] 2 [~ 3]")
  .s("gm_epiano1")
  .attack(0.025)
  .decay(0.42)
  .sustain(0.22)
  .release(0.55)
  .detune(0.07)
  .lpf(1900)
  .room(0.42)
  .roomsize(0.7)
  .delay(0.16)
  .delaytime(0.1875)
  .delayfeedback(0.22)
  .gain(0.13)
  .pan(perlin.range(0.18, -0.18).slow(6))
  .orbit(1);

const rhodes = stack(rhodesHit, rhodesArp);

const lead = note("<[~ a4 ~ c5] [~ ~ e5 g5] [~ eb5 d5 ~] [c5 ~ a4 ~] [~ c5 e5 ~] [~ g5 ~ e5] [d5 ~ c5 ~] [~ a4 ~ ~]>")
  .s("sine")
  .fm(3)
  .attack(0.012)
  .decay(0.24)
  .sustain(0.08)
  .release(0.22)
  .lpf(1750)
  .vib(0.12)
  .room(0.45)
  .roomsize(0.62)
  .delay(0.28)
  .delaytime(0.1875)
  .delayfeedback(0.36)
  .gain(0.25)
  .pan(perlin.range(-0.32, 0.32).slow(4))
  .orbit(1);

const rhodesBreak = stack(
  rhodesHit.lpf(1250).gain(0.32).room(0.55),
  rhodesArp.lpf(1050).gain(0.1).room(0.6)
);

const bassBreak = bass.gain(0.32).lpf(560);

const drumsReturn = stack(
  kick.gain(0.92),
  snare,
  hats.gain(0.9),
  crackle
);

const rhodesOutro = stack(
  rhodesHit.lpf(saw.range(650, 2200).slow(4)).gain(0.31),
  rhodesArp.lpf(saw.range(500, 1800).slow(4)).gain(0.1)
);

const drumsOutro = stack(
  kick.gain("<0.7 0.55 0.42 0.28>"),
  snare.gain("<0.62 0.5 0.36 0.22>"),
  hats.gain("<0.7 0.55 0.38 0.22>"),
  crackle.gain(1.15)
);

arrange(
  [4, stack(drums, bass)],
  [4, stack(drums, bass, rhodes)],
  [8, stack(drums, bass, rhodes, lead)],
  [2, stack(bassBreak, rhodesBreak, crackle)],
  [10, stack(drumsReturn, bass, rhodes, lead)],
  [4, stack(drumsOutro, bass.gain(0.38), rhodesOutro, lead.gain(0.16))]
)
