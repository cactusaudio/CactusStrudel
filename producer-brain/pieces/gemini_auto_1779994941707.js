setcpm(130/4);

const kick = s("<bd ~ ~ [~ bd] ~ ~ bd ~ bd ~ ~ [~ bd] ~ bd ~ ~>")
  .bank("RolandTR909")
  .gain(0.95)
  .shape(0.25)
  .lpf(1200)
  .duckorbit(1)
  .duckattack(0.03)
  .duckdepth(0.9);

const snare = s("<~ ~ sd ~ ~ ~ sd ~ ~ ~ sd ~ ~ [sd ~] sd ~>")
  .bank("RolandTR909")
  .gain(0.72)
  .room(0.55)
  .roomsize(0.85)
  .lpf(5200)
  .hpf(180);

const hats = stack(
  s("[~ hh] hh [~ hh] [hh ~] ~ [hh hh] [~ hh] hh")
    .bank("RolandTR808")
    .gain(0.24)
    .hpf(5500)
    .pan(rand.range(0.25,0.75))
    .delay(0.18)
    .delaytime(0.125)
    .delayfeedback(0.22),
  s("~ ~ oh ~ ~ [~ oh] ~ ~")
    .bank("RolandTR808")
    .gain(0.16)
    .hpf(4200)
    .room(0.45)
    .roomsize(0.75)
);

const perc = stack(
  s("~ rim ~ [~ rim] ~ ~ rim ~")
    .bank("RolandTR707")
    .gain(0.24)
    .hpf(1200)
    .delay(0.28)
    .delaytime(0.375)
    .delayfeedback(0.35)
    .pan(0.68),
  s("cp ~ ~ ~ ~ cp ~ [~ cp]")
    .bank("AlesisHR16")
    .gain(0.13)
    .room(0.8)
    .roomsize(0.9)
    .hpf(900)
    .pan(0.32)
);

const sub = note("<ab1 ~ eb2 ~ gb1 ~ db2 ~>")
  .s("sine")
  .gain(0.72)
  .attack(0.01)
  .decay(0.28)
  .sustain(0.5)
  .release(0.18)
  .lpf(95)
  .orbit(1);

const bassGrain = note("<ab2 [~ ab2] eb2 ~ gb2 ~ [db2 ~] ~>")
  .s("triangle")
  .fm(2)
  .gain(0.18)
  .attack(0.005)
  .decay(0.12)
  .sustain(0.15)
  .release(0.08)
  .lpf(perlin.range(180,520).slow(6))
  .pan(0.45)
  .orbit(1);

const pad = chord("<Abm9 Gbmaj7 Emaj7 Dbm9>")
  .voicing()
  .s("gm_pad_warm")
  .gain(0.34)
  .attack(1.2)
  .decay(0.4)
  .sustain(0.75)
  .release(2.6)
  .lpf(sine.range(650,2300).slow(8))
  .lpq(0.22)
  .room(0.85)
  .roomsize(0.95)
  .pan(perlin.range(0.25,0.75).slow(10))
  .orbit(1);

const chordMist = chord("<Abm9 Gbmaj7 Emaj7 Dbm9>")
  .voicing()
  .arp("0 2 1 3 2 1")
  .s("piano")
  .gain(0.18)
  .attack(0.01)
  .decay(0.2)
  .sustain(0.12)
  .release(0.9)
  .lpf(1800)
  .room(0.75)
  .roomsize(0.88)
  .delay(0.38)
  .delaytime(0.25)
  .delayfeedback(0.48)
  .pan(sine.range(0.15,0.85).slow(5))
  .orbit(1);

const chops = n("<0 ~ 2 [4 2] ~ 6 4 ~ 7 ~ 6 [4 ~] 2 ~ 0 ~>")
  .scale("ab:minor")
  .add(12)
  .s("gm_flute")
  .gain(0.22)
  .attack(0.005)
  .decay(0.09)
  .sustain(0.05)
  .release(0.24)
  .lpf(sine.range(950,3100).slow(3))
  .hpf(420)
  .room(0.9)
  .roomsize(0.95)
  .delay(0.48)
  .delaytime(0.375)
  .delayfeedback(0.62)
  .pan(rand.range(0.18,0.82))
  .orbit(1);

const ghostLead = n("<~ 7 ~ 6 4 ~ 2 ~ 0 ~ [2 4] ~ 6 ~ 7 ~>")
  .scale("ab:minor")
  .add(24)
  .s("sine")
  .fm(3)
  .gain(0.12)
  .attack(0.02)
  .decay(0.18)
  .sustain(0.1)
  .release(0.65)
  .vib(0.12)
  .lpf(2400)
  .room(0.82)
  .roomsize(0.96)
  .delay(0.42)
  .delaytime(0.5)
  .delayfeedback(0.55)
  .pan(perlin.range(0.2,0.8).slow(4))
  .orbit(1);

const noiseFog = s("pink")
  .struct("x ~ ~ ~ ~ ~ ~ ~")
  .gain(0.06)
  .attack(0.6)
  .decay(1.8)
  .sustain(0.2)
  .release(2.8)
  .hpf(2400)
  .lpf(perlin.range(3300,7200).slow(12))
  .room(0.92)
  .roomsize(0.98)
  .pan(perlin.range(0.1,0.9).slow(9))
  .orbit(1);

const intro = stack(
  pad,
  chordMist.mask("<1 0 1 0>"),
  chops.mask("<0 1 0 1>"),
  noiseFog,
  hats.gain(0.14)
);

const drop = stack(
  kick,
  snare,
  hats,
  perc,
  sub,
  bassGrain,
  pad,
  chordMist,
  chops,
  ghostLead.mask("<0 1 1 0>"),
  noiseFog
);

const breakdown = stack(
  pad.gain(0.42),
  chordMist.slow(2),
  chops.mask("<1 0 1 1>").slow(1),
  ghostLead,
  noiseFog.gain(0.09),
  s("~ ~ sd ~ ~ ~ ~ ~")
    .bank("RolandTR909")
    .gain(0.28)
    .room(0.9)
    .roomsize(0.95)
    .hpf(220)
);

const finalDrop = stack(
  kick,
  snare.gain(0.82),
  hats,
  perc.every(4, x => x.jux(rev)),
  sub,
  bassGrain.superimpose(x => x.add(12).gain(0.08).lpf(900)),
  pad,
  chordMist.every(4, x => x.palindrome()),
  chops.superimpose(x => x.add(7).gain(0.12)),
  ghostLead,
  noiseFog
);

arrange(
  [8, intro],
  [16, drop],
  [8, breakdown],
  [16, finalDrop]
);
