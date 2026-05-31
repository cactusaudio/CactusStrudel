setcpm(132/4);

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(0.98)
  .shape(0.28)
  .clip(0.88)
  .duckorbit(1)
  .duckattack(0.035)
  .duckdepth(0.82);

const hatOff = s("~ hh ~ hh ~ hh ~ hh")
  .bank("RolandTR909")
  .gain(0.26)
  .hpf(6200)
  .lpf(11800)
  .room(0.08)
  .pan(perlin.range(-0.12, 0.12).slow(6));

const hat16 = s("hh*16")
  .bank("RolandTR909")
  .gain(0.055)
  .hpf(7600)
  .lpf(13200)
  .pan(perlin.range(-0.18, 0.18).slow(4));

const clap = s("~ cp ~ cp")
  .bank("RolandTR909")
  .gain(0.42)
  .hpf(900)
  .room(0.18)
  .delay(0.08)
  .delaytime(0.018)
  .delayfeedback(0.04);

const rim = s("~ rim [~ rim] ~ [rim ~]")
  .bank("RolandTR909")
  .gain(0.18)
  .hpf(1500)
  .lpf(9000)
  .room(0.12)
  .pan(sine.range(-0.28, 0.28).slow(8));

const tomPerc = s("~ ~ lt ~ mt ~ [~ ht] ~")
  .bank("RolandTR909")
  .gain(0.16)
  .lpf(2600)
  .shape(0.12)
  .room(0.16);

const ride = s("~ oh ~ oh ~ oh ~ oh")
  .bank("RolandTR909")
  .gain(0.11)
  .hpf(5200)
  .lpf(saw.range(6500, 13500).slow(16))
  .room(0.2)
  .pan(perlin.range(-0.2, 0.2).slow(5));

const bass = note("a1*8")
  .s("saw")
  .gain(0.36)
  .attack(0.004)
  .decay(0.16)
  .sustain(0.18)
  .release(0.045)
  .lpf(perlin.range(95, 520).slow(8))
  .lpq(13)
  .shape(0.18)
  .orbit(1);

const bassBuild = note("a1*8")
  .s("saw")
  .gain(0.38)
  .attack(0.004)
  .decay(0.15)
  .sustain(0.16)
  .release(0.04)
  .lpf(saw.range(110, 1450).slow(16))
  .lpq(15)
  .shape(0.22)
  .orbit(1);

const sub = note("a0 a0 a0 [a0 a0]")
  .s("sine")
  .fm(1)
  .gain(0.18)
  .attack(0.006)
  .decay(0.22)
  .sustain(0.12)
  .release(0.06)
  .lpf(90)
  .orbit(1);

const stab = chord("<Am Am Am Em>")
  .voicing()
  .s("supersaw")
  .struct("~ ~ x [~ x]")
  .gain(0.22)
  .attack(0.006)
  .decay(0.14)
  .sustain(0)
  .release(0.075)
  .lpf(perlin.range(550, 1800).slow(6))
  .lpq(9)
  .detune(0.18)
  .room(0.22)
  .delay(0.12)
  .delaytime(0.19)
  .delayfeedback(0.22)
  .orbit(1);

const stabBuild = chord("<Am Am Am Em>")
  .voicing()
  .s("supersaw")
  .struct("~ ~ x [~ x]")
  .gain(0.25)
  .attack(0.006)
  .decay(0.13)
  .sustain(0)
  .release(0.07)
  .lpf(saw.range(650, 5200).slow(16))
  .lpq(10)
  .detune(0.22)
  .room(0.18)
  .delay(0.13)
  .delaytime(0.18)
  .delayfeedback(0.24)
  .orbit(1);

const acidThread = chord("<Am Am G Em>")
  .voicing()
  .arp("0 1 2 1")
  .fast(2)
  .s("square")
  .fm(3)
  .gain(0.12)
  .attack(0.002)
  .decay(0.075)
  .sustain(0.05)
  .release(0.035)
  .lpf(sine.range(420, 2200).slow(16))
  .lpq(18)
  .pan(sine.range(-0.16, 0.16).slow(8))
  .orbit(1);

const padTail = chord("<Am Am F Em>")
  .voicing()
  .s("gm_pad_warm")
  .gain(0.22)
  .attack(0.5)
  .decay(1.2)
  .sustain(0.7)
  .release(2.6)
  .lpf(sine.range(650, 2800).slow(12))
  .room(0.82)
  .roomsize(0.9)
  .delay(0.32)
  .delaytime(0.5)
  .delayfeedback(0.42)
  .orbit(1);

const noiseRise = s("white")
  .struct("x*16")
  .gain(0.032)
  .attack(0.002)
  .decay(0.06)
  .sustain(0.02)
  .release(0.04)
  .hpf(2600)
  .lpf(saw.range(3200, 14500).slow(8))
  .room(0.38)
  .pan(perlin.range(-0.45, 0.45).slow(3))
  .orbit(1);

const intro = stack(
  kick,
  hatOff,
  hat16.gain(0.03)
);

const drop = stack(
  kick,
  hatOff,
  hat16,
  clap,
  bass,
  sub,
  stab
);

const build = stack(
  kick,
  hatOff,
  hat16,
  clap,
  ride,
  bassBuild,
  sub,
  stabBuild,
  acidThread,
  noiseRise.gain(0.022)
);

const peak = stack(
  kick,
  hatOff,
  hat16.gain(0.07),
  clap,
  ride.gain(0.15),
  rim,
  tomPerc,
  bassBuild,
  sub,
  stabBuild,
  acidThread.gain(0.15),
  noiseRise.gain(0.026)
);

const breakdown = stack(
  padTail,
  stabBuild.gain(0.18).room(0.72).delayfeedback(0.55),
  noiseRise.gain(0.018),
  s("~ hh ~ ~ ~ hh ~ ~")
    .bank("RolandTR909")
    .gain(0.07)
    .hpf(7000)
    .lpf(11000)
    .room(0.45)
);

const reentry = stack(
  kick,
  hatOff,
  hat16.gain(0.075),
  clap,
  ride.gain(0.16),
  rim.gain(0.24),
  tomPerc,
  bassBuild,
  sub,
  stabBuild,
  acidThread.gain(0.16),
  noiseRise.gain(0.02)
);

arrange(
  [8, intro],
  [16, drop],
  [16, build],
  [8, peak],
  [8, breakdown],
  [16, reentry]
)
