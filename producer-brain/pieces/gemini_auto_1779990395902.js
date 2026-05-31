setcpm(120/4);

const kick = s("bd ~ ~ bd")
  .bank("RolandTR808")
  .gain(0.72)
  .lpf(145)
  .hpf(28)
  .decay(0.55)
  .shape(0.16)
  .duckorbit(1)
  .duckattack(0.035)
  .duckdepth(0.78);

const ghost = s("~ ~ bd ~")
  .bank("RolandTR808")
  .gain(0.16)
  .lpf(120)
  .hpf(30)
  .decay(0.42)
  .shape(0.1)
  .mask("<0 1 0 1>")
  .duckorbit(1)
  .duckattack(0.035)
  .duckdepth(0.45);

const rim = s("~ rim ~ [~ rim]")
  .bank("RolandTR707")
  .gain(0.18)
  .hpf(950)
  .lpf(3200)
  .delay(0.34)
  .delaytime(0.5)
  .delayfeedback(0.55)
  .room(0.28)
  .roomsize(0.62);

const hats = s("hh*16")
  .bank("RolandTR909")
  .gain(rand.range(0.025, 0.09).slow(2))
  .hpf(5200)
  .lpf(10500)
  .decay(0.035)
  .pan(rand.range(0.42, 0.58).slow(1));

const openhat = s("~ ~ oh ~")
  .bank("RolandTR808")
  .gain(0.09)
  .hpf(4200)
  .lpf(8800)
  .decay(0.18)
  .room(0.18)
  .mask("<1 0 1 1>");

const hiss = s("pink")
  .gain(0.032)
  .hpf(2400)
  .lpf(sine.range(6200, 11000).slow(11))
  .attack(0.02)
  .release(4)
  .room(0.22)
  .roomsize(0.7)
  .pan(sine.range(0.38, 0.62).slow(13));

const sub = note("<[a1 ~ a1 e1] [a1 ~ g1 e1] [d1 ~ d1 a1] [f1 ~ e1 g1]>")
  .s("sine")
  .fm(1.2)
  .gain(0.42)
  .attack(0.006)
  .decay(0.38)
  .sustain(0.18)
  .release(0.16)
  .lpf(92)
  .hpf(24)
  .shape(0.08)
  .orbit(1);

const stabs = chord("<Am9 Em7 Dm9 Fmaj7>")
  .voicing()
  .struct("[~ x] ~ ~ [x ~]")
  .s("sawtooth")
  .gain(0.39)
  .attack(0.004)
  .decay(0.42)
  .sustain(0.08)
  .release(2.7)
  .lpf(sine.range(620, 1500).slow(8))
  .lpq(0.5)
  .detune(0.13)
  .shape(0.24)
  .delay(0.68)
  .delaytime(0.75)
  .delayfeedback(0.74)
  .room(0.5)
  .roomsize(0.82)
  .pan(0.48)
  .orbit(1);

const pad = chord("<Am9 Em7 Dm9 Fmaj7>")
  .voicing()
  .slow(2)
  .s("gm_pad_warm")
  .gain(0.18)
  .attack(1.4)
  .decay(1.8)
  .sustain(0.62)
  .release(6)
  .lpf(sine.range(360, 850).slow(16))
  .lpq(0.25)
  .room(0.72)
  .roomsize(0.9)
  .orbit(1);

const dust = chord("<Am9 Em7 Dm9 Fmaj7>")
  .voicing()
  .arp("0 2 3 1")
  .fast(2)
  .s("triangle")
  .gain(0.075)
  .attack(0.006)
  .decay(0.08)
  .sustain(0)
  .release(0.34)
  .lpf(perlin.range(900, 2400).slow(6))
  .delay(0.55)
  .delaytime(0.375)
  .delayfeedback(0.66)
  .room(0.32)
  .pan(sine.range(0.25, 0.75).slow(5))
  .mask("<0 1 0 0 1 0 0 0>")
  .orbit(1);

const sonar = n("~ 7 ~ 4 ~ 2 [0 ~] ~")
  .scale("A:minor")
  .add(12)
  .s("sine")
  .fm(4)
  .gain(0.055)
  .attack(0.01)
  .decay(0.18)
  .sustain(0)
  .release(0.7)
  .lpf(1800)
  .delay(0.62)
  .delaytime(0.625)
  .delayfeedback(0.7)
  .room(0.42)
  .pan(sine.range(0.2, 0.8).slow(7))
  .orbit(1);

const drums = stack(kick, ghost, rim, hats, openhat);

const intro = stack(
  hiss,
  kick.mask("<1 0 1 0>"),
  sub.mask("<0 1>").gain(0.78),
  pad.gain(0.82),
  stabs.mask("<0 1 0 0>").gain(0.55)
);

const main = stack(
  hiss,
  drums,
  sub,
  stabs,
  pad,
  dust
);

const breakdown = stack(
  hiss.gain(1.35),
  rim.mask("<1 0 1 1>").gain(1.2),
  pad.gain(1.25),
  stabs.gain(0.72),
  dust.gain(1.25)
);

const dub = stack(
  hiss,
  drums,
  sub,
  stabs.superimpose(x => x.add(12).gain(0.18).pan(0.66).delayfeedback(0.82)),
  pad,
  dust,
  sonar
);

const outro = stack(
  hiss,
  kick.mask("<1 0>"),
  sub.mask("<1 0 0 1>").gain(0.62),
  stabs.gain(0.32),
  pad.gain(0.7)
);

arrange(
  [8, intro],
  [16, main],
  [8, breakdown],
  [16, dub],
  [8, outro]
)
