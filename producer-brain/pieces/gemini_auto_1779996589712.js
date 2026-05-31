setcpm(130/4);

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(1.08)
  .shape(0.18)
  .lpf(125)
  .duckorbit(1)
  .duckattack(0.035)
  .duckdepth(0.82);

const offhat = s("~ hh ~ hh")
  .bank("RolandTR909")
  .gain(0.42)
  .hpf(6500)
  .room(0.14)
  .pan(0.12);

const hat16 = s("hh*16")
  .bank("RolandTR909")
  .gain("[0.13 0.055 0.095 0.04]*4")
  .hpf(7800)
  .room(0.08)
  .pan(sine.range(-0.28, 0.28).slow(4));

const openhat = s("~ oh ~ oh")
  .bank("RolandTR909")
  .gain(0.3)
  .hpf(5200)
  .decay(0.18)
  .room(0.22);

const clap = s("~ cp ~ cp")
  .bank("RolandTR909")
  .gain(0.48)
  .hpf(1100)
  .room(0.28)
  .delay(0.08)
  .delaytime(0.125)
  .delayfeedback(0.18);

const perc = s("<rim ~ rim [rim rim] lt ~ mt ~>*2")
  .bank("RolandTR707")
  .gain(0.22)
  .hpf(900)
  .pan(saw.range(-0.45, 0.45).slow(8))
  .room(0.18);

const toms = s("<~ ~ lt ~ ~ mt ~ ht>*2")
  .bank("RolandTR909")
  .gain(0.26)
  .lpf(950)
  .room(0.22)
  .mask("<0 1 0 1>");

const drumsFull = stack(kick, offhat, openhat, hat16, clap, perc, toms);

const rumble = note("a1 [~ a1] a1 [a1 ~]")
  .s("sine")
  .fm(1.75)
  .attack(0.005)
  .decay(0.28)
  .sustain(0.15)
  .release(0.08)
  .lpf(sine.range(75, 165).slow(8))
  .gain(0.42)
  .shape(0.24)
  .delay(0.16)
  .delaytime(0.25)
  .delayfeedback(0.34)
  .orbit(1);

const bass = n("[0 0] ~ 0 [3 0] 5 ~ [0 0] 7")
  .scale("A:minor")
  .sub(24)
  .s("sawtooth")
  .attack(0.004)
  .decay(0.16)
  .sustain(0.22)
  .release(0.04)
  .lpf(perlin.range(140, 720).slow(6))
  .lpq(0.36)
  .gain(0.34)
  .clip(0.72)
  .orbit(1);

const stabNotes = chord("<Am9 Am9 Fmaj7 Em7>").voicing()
  .struct("<x ~ [x ~] ~ x ~ [x x] ~>");

const stabs = stabNotes
  .s("supersaw")
  .attack(0.006)
  .decay(0.13)
  .sustain(0.05)
  .release(0.1)
  .lpf(perlin.range(650, 3200).slow(8))
  .lpq(0.18)
  .gain("<0.34 0.42 0.31 0.38>")
  .detune(0.18)
  .room(0.24)
  .delay(0.19)
  .delaytime(0.1875)
  .delayfeedback(0.24)
  .orbit(1);

const stabEcho = stabNotes
  .off(0.375, x => x.add(12))
  .s("triangle")
  .attack(0.003)
  .decay(0.08)
  .sustain(0.02)
  .release(0.08)
  .lpf(1850)
  .gain(0.16)
  .pan(0.55)
  .delay(0.28)
  .delaytime(0.25)
  .delayfeedback(0.32)
  .orbit(1);

const acid = n("<0 3 0 5 7 0 10 7 5 3 2 0 3 5 0 2>*2")
  .scale("A:minor")
  .sub(12)
  .s("saw")
  .attack(0.002)
  .decay(0.07)
  .sustain(0.12)
  .release(0.035)
  .lpf(perlin.range(420, 3100).slow(8))
  .lpq(0.72)
  .gain(0.17)
  .pan(tri.range(-0.22, 0.22).slow(5))
  .delay(0.15)
  .delaytime(0.125)
  .delayfeedback(0.3)
  .orbit(1);

const arp = chord("<Am7 Am7 Fmaj7 Em7>").voicing()
  .arp("0 2 1 3")
  .fast(2)
  .s("square")
  .fm(3)
  .attack(0.002)
  .decay(0.055)
  .sustain(0.05)
  .release(0.05)
  .lpf(sine.range(900, 3600).slow(6))
  .gain(0.105)
  .pan(sine.range(-0.62, 0.62).slow(3))
  .room(0.18)
  .orbit(1);

const leadNotes = n("<~ 0 ~ 2 3 ~ 5 7 10 7 5 3 2 0 ~ 0>*2")
  .scale("A:minor")
  .add(12);

const lead = leadNotes
  .s("square")
  .fm(4)
  .attack(0.004)
  .decay(0.09)
  .sustain(0.1)
  .release(0.08)
  .lpf(saw.range(1200, 5200).slow(4))
  .gain(0.13)
  .delay(0.22)
  .delaytime(0.1875)
  .delayfeedback(0.38)
  .room(0.2)
  .orbit(1);

const leadHigh = leadNotes
  .add(12)
  .s("sine")
  .fm(7)
  .attack(0.002)
  .decay(0.055)
  .sustain(0.04)
  .release(0.06)
  .lpf(4200)
  .gain(0.09)
  .pan(-0.48)
  .delay(0.26)
  .delaytime(0.125)
  .delayfeedback(0.42)
  .orbit(1);

const drone = note("<[a2,e3,a3,c4] [a2,e3,a3,c4] [f2,c3,a3,c4] [e2,b2,g3,d4]>")
  .s("gm_pad_warm")
  .attack(0.4)
  .decay(0.4)
  .sustain(0.7)
  .release(1.1)
  .lpf(sine.range(520, 1650).slow(16))
  .gain(0.13)
  .room(0.42)
  .roomsize(0.78)
  .orbit(1);

const noisePulse = s("white*16")
  .gain(0.032)
  .hpf(7600)
  .lpf(sine.range(8200, 12500).slow(5))
  .decay(0.025)
  .pan(rand.range(-0.7, 0.7))
  .room(0.08)
  .orbit(1);

const wash = s("pink*4")
  .gain(sine.range(0.012, 0.052).slow(16))
  .hpf(450)
  .lpf(perlin.range(1800, 7600).slow(12))
  .attack(0.02)
  .release(0.22)
  .room(0.35)
  .delay(0.11)
  .delaytime(0.375)
  .delayfeedback(0.26)
  .orbit(1);

const intro = stack(
  kick,
  offhat,
  clap.mask("<0 0 1 1>"),
  rumble,
  drone.gain(0.08),
  stabs.mask("<0 0 1 1>"),
  acid.mask("<0 1 0 1>"),
  noisePulse.mask("<0 0 1 1>")
);

const drive = stack(
  drumsFull,
  rumble,
  bass,
  stabs,
  stabEcho,
  acid,
  arp.mask("<0 1 1 1>"),
  noisePulse
);

const dropout = stack(
  kick.mask("<1 0 0 0>"),
  offhat.mask("<0 1 0 1>"),
  clap.mask("<0 0 1 0>"),
  drone.gain(0.16),
  stabs.mask("<1 1 0 1>"),
  stabEcho.mask("<0 1 1 0>"),
  acid.mask("<0 0 1 1>"),
  wash
);

const peak = stack(
  drumsFull,
  rumble,
  bass,
  stabs,
  stabEcho,
  acid,
  arp,
  lead,
  drone.gain(0.075),
  noisePulse,
  wash
);

arrange(
  [8, intro],
  [16, drive],
  [8, dropout],
  [16, peak],
  [8, stack(peak, leadHigh, toms.gain(0.34))]
);
