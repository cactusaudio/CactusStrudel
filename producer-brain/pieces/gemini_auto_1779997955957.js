setcpm(145/4);

const kick = s("bd*4").bank("RolandTR909")
  .gain(1.12)
  .shape(0.28)
  .clip(0.92)
  .duckorbit(1)
  .duckattack(0.01)
  .duckdepth(0.72);

const bass = note("~ e1 e1 e1 ~ e1 e1 e1 ~ e1 e1 e1 ~ e1 e1 e1")
  .s("saw")
  .attack(0.004)
  .decay(0.105)
  .sustain(0.18)
  .release(0.035)
  .lpf(sine.range(190, 430).slow(8))
  .lpq(0.32)
  .gain(0.74)
  .orbit(1);

const hats = stack(
  s("hh*16").bank("RolandTR909")
    .gain(0.18)
    .hpf(5200)
    .pan(sine.range(0.35, 0.65).slow(4)),
  s("oh").bank("RolandTR909")
    .struct("~ x ~ x")
    .gain(0.24)
    .decay(0.16)
    .hpf(6100)
    .pan(0.58)
);

const perc = stack(
  s("rim").bank("RolandTR707")
    .struct("~ ~ x ~ [~ x] ~ ~ x")
    .gain(0.22)
    .hpf(1800)
    .delay(0.18)
    .delaytime(0.1875)
    .delayfeedback(0.32)
    .pan(0.22),
  s("cp").bank("RolandTR808")
    .struct("~ ~ ~ x ~ ~ x ~")
    .gain(0.16)
    .hpf(2400)
    .room(0.28)
    .pan(0.78)
);

const pad = chord("<Em7 Cmaj7 D7 Bm7>").voicing()
  .slow(2)
  .s("gm_pad_warm")
  .attack(1.8)
  .decay(0.6)
  .sustain(0.72)
  .release(4.2)
  .lpf(sine.range(850, 2600).slow(16))
  .room(0.55)
  .roomsize(0.88)
  .gain(0.27)
  .orbit(1);

const arp = chord("<Em7 Cmaj7 D7 Bm7>").voicing()
  .arp("0 1 2 3 2 1 0 2")
  .fast(2)
  .s("supersaw")
  .attack(0.01)
  .decay(0.12)
  .sustain(0.28)
  .release(0.08)
  .lpf(perlin.range(900, 5200).slow(6))
  .lpq(0.48)
  .delay(0.22)
  .delaytime(0.125)
  .delayfeedback(0.38)
  .gain(0.24)
  .pan(sine.range(0.18, 0.82).slow(5))
  .orbit(1);

const acid = n("[0 ~ 0 2] [3 2 0 ~] [5 3 2 0] [7 ~ 10 7]")
  .scale("E:minor")
  .add(12)
  .fast(2)
  .every(4, x => x.add(12))
  .off(0.25, x => x.add(7).gain(0.45))
  .s("square")
  .fm(3)
  .attack(0.004)
  .decay(0.075)
  .sustain(0.26)
  .release(0.055)
  .lpf(saw.range(520, 4800).slow(8))
  .lpq(0.76)
  .shape(0.18)
  .delay(0.2)
  .delaytime(0.1875)
  .delayfeedback(0.42)
  .gain(0.31)
  .pan(perlin.range(0.12, 0.88).slow(6))
  .jux(rev)
  .orbit(1);

const chirps = n("<12 14 15 19 22 19 15 14>")
  .scale("E:minor")
  .fast(4)
  .s("sine")
  .fm(8)
  .attack(0.002)
  .decay(0.045)
  .sustain(0.12)
  .release(0.08)
  .lpf(sine.range(1200, 7200).slow(3))
  .delay(0.28)
  .delaytime(0.09375)
  .delayfeedback(0.52)
  .gain(0.13)
  .pan(rand.range(0.05, 0.95))
  .orbit(1);

const sweep = note("e4")
  .s("white")
  .struct("x ~ ~ ~")
  .attack(0.012)
  .decay(1.65)
  .sustain(0)
  .release(0.45)
  .hpf(sine.range(1800, 7600).slow(8))
  .lpf(saw.range(700, 9800).slow(16))
  .room(0.62)
  .roomsize(0.9)
  .gain(sine.range(0.06, 0.17).slow(8))
  .pan(sine.range(0.0, 1.0).slow(5))
  .orbit(1);

const drones = stack(
  note("<e3 b3 g4 d4>")
    .s("triangle")
    .fm(2)
    .slow(4)
    .attack(0.8)
    .decay(0.5)
    .sustain(0.65)
    .release(3.5)
    .lpf(perlin.range(500, 2100).slow(12))
    .vib(0.18)
    .room(0.5)
    .roomsize(0.92)
    .gain(0.16)
    .pan(0.36)
    .orbit(1),
  note("e5")
    .s("pink")
    .struct("~ ~ ~ x")
    .attack(0.02)
    .decay(2.2)
    .sustain(0)
    .release(1.1)
    .hpf(2600)
    .room(0.72)
    .gain(0.08)
    .pan(0.7)
    .orbit(1)
);

const intro = stack(
  kick.mask("<1 0 1 1>"),
  hats.mask("<0 1 1 1>"),
  pad,
  sweep,
  drones
);

const lift = stack(
  kick,
  bass.mask("<0 1 1 1>"),
  hats,
  perc.mask("<0 1 1 1>"),
  acid.mask("<0 1 1 1>"),
  pad,
  sweep,
  drones
);

const drop = stack(
  kick,
  bass,
  hats,
  perc,
  acid,
  arp.mask("<0 1 1 1>"),
  chirps.mask("<0 0 1 1>"),
  sweep
);

const breaksection = stack(
  kick.mask("<1 0 0 0>"),
  pad.gain(0.34),
  drones.gain(1.15),
  acid.slow(2).gain(0.22).mask("<1 1 0 1>"),
  chirps.mask("<1 0 1 0>"),
  sweep.gain(1.25)
);

const peak = stack(
  kick,
  bass,
  hats.gain(1.12),
  perc,
  acid.superimpose(x => x.add(12).gain(0.55)),
  arp,
  chirps.mask("<0 1 1 1>"),
  sweep,
  drones.gain(0.72)
);

const outro = stack(
  kick.mask("<1 1 0 0>"),
  bass.mask("<1 1 0 0>"),
  hats.mask("<1 0 1 0>"),
  acid.mask("<1 0 0 0>"),
  pad,
  sweep
);

arrange(
  [4, intro],
  [8, lift],
  [16, drop],
  [8, breaksection],
  [16, peak],
  [8, outro]
)
