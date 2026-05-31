setcpm(130/4);

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(1.08)
  .shape(0.32)
  .clip(0.92)
  .duckorbit(1)
  .duckattack(0.015)
  .duckdepth(0.82);

const sub = note("f1*4")
  .s("sine")
  .attack(0.004)
  .decay(0.32)
  .sustain(0)
  .release(0.06)
  .gain(0.58)
  .lpf(72)
  .orbit(1);

const midbass = note("f2 [~ f2] f2 [f2 eb2]")
  .s("sawtooth")
  .attack(0.006)
  .decay(0.18)
  .sustain(0)
  .release(0.05)
  .gain(0.34)
  .lpf(perlin.range(95, 420).slow(12))
  .lpq(5)
  .shape(0.18)
  .orbit(1);

const hats = s("hh*16")
  .bank("RolandTR909")
  .gain("0.18 0.065 0.13 0.075 0.2 0.06 0.12 0.085")
  .hpf(7200)
  .pan(sine.range(0.43, 0.57).slow(3))
  .room(0.12);

const openhat = s("~ oh ~ oh")
  .bank("RolandTR909")
  .gain(0.16)
  .hpf(6200)
  .decay(0.09)
  .pan(0.62);

const clap = s("~ cp ~ cp")
  .bank("RolandTR909")
  .gain(0.38)
  .hpf(900)
  .room(0.22)
  .roomsize(0.38);

const rim = s("~ [rim ~] ~ [rim rim]")
  .bank("RolandTR707")
  .gain(0.17)
  .hpf(1400)
  .delay(0.16)
  .delaytime(0.1875)
  .delayfeedback(0.42)
  .pan(sine.range(0.28, 0.72).slow(5));

const stabNotes = note("[f3,ab3,c4,eb4]")
  .struct("x ~ ~ [~ x]");

const stab = stabNotes
  .s("supersaw")
  .attack(0.004)
  .decay(0.16)
  .sustain(0)
  .release(0.055)
  .gain(0.31)
  .lpf(sine.range(430, 3200).slow(16))
  .lpq(8)
  .detune(0.14)
  .delay(0.2)
  .delaytime(0.375)
  .delayfeedback(0.44)
  .room(0.28)
  .orbit(1);

const stabLift = stabNotes
  .off(0.125, x => x.add(12))
  .s("supersaw")
  .attack(0.004)
  .decay(0.13)
  .sustain(0)
  .release(0.04)
  .gain(0.18)
  .lpf(sine.range(700, 4200).slow(16))
  .lpq(7)
  .detune(0.09)
  .delay(0.18)
  .delaytime(0.25)
  .delayfeedback(0.36)
  .room(0.22)
  .orbit(1);

const acid = n("0 [0 3] 0 [6 5] 0 [~ 3] 5 [3 0]")
  .scale("F:minor")
  .s("square")
  .fm(3)
  .attack(0.003)
  .decay(0.09)
  .sustain(0)
  .release(0.035)
  .gain(0.16)
  .lpf(perlin.range(240, 1850).slow(8))
  .lpq(11)
  .pan(sine.range(0.36, 0.64).slow(4))
  .delay(0.08)
  .delaytime(0.125)
  .delayfeedback(0.28)
  .orbit(1);

const pad = note("[f2,c3,ab3,eb4]")
  .s("gm_pad_warm")
  .attack(1.2)
  .release(2.6)
  .gain(0.13)
  .lpf(sine.range(520, 1100).slow(24))
  .room(0.74)
  .roomsize(0.88)
  .orbit(1);

const noise = s("pink")
  .struct("~ ~ [x ~] ~")
  .attack(0.01)
  .decay(0.16)
  .sustain(0)
  .release(0.05)
  .gain(0.055)
  .hpf(perlin.range(1800, 8200).slow(10))
  .pan(sine.range(0.2, 0.8).slow(7))
  .delay(0.12)
  .delaytime(0.125)
  .delayfeedback(0.26)
  .room(0.35);

const intro = stack(
  kick,
  sub.gain(0.46),
  hats.gain(0.62),
  stab.gain(0.22),
  noise.gain(0.45)
);

const groove = stack(
  kick,
  sub,
  midbass,
  hats,
  openhat,
  clap,
  rim.gain(0.72),
  stab
);

const breakA = stack(
  kick.mask("<1 1 0 1>"),
  sub.gain(0.42),
  hats.gain(0.35),
  stab.gain(0.46),
  pad,
  noise.gain(1.25)
);

const fullA = stack(
  kick,
  sub,
  midbass,
  hats,
  openhat,
  clap,
  rim,
  stab,
  acid,
  noise
);

const tunnel = stack(
  kick,
  sub,
  hats.gain(0.72),
  openhat.gain(0.5),
  stab.gain(0.38),
  pad.gain(0.7),
  noise.gain(1.4)
);

const fullB = stack(
  kick,
  sub,
  midbass.gain(1.08),
  hats,
  openhat,
  clap,
  rim,
  stab,
  stabLift,
  acid.gain(0.2),
  noise
);

arrange(
  [8, intro],
  [8, groove],
  [4, breakA],
  [16, fullA],
  [4, tunnel],
  [16, fullB]
)
