setcpm(132/4);

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(1.18)
  .shape(0.22)
  .lpf(120)
  .duckorbit(1)
  .duckattack(0.012)
  .duckdepth(0.72);

const sub = note("<a1 a1 g1 a1>")
  .struct("x ~ [x ~] ~ x ~ [x x] ~")
  .s("sine")
  .attack(0.005)
  .decay(0.18)
  .sustain(0.35)
  .release(0.06)
  .lpf(92)
  .gain(0.58)
  .orbit(1);

const hats = stack(
  s("~ hh ~ hh")
    .bank("RolandTR909")
    .gain(0.34)
    .hpf(7200)
    .release(0.05)
    .pan(0.58),
  s("hh*16")
    .bank("RolandTR909")
    .gain(sine.range(0.035, 0.12).slow(3))
    .hpf(8800)
    .decay(0.035)
    .pan(perlin.range(0.35, 0.72).slow(5)),
  s("~ oh ~ oh")
    .bank("RolandTR909")
    .gain(0.18)
    .hpf(6400)
    .decay(0.24)
    .release(0.08)
    .pan(0.64)
);

const backbeat = stack(
  s("~ sd ~ sd")
    .bank("RolandTR909")
    .gain(0.38)
    .hpf(700)
    .room(0.28)
    .roomsize(0.45),
  s("~ ~ cp ~")
    .bank("RolandTR707")
    .gain(0.14)
    .hpf(1200)
    .room(0.55)
    .delay(0.22)
    .delaytime(0.375)
    .delayfeedback(0.38)
);

const rimgrid = s("<rim ~ rim [rim rim]>*2")
  .bank("RolandTR808")
  .gain(0.13)
  .hpf(2800)
  .delay(0.18)
  .delaytime(0.1875)
  .delayfeedback(0.32)
  .pan(sine.range(0.25, 0.75).slow(6));

const stabs = chord("<Am7 Am7 Fmaj7 Em7>")
  .voicing()
  .struct("~ x ~ [~ x]")
  .s("saw")
  .attack(0.004)
  .decay(0.11)
  .sustain(0.18)
  .release(2.7)
  .lpf(perlin.range(520, 2100).slow(8))
  .lpq(0.35)
  .room(0.86)
  .roomsize(0.92)
  .delay(0.34)
  .delaytime(0.75)
  .delayfeedback(0.62)
  .gain(0.42)
  .pan(0.43)
  .orbit(1);

const acid = chord("<Am7 Am7 Fmaj7 Em7>")
  .voicing()
  .arp("0 1 2 1 3 2 1 0")
  .fast(2)
  .s("square")
  .fm(3)
  .attack(0.002)
  .decay(0.075)
  .sustain(0.05)
  .release(0.035)
  .lpf(sine.range(360, 1650).slow(4))
  .lpq(0.62)
  .gain(0.24)
  .pan(sine.range(0.38, 0.62).slow(7))
  .delay(0.12)
  .delaytime(0.1875)
  .delayfeedback(0.26)
  .orbit(1);

const lowPulse = n("<0 0 6 0 5 3 0 0>*2")
  .scale("A:minor")
  .sub(24)
  .s("sawtooth")
  .struct("x ~ x x ~ x ~ [x ~]")
  .attack(0.002)
  .decay(0.09)
  .sustain(0.12)
  .release(0.03)
  .lpf(240)
  .gain(0.21)
  .orbit(1);

const darkAir = stack(
  s("pink")
    .struct("x")
    .attack(3)
    .release(7)
    .lpf(perlin.range(180, 620).slow(16))
    .gain(0.075)
    .room(0.95)
    .roomsize(0.98)
    .orbit(1),
  note("<a2 e3 a3 c4>")
    .s("gm_pad_warm")
    .attack(1.8)
    .release(5.5)
    .lpf(sine.range(420, 1300).slow(12))
    .gain(0.13)
    .room(0.9)
    .roomsize(0.95)
    .orbit(1)
);

const intro = stack(
  kick,
  hats,
  darkAir,
  stabs.mask("<0 1 1 1>")
);

const groove = stack(
  kick,
  sub,
  lowPulse,
  hats,
  backbeat,
  rimgrid,
  stabs,
  acid
);

const breakdown = stack(
  hats,
  backbeat.mask("<0 1>"),
  darkAir,
  stabs,
  acid.mask("<1 0 1 1>").lpf(620),
  rimgrid.mask("<1 0 1 0>")
);

const peak = stack(
  kick,
  sub,
  lowPulse,
  hats,
  backbeat,
  rimgrid,
  stabs,
  acid.superimpose(x => x.add(12).gain(0.12).lpf(2400)),
  darkAir.gain(0.05)
);

arrange(
  [8, intro],
  [16, groove],
  [8, breakdown],
  [16, peak],
  [8, groove],
  [8, stack(kick, hats, stabs, darkAir)]
)
