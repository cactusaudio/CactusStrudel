setcpm(136/4);

const harmony = chord("<Fm9 Dbmaj7 Eb7 Cm7>").voicing();

const kick = s("bd*4")
  .bank("RolandTR909")
  .decay(0.22)
  .gain(0.95)
  .shape(0.45)
  .duckorbit(1)
  .duckattack(0.04)
  .duckdepth(0.65);

const kickSparse = s("bd ~ bd ~")
  .bank("RolandTR909")
  .decay(0.24)
  .gain(0.9)
  .shape(0.35)
  .duckorbit(1)
  .duckattack(0.05)
  .duckdepth(0.55);

const rumble = note("f1*4")
  .s("sine")
  .attack(0.001)
  .decay(0.5)
  .sustain(0)
  .release(0.03)
  .gain(0.32)
  .lpf(85)
  .orbit(1);

const sub = n("0 ~ 0 -1 [0 3] ~ -1 0")
  .scale("f:minor")
  .s("sine")
  .attack(0.002)
  .decay(0.18)
  .sustain(0.15)
  .release(0.04)
  .gain(0.36)
  .lpf(120)
  .orbit(1);

const acid = n("0 [0 3] 0 -1 0 [5 3] -1 [0 7]")
  .scale("f:phrygian")
  .s("square")
  .fm(3)
  .attack(0.003)
  .decay(0.12)
  .sustain(0.1)
  .release(0.03)
  .lpf(perlin.range(500, 3200).slow(8))
  .lpq(0.6)
  .gain(0.28)
  .pan(sine.range(-0.2, 0.2).slow(4))
  .orbit(1);

const hatsClosed = s("hh*16")
  .bank("RolandTR909")
  .decay(0.03)
  .gain("<0.13 0.08 0.11 0.08>")
  .hpf(6500)
  .pan(rand.range(-0.3, 0.3));

const openHat = s("~ oh ~ oh")
  .bank("RolandTR909")
  .decay(0.18)
  .gain(0.18)
  .hpf(5200)
  .delay(0.08)
  .delaytime(0.25)
  .delayfeedback(0.22);

const clap = stack(
  s("~ cp ~ cp").bank("LinnDrum").gain(0.26).hpf(900).room(0.22),
  s("~ sd ~ sd").bank("RolandTR909").gain(0.14).hpf(700).delay(0.06).delaytime(0.125).delayfeedback(0.18)
);

const perc = s("~ rim [rim ~] ~ rim ~ [rim rim] ~")
  .bank("RolandTR707")
  .gain(0.15)
  .hpf(1200)
  .pan(rand.range(-0.6, 0.6))
  .delay(0.16)
  .delaytime(0.1875)
  .delayfeedback(0.32);

const pad = harmony
  .s("gm_pad_warm")
  .slow(2)
  .attack(0.35)
  .release(1.4)
  .gain(0.26)
  .lpf(sine.range(600, 2400).slow(12))
  .room(0.45)
  .roomsize(0.75)
  .orbit(1);

const stab = harmony
  .arp("0 2 3 1 2 0")
  .fast(2)
  .struct("[x ~] ~ ~ [x x] ~ x ~ [~ x]")
  .s("sawtooth")
  .attack(0.005)
  .decay(0.16)
  .sustain(0.05)
  .release(0.05)
  .gain(0.32)
  .lpf(sine.range(900, 4700).slow(6))
  .lpq(0.25)
  .pan(-0.15)
  .off(0.125, x => x.add(12).gain(0.18).pan(0.55))
  .delay(0.14)
  .delaytime(0.25)
  .delayfeedback(0.28)
  .orbit(1);

const lead = n("~ 12 10 7 [5 7] 3 ~ [0 1]")
  .scale("f:phrygian")
  .s("triangle")
  .fm(5)
  .attack(0.01)
  .decay(0.2)
  .sustain(0.1)
  .release(0.08)
  .gain(0.22)
  .lpf(sine.range(900, 5200).slow(6))
  .delay(0.22)
  .delaytime(0.375)
  .delayfeedback(0.35)
  .room(0.25)
  .orbit(1);

const noise = s("white*16")
  .attack(0.001)
  .decay(0.02)
  .gain(sine.range(0.03, 0.11).slow(8))
  .hpf(saw.range(900, 9000).slow(16))
  .pan(rand.range(-0.8, 0.8))
  .room(0.15);

const intro = stack(
  kick,
  sub.mask("<1 0 1 0>"),
  pad.gain(0.18),
  hatsClosed.gain(0.45)
);

const build = stack(
  kick,
  rumble,
  hatsClosed,
  openHat,
  clap,
  acid,
  pad,
  noise.gain(0.7)
);

const breakSection = stack(
  pad.gain(0.42).lpf(sine.range(600, 3000).slow(8)),
  lead.gain(0.28),
  noise.gain(0.35).hpf(5000),
  perc.gain(0.7)
);

const drop = stack(
  kick,
  rumble,
  sub,
  hatsClosed,
  openHat,
  clap,
  perc,
  acid,
  stab,
  lead.mask("<0 1 1 1>"),
  noise.gain(0.45)
);

const outro = stack(
  kickSparse,
  hatsClosed.gain(0.4),
  pad.gain(0.25),
  acid.gain(0.16)
);

arrange(
  [8, intro],
  [16, build],
  [8, breakSection],
  [24, drop],
  [8, outro]
).room(0.08).clip(0.9)
