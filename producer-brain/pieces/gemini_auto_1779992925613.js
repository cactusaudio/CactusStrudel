setcpm(132/4);

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(1.18)
  .shape(0.48)
  .clip(0.9)
  .duckorbit(1)
  .duckattack(0.025)
  .duckdepth(0.88);

const sub = note("a1 [a1 a1] a1 [c2 a1] a1 [a1 a1] g1 [e1 g1]")
  .fast(2)
  .s("sawtooth")
  .attack(0.004)
  .decay(0.16)
  .sustain(0)
  .release(0.045)
  .lpf(sine.range(95, 520).slow(8))
  .lpq(0.34)
  .hpf(28)
  .shape(0.42)
  .gain(0.68)
  .orbit(1);

const grindBass = note("a0 ~ a0 [a0 c1] a0 ~ g0 [e0 g0]")
  .fast(2)
  .s("square")
  .fm(3)
  .attack(0.002)
  .decay(0.09)
  .sustain(0)
  .release(0.035)
  .lpf(perlin.range(80, 360).slow(6))
  .crush(5)
  .gain(0.32)
  .orbit(1);

const closedHat = s("hh*16")
  .bank("RolandTR909")
  .gain(sine.range(0.13, 0.38).slow(3))
  .hpf(6200)
  .decay(0.045)
  .pan(rand.range(-0.28, 0.28))
  .room(0.08);

const openHat = s("~ oh ~ oh")
  .bank("RolandTR909")
  .gain(0.2)
  .hpf(5200)
  .decay(0.24)
  .pan(sine.range(-0.18, 0.18).slow(5))
  .room(0.14);

const snare = s("~ sd ~ sd")
  .bank("RolandTR909")
  .gain(0.48)
  .shape(0.34)
  .hpf(170)
  .room(0.18);

const metal = stack(
  s("~ rim [~ rim] ~ [rim ~]")
    .bank("AlesisHR16")
    .fast(2)
    .gain(0.24)
    .hpf(1400)
    .delay(0.16)
    .delaytime(0.1875)
    .delayfeedback(0.38)
    .pan(rand.range(-0.45, 0.45)),
  s("~ ~ cp ~")
    .bank("LinnDrum")
    .gain(0.18)
    .hpf(900)
    .shape(0.5)
    .room(0.24)
);

const pad = chord("<Am9 Fmaj7 Dm9 E7>")
  .voicing()
  .slow(2)
  .s("gm_pad_warm")
  .attack(0.75)
  .decay(1.2)
  .sustain(0.62)
  .release(2.6)
  .lpf(perlin.range(420, 1550).slow(10))
  .room(0.72)
  .roomsize(0.86)
  .gain(0.22)
  .orbit(1);

const pulseArp = chord("<Am9 Fmaj7 Dm9 E7>")
  .voicing()
  .arp("0 1 2 3 2 1 0 2")
  .fast(4)
  .s("sine")
  .fm(5)
  .attack(0.004)
  .decay(0.085)
  .sustain(0)
  .release(0.035)
  .lpf(saw.range(520, 3600).slow(12))
  .delay(0.22)
  .delaytime(0.125)
  .delayfeedback(0.48)
  .gain(0.19)
  .pan(sine.range(-0.36, 0.36).slow(7))
  .orbit(1);

const siren = note("<a4 c5 e5 g5>")
  .slow(4)
  .s("supersaw")
  .attack(0.12)
  .decay(0.4)
  .sustain(0.2)
  .release(1.2)
  .lpf(sine.range(650, 2800).slow(6))
  .vib(0.18)
  .detune(0.12)
  .gain(0.11)
  .room(0.55)
  .orbit(1);

const riser = s("white")
  .struct("~ ~ ~ x")
  .slow(4)
  .attack(0.18)
  .decay(0.9)
  .sustain(0.3)
  .release(2.4)
  .hpf(saw.range(220, 7600).slow(8))
  .lpf(9000)
  .gain(0.16)
  .pan(sine.range(-0.65, 0.65).slow(8))
  .room(0.68)
  .orbit(1);

const impact = s("bd ~ ~ ~")
  .bank("RolandTR808")
  .slow(8)
  .speed(0.52)
  .gain(0.32)
  .lpf(180)
  .room(0.7)
  .roomsize(0.9);

const intro = stack(
  kick,
  closedHat.mask("<0 1 1 1>").gain(0.72),
  openHat.mask("<0 0 1 1>").gain(0.55),
  sub.lpf(210).gain(0.72),
  pad.gain(0.62),
  riser
);

const drive = stack(
  kick,
  closedHat,
  openHat,
  snare,
  metal,
  sub,
  grindBass.mask("<0 1 1 1>"),
  pad,
  pulseArp.mask("<0 1 1 1>"),
  riser,
  impact
);

const breakPressure = stack(
  closedHat.mask("<1 0 1 1>").gain(0.55),
  metal.gain(0.75),
  sub.mask("<1 0 1 0>").lpf(170).gain(0.48),
  grindBass.mask("<0 0 1 0>").gain(0.42),
  pad.gain(0.95),
  pulseArp.mask("<1 1 0 1>").lpf(1200).gain(0.15),
  siren,
  riser.gain(1.35),
  impact
);

const drop = stack(
  kick.gain(1.08),
  closedHat.gain(sine.range(0.18, 0.46).slow(2)),
  openHat.gain(0.24),
  snare.gain(0.56),
  metal.gain(1.16),
  sub.gain(0.82),
  grindBass.gain(0.5),
  pad.gain(0.72),
  pulseArp.gain(0.24),
  siren.mask("<0 1 0 1>"),
  riser,
  impact
);

arrange(
  [8, intro],
  [16, drive],
  [8, breakPressure],
  [24, drop],
  [8, drive],
  [8, drop]
)
