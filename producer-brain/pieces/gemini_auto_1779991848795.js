setcpm(145/4);

const kick = s("bd*4").bank("RolandTR909")
  .gain(1.15)
  .shape(0.42)
  .lpf(1150)
  .duckorbit(1)
  .duckattack(0.01)
  .duckdepth(0.78);

const bassNotes = note("<[~ e1 e1 e1]*4 [~ e1 e1 e1 ~ e1 g1 e1 ~ e1 e1 e1 ~ d1 e1 e1] [~ e1 e1 e1 ~ b0 e1 e1 ~ e1 e1 g1 ~ d1 e1 e1] [~ e1 e1 e1 ~ e1 e1 e1 ~ g1 e1 d1 ~ e1 e1 e1]>");

const bass = stack(
  bassNotes.s("sawtooth")
    .attack(0.002)
    .decay(0.075)
    .sustain(0)
    .release(0.018)
    .lpf(sine.range(520, 980).slow(8))
    .lpq(0.38)
    .gain(0.62)
    .orbit(1),
  bassNotes.s("sine")
    .attack(0.001)
    .decay(0.055)
    .sustain(0)
    .release(0.012)
    .lpf(120)
    .gain(0.34)
    .orbit(1)
);

const hats = stack(
  s("hh*16").bank("RolandTR909")
    .gain(0.14)
    .hpf(4800)
    .pan(sine.range(-0.18, 0.18).slow(2)),
  s("oh").bank("RolandTR909")
    .struct("~ x ~ x ~ x ~ x")
    .gain(0.22)
    .hpf(3600)
    .decay(0.08)
    .pan(0.12),
  s("hh").bank("RolandTR707")
    .struct("x ~ x x x ~ x ~ x ~ x x x ~ x ~")
    .gain(0.055)
    .hpf(6500)
    .pan(0.42)
);

const backbeat = stack(
  s("sd").bank("RolandTR909")
    .struct("~ ~ x ~ ~ ~ x ~")
    .gain(0.28)
    .hpf(320)
    .room(0.16),
  s("cp").bank("RolandTR808")
    .struct("~ ~ x ~ ~ ~ x ~")
    .gain(0.16)
    .hpf(1800)
    .room(0.22)
);

const perc = stack(
  s("rim").bank("RolandTR707")
    .struct("x ~ ~ x ~ x ~ ~ x ~ ~ x ~ x ~ ~")
    .gain(0.095)
    .hpf(3100)
    .pan(-0.36),
  s("lt mt ht mt").bank("RolandTR808")
    .struct("~ ~ ~ x ~ ~ x ~ ~ x ~ ~ ~ ~ x ~")
    .gain(0.11)
    .lpf(2100)
    .pan(sine.range(-0.45, 0.45).slow(3))
);

const pad = chord("<Em9 Cmaj7 D Bm7>").voicing()
  .slow(2)
  .s("gm_pad_warm")
  .attack(1.4)
  .sustain(0.8)
  .release(3.2)
  .lpf(sine.range(780, 2850).slow(16))
  .gain(0.22)
  .room(0.72)
  .roomsize(0.88)
  .orbit(1);

const acidNotes = n("<[0 0 7 0 3 0 10 7]*2 [0 12 7 0 5 0 3 7]*2 [0 3 7 12 10 7 3 0]*2 [0 0 5 0 7 10 12 7]*2>")
  .scale("E:minor")
  .add(24);

const acid = acidNotes.s("square")
  .fm(5)
  .attack(0.004)
  .decay(0.095)
  .sustain(0)
  .release(0.024)
  .lpf(saw.range(460, 4400).slow(8))
  .lpq(sine.range(0.28, 0.86).slow(7))
  .shape(0.18)
  .detune(sine.range(-7, 7).slow(5))
  .delay(0.18)
  .delaytime(0.125)
  .delayfeedback(0.36)
  .pan(sine.range(-0.62, 0.62).slow(5))
  .gain(0.24)
  .orbit(1)
  .off(0.125, x => x.add(12).gain(0.075))
  .every(4, x => x.palindrome());

const acidOpen = acid
  .lpf(saw.range(900, 7800).slow(4))
  .lpq(0.9)
  .shape(0.28)
  .gain(0.31);

const acidWide = acid
  .add(7)
  .lpf(sine.range(1200, 6500).slow(6))
  .delayfeedback(0.54)
  .pan(sine.range(0.22, 0.9).slow(4))
  .gain(0.13);

const glassArp = chord("<Em C D Bm>").voicing()
  .arp("[0 1 2 1 2 1 0 2]*2")
  .s("supersaw")
  .attack(0.005)
  .decay(0.13)
  .sustain(0)
  .release(0.05)
  .lpf(sine.range(1600, 5200).slow(8))
  .lpq(0.42)
  .delay(0.28)
  .delaytime(0.1875)
  .delayfeedback(0.44)
  .pan(sine.range(-0.5, 0.5).slow(6))
  .gain(0.125)
  .orbit(1);

const riser = note("e4").s("pink")
  .attack(0.25)
  .sustain(1)
  .release(0.8)
  .lpf(saw.range(300, 12000).slow(16))
  .hpf(saw.range(60, 3600).slow(32))
  .gain(saw.range(0.018, 0.32).slow(32))
  .room(0.88)
  .roomsize(0.95)
  .delay(0.36)
  .delaytime(0.25)
  .delayfeedback(0.62)
  .pan(sine.range(-1, 1).slow(7))
  .orbit(1);

const alien = note("<[~ e6 ~ b5 ~ g6 ~ d6] [~ b6 ~ a6 ~ e6 ~ g6] [~ g7 ~ e7 ~ b6 ~ a6] [~ d7 ~ g6 ~ b6 ~ e7]>")
  .s("sine")
  .fm(9)
  .attack(0.002)
  .decay(0.055)
  .sustain(0)
  .release(0.08)
  .lpf(perlin.range(1200, 9200).slow(3))
  .delay(0.42)
  .delaytime(0.09375)
  .delayfeedback(0.58)
  .pan(rand.range(-0.95, 0.95))
  .gain(0.13)
  .orbit(1);

const drops = note("<e2 ~ ~ ~>").s("brown")
  .attack(0.005)
  .decay(0.55)
  .sustain(0)
  .release(1.1)
  .lpf(240)
  .gain(0.25)
  .room(0.55)
  .orbit(1);

const fullDrive = stack(kick, bass, hats, backbeat, perc);

arrange(
  [8, stack(
    kick,
    bass.mask("<0 1 1 1>"),
    hats,
    pad,
    riser.gain(saw.range(0.01, 0.16).slow(8)),
    alien.mask("<0 0 1 0>")
  )],
  [8, stack(
    kick,
    bass,
    hats,
    backbeat,
    pad,
    acid.mask("<0 1 0 1>"),
    riser,
    alien
  )],
  [16, stack(
    fullDrive,
    pad,
    acid,
    glassArp.mask("<0 1>"),
    riser,
    alien.mask("<0 0 1 1>"),
    drops
  )],
  [8, stack(
    kick,
    bass.mask("<1 1 0 1>"),
    hats,
    backbeat,
    pad,
    glassArp,
    acid.mask("<1 0 1 0>"),
    riser.gain(saw.range(0.05, 0.46).slow(8)),
    alien
  )],
  [16, stack(
    fullDrive,
    pad,
    acidOpen,
    acidWide.mask("<0 1 1 1>"),
    glassArp,
    riser,
    alien,
    drops
  )],
  [8, stack(
    fullDrive,
    acidOpen.every(2, x => x.add(12)),
    acidWide,
    glassArp,
    riser.gain(saw.range(0.09, 0.5).slow(8)),
    alien,
    drops
  )]
)
