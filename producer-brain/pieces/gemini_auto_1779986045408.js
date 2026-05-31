setcpm(174/4);

const pad = chord("<Am9 Fmaj7 Dm9 Em7>").slow(2).voicing()
  .s("gm_pad_warm")
  .attack(1.4)
  .decay(0.6)
  .sustain(0.8)
  .release(3.2)
  .lpf(sine.range(700, 2600).slow(8))
  .lpq(0.25)
  .room(0.75)
  .roomsize(0.9)
  .gain(0.28)
  .pan(sine.range(0.18, 0.82).slow(12))
  .orbit(1);

const mist = s("pink")
  .struct("~ x ~ ~ ~ x ~ ~")
  .attack(0.2)
  .release(1.8)
  .hpf(perlin.range(1800, 7600).slow(6))
  .lpf(9000)
  .room(0.85)
  .roomsize(0.95)
  .gain(0.035)
  .pan(rand.range(0.05, 0.95))
  .orbit(1);

const sub = note("<[a1 ~ a1 e1] [f1 ~ f1 e1] [d1 ~ d1 c2] [e1 ~ g1 e1]>")
  .s("sine")
  .attack(0.005)
  .decay(0.18)
  .sustain(0.55)
  .release(0.09)
  .lpf(95)
  .gain(0.62)
  .orbit(1);

const reese = note("<[a1 ~ a1 e2] [f1 ~ f1 e2] [d1 ~ d1 c2] [e1 ~ g1 e2]>")
  .s("supersaw")
  .detune(0.18)
  .attack(0.01)
  .decay(0.22)
  .sustain(0.35)
  .release(0.08)
  .lpf(sine.range(180, 820).slow(4))
  .lpq(0.35)
  .shape(0.18)
  .gain(0.16)
  .pan(sine.range(0.35, 0.65).slow(3))
  .orbit(1);

const amen = s("<[bd hh rim hh sd hh bd hh rim sd hh bd sd hh rim oh] [bd hh rim sd hh bd hh sd rim hh bd hh sd rim sd oh] [bd hh sd hh rim hh bd hh sd hh rim bd sd hh rim oh] [bd hh rim hh sd bd hh sd rim hh bd hh sd rim oh sd]>")
  .bank("LinnDrum")
  .hpf(80)
  .lpf(9500)
  .speed("<1 1.04 0.97 1.08>")
  .gain(0.58)
  .room(0.18)
  .every(4, x => x.fast(2).gain(0.42));

const ghostBreak = s("<[~ hh ~ rim ~ hh sd hh ~ rim ~ hh ~ sd hh oh] [~ hh rim ~ ~ sd hh ~ rim hh ~ bd ~ sd rim hh]>")
  .bank("RolandTR707")
  .hpf(260)
  .lpf(11000)
  .gain(0.22)
  .pan(rand.range(0.25, 0.75));

const kickPunch = s("bd ~ ~ ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~ ~ ~")
  .bank("RolandTR909")
  .gain(0.75)
  .lpf(120)
  .duckorbit(1)
  .duckattack(0.025)
  .duckdepth(0.6);

const snareWeight = s("~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ ~")
  .bank("RolandTR909")
  .gain(0.5)
  .hpf(160)
  .room(0.2);

const hats = s("hh*16")
  .bank("RolandTR808")
  .gain(sine.range(0.08, 0.22).fast(2))
  .hpf(5200)
  .pan(sine.range(0.25, 0.75).fast(1));

const openHats = s("~ ~ oh ~ ~ ~ oh ~")
  .bank("RolandTR808")
  .gain(0.18)
  .hpf(4200)
  .release(0.08)
  .pan(0.65);

const arp = chord("<Am9 Fmaj7 Dm9 Em7>").slow(2).voicing()
  .arp("0 2 3 1 2 0 3 2")
  .s("triangle")
  .attack(0.005)
  .decay(0.14)
  .sustain(0)
  .release(0.12)
  .lpf(sine.range(900, 3400).slow(4))
  .delay(0.35)
  .delaytime(0.25)
  .delayfeedback(0.32)
  .room(0.35)
  .gain(0.13)
  .pan(sine.range(0.12, 0.88).slow(5))
  .orbit(1);

const fluteAir = n("<0 2 4 7 9 7 4 2>").scale("A:minor")
  .s("gm_flute")
  .add(12)
  .attack(0.05)
  .decay(0.25)
  .sustain(0.15)
  .release(0.5)
  .lpf(3800)
  .delay(0.28)
  .delaytime(0.375)
  .delayfeedback(0.28)
  .room(0.5)
  .gain(0.11)
  .pan(sine.range(0.72, 0.28).slow(7))
  .mask("<1 0 0 1 0 1 0 0>");

const introDrums = stack(
  amen.gain(0.24).hpf(450),
  hats.gain(0.45),
  openHats.gain(0.08)
);

const fullDrums = stack(
  amen,
  ghostBreak,
  kickPunch,
  snareWeight,
  hats,
  openHats
);

const breakdownPulse = stack(
  sub.mask("<1 0 1 0>").gain(0.42),
  arp.gain(0.08),
  mist.gain(1.35)
);

arrange(
  [8, stack(pad, mist, introDrums, arp.gain(0.07))],
  [16, stack(pad, mist, fullDrums, sub, reese, arp, fluteAir)],
  [8, stack(pad.gain(0.38), breakdownPulse, fluteAir.gain(0.16))],
  [16, stack(pad, mist, fullDrums, sub, reese, arp.gain(0.15), fluteAir)]
)
