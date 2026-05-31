setcpm(145/4);

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(1.08)
  .shape(0.34)
  .clip(0.92)
  .duckorbit(1)
  .duckattack(0.012)
  .duckdepth(0.9);

const hats = stack(
  s("hh*16")
    .bank("RolandTR909")
    .gain(0.22)
    .hpf(5200)
    .pan(rand.range(0.42, 0.58)),
  s("~ oh ~ oh")
    .bank("RolandTR909")
    .gain(0.18)
    .hpf(3900)
    .decay(0.12)
    .pan(sine.range(0.35, 0.65).slow(4)),
  s("~ rim ~ [rim rim]")
    .bank("RolandTR707")
    .gain(0.14)
    .hpf(1600)
    .room(0.18)
);

const perc = stack(
  s("<~ cp ~ ~>")
    .bank("RolandTR909")
    .gain(0.22)
    .hpf(1200)
    .room(0.2),
  s("<~ ~ ~ [sd sd sd sd]>")
    .bank("RolandTR909")
    .gain(0.35)
    .hpf(900)
    .room(0.28)
);

const bassA = note("[~ e2 e2] [~ e2 e2] [~ e2 e2] [~ e2 e2]")
  .s("saw")
  .attack(0.001)
  .decay(0.075)
  .sustain(0.04)
  .release(0.018)
  .lpf(sine.range(120, 205).slow(8))
  .lpq(9)
  .shape(0.18)
  .gain(0.72)
  .orbit(1);

const bassB = note("[~ e2 e2] [~ e2 g2] [~ e2 e2] [~ d2 e2]")
  .s("saw")
  .attack(0.001)
  .decay(0.078)
  .sustain(0.045)
  .release(0.016)
  .lpf(perlin.range(130, 260).slow(6))
  .lpq(11)
  .shape(0.22)
  .gain(0.74)
  .orbit(1);

const pad = chord("<Em7 Cmaj7 Dmaj7 B7>")
  .voicing()
  .s("gm_pad_warm")
  .attack(1.2)
  .sustain(0.72)
  .release(2.4)
  .lpf(sine.range(780, 2600).slow(16))
  .room(0.72)
  .roomsize(0.88)
  .gain(0.26)
  .pan(sine.range(0.28, 0.72).slow(10))
  .orbit(1);

const arp = chord("<Em7 Dmaj7 Cmaj7 B7>")
  .voicing()
  .arp("0 1 2 3 2 1 0 2")
  .s("supersaw")
  .attack(0.006)
  .decay(0.12)
  .sustain(0.16)
  .release(0.08)
  .lpf(perlin.range(1050, 6200).slow(8))
  .lpq(6)
  .delay(0.24)
  .delaytime(0.1875)
  .delayfeedback(0.42)
  .room(0.28)
  .gain(0.27)
  .pan(sine.range(0.18, 0.82).slow(6))
  .orbit(1);

const acid = n("<[0 7 3 10]*2 [0 12 10 7]*2 [3 5 7 12]*2 [10 7 5 3]*2>")
  .scale("E:minor")
  .add(12)
  .every(4, x => x.add(12))
  .s("square")
  .fm(4)
  .attack(0.003)
  .decay(0.085)
  .sustain(0.12)
  .release(0.035)
  .lpf(sine.range(620, 5200).slow(8))
  .lpq(18)
  .delay(0.18)
  .delaytime(0.125)
  .delayfeedback(0.35)
  .shape(0.16)
  .gain(0.31)
  .pan(sine.range(0.22, 0.78).slow(3))
  .orbit(1);

const forest = n("<0 2 3 5 7 10 12 14>*4")
  .scale("E:minor")
  .add(24)
  .every(3, x => x.fast(2))
  .s("triangle")
  .fm(9)
  .attack(0.002)
  .decay(0.05)
  .sustain(0)
  .release(0.025)
  .lpf(rand.range(900, 7600))
  .delay(0.16)
  .delaytime(0.09375)
  .delayfeedback(0.32)
  .room(0.34)
  .gain(0.13)
  .pan(rand.range(0.05, 0.95))
  .orbit(1);

const riser = note("e6*32")
  .s("white")
  .attack(0.004)
  .decay(0.038)
  .sustain(0)
  .release(0.018)
  .hpf(saw.range(280, 7600).slow(8))
  .lpf(9200)
  .room(0.62)
  .roomsize(0.9)
  .gain(saw.range(0.012, 0.24).slow(8))
  .pan(rand.range(0.08, 0.92))
  .orbit(1);

const zaps = note("<e6 b5 g5 e5>")
  .s("sine")
  .fm(12)
  .attack(0.001)
  .decay(0.075)
  .sustain(0)
  .release(0.05)
  .delay(0.22)
  .delaytime(0.15625)
  .delayfeedback(0.46)
  .room(0.36)
  .gain(0.16)
  .pan(sine.range(0.1, 0.9).slow(5))
  .orbit(1);

const intro = stack(
  kick.mask("<1 1 1 1 1 1 0 1>"),
  hats.mask("<0 0 1 1>"),
  pad,
  arp.mask("<0 1 1 1>"),
  zaps.mask("<1 0 1 0>"),
  riser.mask("<0 0 0 1>")
);

const dropA = stack(
  kick,
  bassA,
  hats,
  perc.mask("<0 1 0 1>"),
  arp,
  forest.mask("<0 1 1 1>"),
  zaps.mask("<1 0 0 0>")
);

const break = stack(
  pad.gain(0.34),
  arp.slow(2).gain(0.18),
  acid.mask("<0 0 1 1>").gain(0.18),
  zaps,
  riser,
  hats.mask("<0 0 0 1>")
);

const peak = stack(
  kick,
  bassB,
  hats,
  perc,
  arp,
  acid,
  forest,
  zaps.mask("<1 0 1 0>"),
  riser.mask("<0 0 0 1>")
);

const outro = stack(
  kick.mask("<1 1 1 0>"),
  bassA.mask("<1 1 0 0>"),
  hats.mask("<1 1 1 0>"),
  pad,
  arp.mask("<1 0 1 0>"),
  zaps.mask("<0 1 0 1>")
);

arrange(
  [8, intro],
  [16, dropA],
  [8, break],
  [24, peak],
  [8, outro]
);
