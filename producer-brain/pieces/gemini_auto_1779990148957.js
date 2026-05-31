setcpm(138/4);

const chordProg = chord("<Am7 Fmaj7 Cmaj7 G7>").voicing();

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(1.12)
  .duckorbit(1)
  .duckattack(0.018)
  .duckdepth(0.82);

const clap = s("~ cp ~ cp")
  .bank("RolandTR909")
  .gain(0.48)
  .room(0.35)
  .roomsize(0.7)
  .delay(0.12)
  .delaytime(0.25)
  .delayfeedback(0.18);

const hats = stack(
  s("hh*16")
    .bank("RolandTR909")
    .gain(0.16)
    .hpf(6200)
    .pan(sine.range(0.44, 0.58).slow(2)),
  s("~ oh ~ oh")
    .bank("RolandTR909")
    .gain(0.23)
    .hpf(5200)
    .release(0.08)
    .pan(0.68)
);

const perc = s("rim*8")
  .bank("RolandTR707")
  .gain(0.16)
  .hpf(1800)
  .pan(perlin.range(0.25, 0.75).slow(3))
  .mask("<1 0 1 1>");

const bass = note("<[~ a1 a1 a1 ~ a1 a1 a1 ~ a1 a1 a1 ~ a1 a1 a1] [~ f1 f1 f1 ~ f1 f1 f1 ~ f1 f1 f1 ~ f1 f1 f1] [~ c2 c2 c2 ~ c2 c2 c2 ~ c2 c2 c2 ~ c2 c2 c2] [~ g1 g1 g1 ~ g1 g1 g1 ~ g1 g1 g1 ~ g1 g1 g1]>")
  .s("sawtooth")
  .fm(2)
  .attack(0.004)
  .decay(0.12)
  .sustain(0.22)
  .release(0.05)
  .lpf(520)
  .lpq(0.45)
  .shape(0.18)
  .gain(0.72)
  .orbit(1);

const arpPluck = chordProg
  .arp("0 1 2 1 0 1 2 1 0 1 2 1 0 1 2 1")
  .add(12)
  .s("square")
  .fm(3)
  .attack(0.003)
  .decay(0.12)
  .sustain(0)
  .release(0.07)
  .lpf(perlin.range(1800, 5600).slow(8))
  .lpq(0.38)
  .gain(0.42)
  .pan(sine.range(0.28, 0.72).slow(4))
  .delay(0.34)
  .delaytime(0.1875)
  .delayfeedback(0.36)
  .room(0.18)
  .orbit(1);

const pad = chordProg
  .s("gm_pad_warm")
  .attack(0.55)
  .decay(0.8)
  .sustain(0.82)
  .release(2.3)
  .lpf(sine.range(950, 3600).slow(16))
  .room(0.72)
  .roomsize(0.92)
  .gain(0.48)
  .orbit(1);

const stabs = chordProg
  .s("supersaw")
  .struct("[x ~] ~ x [~ x]")
  .attack(0.01)
  .decay(0.34)
  .sustain(0.28)
  .release(0.22)
  .detune(0.18)
  .lpf(saw.range(2400, 7200).slow(8))
  .lpq(0.32)
  .gain(0.56)
  .room(0.28)
  .delay(0.18)
  .delaytime(0.125)
  .delayfeedback(0.22)
  .orbit(1);

const lead = note("<[e5 ~ g5 a5] [c6 b5 a5 g5] [e5 ~ g5 e5] [d5 e5 g5 b5]>")
  .s("supersaw")
  .attack(0.01)
  .decay(0.24)
  .sustain(0.45)
  .release(0.32)
  .detune(0.12)
  .lpf(sine.range(3200, 7800).slow(6))
  .gain(0.34)
  .delay(0.38)
  .delaytime(0.25)
  .delayfeedback(0.34)
  .room(0.42)
  .pan(0.53)
  .off(0.25, x => x.add(12).gain(0.16))
  .orbit(1);

const noiseRise = note("c4*16")
  .s("white")
  .attack(0.001)
  .decay(0.035)
  .sustain(0)
  .release(0.035)
  .hpf(saw.range(600, 9200).slow(8))
  .gain(saw.range(0.025, 0.22).slow(8))
  .pan(rand.range(0.1, 0.9))
  .room(0.35);

const snareRoll = s("sd*16")
  .bank("RolandTR909")
  .gain(saw.range(0.05, 0.46).slow(4))
  .hpf(900)
  .room(0.28);

const intro = stack(
  pad.gain(0.42),
  arpPluck.gain(0.28).lpf(2100),
  kick.gain(0.72).mask("<1 0 1 0>"),
  hats.gain(0.42).mask("<0 1 1 1>")
);

const build = stack(
  kick,
  bass.gain(0.58),
  clap,
  hats,
  arpPluck,
  pad,
  stabs.gain(0.42),
  snareRoll,
  noiseRise
);

const drop = stack(
  kick,
  bass,
  clap,
  hats,
  perc,
  arpPluck,
  stabs,
  pad,
  lead.mask("<0 1 1 1>")
);

const breakPart = stack(
  pad.gain(0.62).lpf(1800),
  arpPluck.gain(0.22).lpf(1600),
  lead.gain(0.2).room(0.75),
  noiseRise.gain(0.12)
);

const finale = stack(
  kick,
  bass,
  clap,
  hats.gain(1.08),
  perc,
  arpPluck.superimpose(x => x.add(12).gain(0.18)),
  stabs.gain(0.66),
  pad.gain(0.5),
  lead
);

arrange(
  [4, intro],
  [8, build],
  [8, drop],
  [4, breakPart],
  [8, finale]
)
