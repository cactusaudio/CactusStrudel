setcpm(122/4);

const prog = chord("<Am9 Dm9 Fmaj7 E7>").voicing();

const kick = s("bd ~ bd ~")
  .bank("RolandTR909")
  .gain(0.95)
  .shape(0.22)
  .duckorbit(1)
  .duckattack(0.03)
  .duckdepth(0.72);

const clap = s("~ sd ~ sd")
  .bank("RolandTR909")
  .gain(0.42)
  .room(0.22)
  .roomsize(0.35);

const hats = stack(
  s("~ hh ~ hh")
    .bank("RolandTR909")
    .fast(2)
    .gain(sine.range(0.2, 0.38).slow(4))
    .hpf(5200)
    .pan(0.16),
  s("~ ~ ~ oh")
    .bank("RolandTR909")
    .gain(0.25)
    .hpf(4300)
    .decay(0.18)
    .room(0.28)
    .roomsize(0.42)
);

const perc = stack(
  s("~ rim [~ rim] ~")
    .bank("RolandTR707")
    .gain(0.17)
    .pan(-0.34)
    .delay(0.18)
    .delaytime(0.375)
    .delayfeedback(0.22),
  s("~ ~ cp ~")
    .bank("LinnDrum")
    .gain(0.1)
    .room(0.36)
    .roomsize(0.55)
);

const drums = stack(kick, clap, hats, perc);

const bass = note("<[a1 ~ a1 c2 e2 ~ c2 e1] [d2 ~ d2 f2 a1 ~ c2 d2] [f1 ~ f1 a1 c2 ~ e2 c2] [e1 ~ e1 g1 b1 ~ d2 e2]>")
  .s("saw")
  .attack(0.01)
  .decay(0.18)
  .sustain(0.42)
  .release(0.08)
  .lpf(sine.range(210, 560).slow(4))
  .lpq(0.7)
  .gain(0.47)
  .orbit(1);

const sub = note("<a1 d1 f1 e1>")
  .s("sine")
  .attack(0.02)
  .release(0.28)
  .lpf(90)
  .gain(0.16)
  .orbit(1);

const pad = prog
  .s("gm_pad_warm")
  .attack(1.4)
  .sustain(0.72)
  .release(2.4)
  .lpf(sine.range(720, 1850).slow(8))
  .gain(0.31)
  .room(0.58)
  .roomsize(0.86)
  .orbit(1);

const keys = prog
  .arp("<[0 1] ~ [2 1] 3>")
  .s("gm_epiano1")
  .attack(0.02)
  .decay(0.34)
  .sustain(0.25)
  .release(0.38)
  .lpf(2300)
  .gain(0.33)
  .room(0.25)
  .delay(0.2)
  .delaytime(0.375)
  .delayfeedback(0.24)
  .orbit(1);

const hook = n("<[~ [4 5] 7 ~ [9 7] 5 4 ~] [~ [7 9] 12 ~ [14 12] 9 7 ~]>")
  .scale("A:minor")
  .add(12)
  .s("triangle")
  .attack(0.02)
  .decay(0.15)
  .sustain(0.35)
  .release(0.25)
  .vib(4)
  .lpf(perlin.range(1200, 4100).slow(6))
  .delay(0.22)
  .delaytime(0.25)
  .delayfeedback(0.32)
  .gain(0.2)
  .pan(sine.range(-0.24, 0.24).slow(8))
  .orbit(1);

arrange(
  [8, stack(kick, hats, pad.gain(0.75), bass.gain(0.72))],
  [16, stack(drums, bass, sub, pad, keys)],
  [8, stack(pad.gain(1.22), keys.gain(0.82), hook.gain(0.76), hats.gain(0.55))],
  [16, stack(drums, bass, sub, pad, keys, hook)]
)
