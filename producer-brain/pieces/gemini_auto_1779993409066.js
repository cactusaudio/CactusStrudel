setcpm(130/4);

const kick = s("bd ~ ~ [~ bd] ~ ~ bd ~ ~ bd ~ ~ ~ ~ [bd ~] ~")
  .bank("RolandTR909")
  .gain(.82)
  .shape(.18)
  .duckorbit(1)
  .duckattack(.035)
  .duckdepth(.58);

const snare = s("~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ ~")
  .bank("RolandTR909")
  .gain(.62)
  .hpf(180)
  .room(.12);

const clap = s("~ ~ ~ ~ cp ~ ~ [~ cp] ~ ~ ~ ~ cp ~ ~ ~")
  .bank("RolandTR707")
  .gain(.32)
  .hpf(900)
  .delay(.12)
  .delaytime(.1875)
  .delayfeedback(.22);

const hats = stack(
  s("hh*8")
    .bank("RolandTR909")
    .gain(.13)
    .hpf(6500)
    .pan(.62),
  s("~ [hh ~] ~ hh ~ [~ hh] hh [~ hh]")
    .bank("RolandTR808")
    .gain(.09)
    .hpf(7600)
    .pan(.38),
  s("~ ~ oh ~ ~ ~ oh ~")
    .bank("RolandTR909")
    .gain(.11)
    .hpf(5200)
    .decay(.18)
    .pan(.72)
);

const perc = s("~ rim ~ [rim ~] ~ cp ~ [~ rim]")
  .bank("LinnDrum")
  .gain(.18)
  .hpf(1200)
  .pan(perlin.range(.25, .75).slow(5))
  .delay(.1)
  .delaytime(.125)
  .delayfeedback(.18);

const air = s("white")
  .struct("~ ~ ~ [x ~]")
  .attack(.001)
  .decay(.055)
  .release(.02)
  .hpf(9000)
  .gain(.035)
  .pan(rand.range(.15, .85));

const drums = stack(kick, snare, clap, hats, perc, air);

const bassNotes = note("g1 ~ [g1 g1] ~ f1 ~ bb1 ~ g1 ~ [d2 c2] ~ f1 ~ [bb1 g1] ~");

const sub = bassNotes
  .s("sine")
  .fm(1.2)
  .attack(.004)
  .decay(.18)
  .sustain(.55)
  .release(.08)
  .lpf(sine.range(85, 360).slow(2))
  .gain(.78)
  .orbit(1);

const wobble = bassNotes
  .add(12)
  .s("saw")
  .attack(.002)
  .decay(.13)
  .sustain(.25)
  .release(.06)
  .lpf(perlin.range(260, 920).slow(3))
  .lpq(.35)
  .gain(.22)
  .shape(.22)
  .orbit(1);

const chords = chord("<Gm9 Ebmaj7 Bbmaj7 F7>");

const pad = chords
  .voicing()
  .s("gm_pad_warm")
  .attack(.18)
  .release(.9)
  .lpf(sine.range(720, 1900).slow(8))
  .gain(.24)
  .room(.35)
  .roomsize(.7)
  .orbit(1);

const arp = chords
  .voicing()
  .arp("0 [1 2] 3 [2 1]")
  .s("gm_epiano1")
  .attack(.006)
  .decay(.16)
  .sustain(.12)
  .release(.08)
  .lpf(2300)
  .gain(.18)
  .delay(.22)
  .delaytime(.1875)
  .delayfeedback(.35)
  .pan(perlin.range(.28, .72).slow(6))
  .orbit(1);

const chop = note("[bb4,d5,g5] ~ [g5,f5,d5] [d5,bb4] [c5,d5] ~ [bb4,c5,g4] ~ [d5,f5]")
  .s("square")
  .fm(5)
  .attack(.002)
  .decay(.085)
  .sustain(0)
  .release(.035)
  .hpf(520)
  .lpf(sine.range(950, 2400).slow(2))
  .crush(8)
  .shape(.24)
  .delay(.18)
  .delaytime(.1875)
  .delayfeedback(.28)
  .gain(.3)
  .pan(perlin.range(.2, .8).slow(4))
  .orbit(1);

const lead = n("~ 4 ~ [5 6] ~ 3 [2 1] ~")
  .scale("g:minor")
  .add(12)
  .s("supersaw")
  .attack(.01)
  .decay(.12)
  .sustain(.18)
  .release(.08)
  .lpf(2800)
  .gain(.13)
  .delay(.14)
  .delaytime(.125)
  .delayfeedback(.25)
  .pan(.58)
  .orbit(1);

const intro = stack(
  hats.gain(.55),
  perc.mask("<0 1 1 0>"),
  pad.gain(.9),
  chop.mask("<1 0 1 0>").gain(.7)
);

const groove = stack(
  drums,
  sub,
  wobble.mask("<1 0 1 1>"),
  pad.gain(.7),
  chop.mask("<1 1 0 1>"),
  arp.mask("<0 1 1 1>")
);

const breakSection = stack(
  snare.mask("<0 0 1 0>").gain(.7),
  hats.gain(.45),
  air.gain(1.4),
  pad.lpf(sine.range(420, 1300).slow(4)),
  chop.mask("<1 0 1 1>").gain(.85),
  arp.mask("<1 0 0 1>").gain(.8)
);

const drop = stack(
  drums,
  sub,
  wobble,
  pad.gain(.65),
  arp,
  chop,
  lead.mask("<0 1 1 1>")
);

const outro = stack(
  kick.mask("<1 0 0 0>"),
  hats.gain(.35),
  pad.gain(.8),
  chop.mask("<0 1 0 0>").gain(.65)
);

arrange([4, intro], [8, groove], [4, breakSection], [16, drop], [4, outro])
