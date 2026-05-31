setcpm(124/4);

const prog = chord("<Cmaj7 Am7 Fmaj7 G7>");

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(0.95)
  .duckorbit(1)
  .duckattack(0.06)
  .duckdepth(0.9);

const snare = s("~ sd ~ sd")
  .bank("RolandTR909")
  .gain(0.5)
  .room(0.18)
  .roomsize(0.35);

const clap = s("~ cp ~ cp")
  .bank("RolandTR909")
  .gain(0.24)
  .room(0.28)
  .roomsize(0.45);

const hats = s("hh*16")
  .bank("RolandTR909")
  .gain(0.17)
  .hpf(6500)
  .pan(sine.range(0.35, 0.65).slow(2));

const openhat = s("~ oh ~ oh")
  .bank("RolandTR909")
  .gain(0.25)
  .hpf(4500)
  .decay(0.18)
  .pan(0.58);

const rim = s("rim")
  .bank("RolandTR707")
  .struct("~ ~ x [~ x]")
  .gain(0.18)
  .hpf(1800)
  .pan(0.7);

const drums = stack(kick, snare, clap, hats, openhat, rim);

const bass = note("<[c2 ~ c2 ~ g1 ~ c2 ~] [a1 ~ a1 ~ e1 ~ a1 ~] [f1 ~ f1 ~ c2 ~ f1 ~] [g1 ~ g1 ~ d2 ~ g1 ~]>")
  .s("gm_synth_bass_1")
  .attack(0.005)
  .decay(0.14)
  .sustain(0.45)
  .release(0.04)
  .lpf(720)
  .lpq(0.8)
  .shape(0.18)
  .gain(0.55)
  .orbit(1)
  .duckdepth(0.65);

const stabs = prog.voicing()
  .struct("x ~ [~ x] ~")
  .s("gm_epiano1")
  .attack(0.01)
  .decay(0.36)
  .sustain(0.18)
  .release(0.16)
  .lpf(2600)
  .room(0.24)
  .roomsize(0.48)
  .gain(0.36)
  .orbit(1)
  .duckdepth(0.38);

const pad = prog.voicing()
  .s("gm_pad_warm")
  .attack(0.55)
  .decay(0.4)
  .sustain(0.75)
  .release(1.4)
  .lpf(sine.range(850, 1900).slow(8))
  .room(0.48)
  .roomsize(0.78)
  .gain(0.16)
  .orbit(1)
  .duckdepth(0.25);

const arp = prog.voicing()
  .arp("0 1 2 3 2 1 3 2")
  .s("triangle")
  .fm(2)
  .attack(0.004)
  .decay(0.09)
  .sustain(0)
  .release(0.06)
  .lpf(3100)
  .delay(0.24)
  .delaytime(0.25)
  .delayfeedback(0.32)
  .room(0.18)
  .gain(0.16)
  .orbit(1)
  .duckdepth(0.35)
  .pan(sine.range(0.25, 0.75).slow(3));

const hook = note("<[c5 ~ c5 d5 e5 d5 c5 g5] [a4 ~ g4 e4 d4 e4 g4 ~] [f4 ~ g4 a4 c5 a4 g4 f4] [b4 ~ a4 g4 e4 d4 c4 ~]>")
  .s("supersaw")
  .attack(0.005)
  .decay(0.16)
  .sustain(0.05)
  .release(0.08)
  .lpf(perlin.range(1600, 4200).slow(4))
  .delay(0.28)
  .delaytime(0.25)
  .delayfeedback(0.35)
  .room(0.25)
  .gain(0.28)
  .orbit(1)
  .duckdepth(0.4)
  .pan(sine.range(0.25, 0.75).slow(4));

const bigHook = hook.superimpose(x => x.add(12).gain(0.32));

const sweep = s("white")
  .struct("x")
  .attack(0.25)
  .release(0.8)
  .gain(sine.range(0.015, 0.06).slow(8))
  .hpf(saw.range(900, 7000).slow(8))
  .room(0.6)
  .roomsize(0.82);

const intro = stack(
  kick,
  hats.gain(0.55).mask("<1 0 1 1>"),
  pad,
  stabs.mask("<1 0>")
);

const verse = stack(
  drums,
  bass,
  stabs,
  arp.gain(0.75)
);

const drop = stack(
  drums,
  bass,
  stabs,
  pad,
  hook,
  arp,
  sweep.gain(0.6)
);

const breakSection = stack(
  pad,
  stabs,
  hook.mask("<1 0>"),
  sweep.gain(0.85),
  s("cp").bank("RolandTR909").struct("~ ~ ~ x").gain(0.3).room(0.5)
);

const bigDrop = stack(
  drums,
  bass,
  stabs,
  pad,
  bigHook,
  arp.gain(1.15),
  sweep.gain(0.7)
);

arrange(
  [4, intro],
  [8, verse],
  [16, drop],
  [4, breakSection],
  [16, bigDrop]
)
