setcpm(145/4);

const kick = s("bd*4")
  .bank("RolandTR909")
  .decay(.35)
  .shape(.38)
  .clip(.92)
  .gain(.92)
  .duckorbit(1)
  .duckattack(.01)
  .duckdepth(.88);

const bass = note("<[~ e2 e2 e2 ~ e2 e2 e2 ~ e2 e2 e2 ~ d2 e2 g2] [~ e2 e2 e2 ~ e2 e2 g2 ~ e2 e2 e2 ~ b1 d2 e2] [~ e2 e2 e2 ~ g2 e2 e2 ~ e2 e2 d2 ~ e2 g2 e2] [~ e2 e2 e2 ~ e2 e2 e2 ~ g2 e2 d2 ~ b1 d2 e2]>")
  .s("sawtooth")
  .attack(.002)
  .decay(.075)
  .sustain(.12)
  .release(.025)
  .lpf(sine.range(360, 820).slow(8))
  .lpq(.28)
  .shape(.22)
  .clip(.86)
  .gain(.58)
  .orbit(1);

const hats = stack(
  s("hh*16").bank("RolandTR909").gain(.11).hpf(6500).pan(sine.range(.42, .58).slow(2)),
  s("oh").struct("~ x ~ x").bank("RolandTR909").gain(.13).hpf(5200).decay(.22).pan(.62),
  s("cp").struct("~ ~ x ~").bank("RolandTR808").gain(.18).hpf(1200).room(.18).pan(.48),
  s("rim").struct("[~ x] ~ [x ~] ~").bank("RolandTR707").gain(.08).hpf(1800).delay(.12).delaytime(.125).delayfeedback(.22).pan(sine.range(.25, .75).slow(3)),
  s("lt mt ht mt").bank("RolandTR707").struct("~ ~ ~ [x x x x]").mask("<0 0 0 1>").gain(.15).hpf(240).room(.18)
).orbit(1);

const pad = chord("<Em7 Cmaj7 D7 Bm7>").voicing()
  .s("gm_pad_warm")
  .attack(1.6)
  .decay(.3)
  .sustain(.7)
  .release(3)
  .gain(.18)
  .lpf(perlin.range(650, 2400).slow(8))
  .room(.62)
  .roomsize(.86)
  .delay(.16)
  .delaytime(.5)
  .delayfeedback(.34)
  .pan(sine.range(.24, .76).slow(6))
  .orbit(1);

const acid = n("<[0 2 3 4 7 4 3 2]*2 [0 3 5 7 10 7 5 3]*2 [7 10 12 10 7 5 3 2]*2 [3 5 7 10 12 10 7 5]*2>")
  .scale("E:minor")
  .s("square")
  .fm(3)
  .attack(.004)
  .decay(.11)
  .sustain(.06)
  .release(.035)
  .lpf(sine.range(700, 5200).slow(4))
  .lpq(sine.range(.35, .9).slow(5))
  .crush(6)
  .shape(.18)
  .delay(.22)
  .delaytime(.1875)
  .delayfeedback(.43)
  .pan(sine.range(.15, .85).slow(3))
  .gain(.24)
  .every(4, x => x.off(.0625, y => y.add(12).gain(.09)))
  .jux(rev)
  .orbit(1);

const squelch = n("<[~ 0 ~ 12] [~ 7 10 ~] [~ 3 ~ 15] [~ 12 10 7]>")
  .scale("E:minor")
  .s("saw")
  .fm(6)
  .attack(.006)
  .decay(.16)
  .sustain(.04)
  .release(.05)
  .lpf(perlin.range(900, 6800).slow(3))
  .lpq(.74)
  .hpf(260)
  .delay(.18)
  .delaytime(.25)
  .delayfeedback(.35)
  .gain(.17)
  .mask("<0 1 0 1>")
  .orbit(1);

const shimmer = chord("<Em7 Gmaj7 D7 Cmaj7>").voicing()
  .arp("0 1 2 3 2 1 0 2")
  .fast(2)
  .add(12)
  .s("sine")
  .fm(2)
  .attack(.01)
  .decay(.18)
  .sustain(.12)
  .release(.22)
  .lpf(sine.range(1600, 7600).slow(5))
  .room(.55)
  .roomsize(.9)
  .delay(.24)
  .delaytime(.375)
  .delayfeedback(.45)
  .gain(.16)
  .pan(sine.range(.18, .82).slow(4))
  .orbit(1);

const fxWash = stack(
  s("white").struct("x ~ ~ ~").slow(4).attack(.08).decay(2.6).sustain(.25).release(2).hpf(900).lpf(saw.range(900, 9000).slow(8)).gain(.13).room(.74).roomsize(.9).pan(sine.range(.1, .9).slow(5)),
  s("pink").struct("~ ~ x ~").slow(8).attack(1.8).decay(5).sustain(.35).release(2.5).hpf(320).lpf(perlin.range(1200, 6400).slow(10)).gain(.1).delay(.2).delaytime(.75).delayfeedback(.5).pan(rand.range(.2, .8).slow(4)),
  n("<[12 ~ 14 ~ 15 ~ 19 ~]*2 [19 ~ 17 ~ 15 ~ 14 ~]*2>").scale("E:minor").s("triangle").fm(5).attack(.02).decay(.22).sustain(.05).release(.18).lpf(sine.range(1200, 7200).slow(6)).delay(.28).delaytime(.125).delayfeedback(.6).gain(.08).mask("<0 0 1 1>").pan(sine.range(.3, .7).slow(2))
).orbit(1);

const intro = stack(
  kick,
  bass.lpf(430),
  hats.mask("<0 0 1 1>"),
  pad,
  fxWash
);

const dropA = stack(
  kick,
  bass,
  hats,
  pad,
  acid.mask("<0 1 1 1>"),
  fxWash
);

const breakSection = stack(
  kick.mask("<1 0 0 0>"),
  bass.mask("<1 0 0 0>").lpf(320),
  pad,
  shimmer,
  fxWash,
  acid.mask("<0 1 0 1>").lpf(sine.range(500, 1800).slow(8))
);

const dropB = stack(
  kick,
  bass,
  hats,
  pad,
  acid,
  squelch,
  shimmer.mask("<0 1 1 1>"),
  fxWash
);

const outro = stack(
  kick.mask("<1 1 0 0>"),
  bass.mask("<1 1 0 0>").lpf(360),
  hats.mask("<1 0 1 0>"),
  pad,
  fxWash,
  shimmer.mask("<1 0 0 0>")
);

arrange(
  [8, intro],
  [16, dropA],
  [8, breakSection],
  [16, dropB],
  [8, outro]
);
