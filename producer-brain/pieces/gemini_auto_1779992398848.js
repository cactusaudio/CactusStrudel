setcpm(125/4);

const chords = chord("<Am7 Fmaj7 Dm7 E7>");

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(.92)
  .decay(.18)
  .shape(.22)
  .duckorbit(1)
  .duckattack(.02)
  .duckdepth(.62);

const clap = s("~ sd ~ sd")
  .bank("RolandTR909")
  .gain(.42)
  .decay(.12)
  .room(.12);

const offhat = s("~ oh ~ oh")
  .bank("RolandTR909")
  .gain(.24)
  .decay(.08)
  .hpf(5200)
  .pan(.58);

const hats = s("hh*16")
  .bank("RolandTR808")
  .gain(.045)
  .decay(.025)
  .hpf(7000)
  .pan(rand.range(.42, .58))
  .mask("<1 1 0 1>");

const shaker = s("white")
  .struct("[x x]*8")
  .gain(.026)
  .attack(.001)
  .decay(.018)
  .sustain(0)
  .release(.01)
  .hpf(7600)
  .pan(perlin.range(.35, .65).slow(2));

const perc = s("~ rim ~ [rim ~] ~ cp [~ rim] ~")
  .bank("RolandTR707")
  .gain(.12)
  .decay(.055)
  .hpf(1300)
  .room(.14)
  .pan(.28)
  .mask("<1 1 0 1>");

const drums = stack(kick, clap, offhat, hats, shaker, perc);

const bass = n("[0 ~] ~ [0 0] [~ 4] [0 ~] 3 [2 0] ~")
  .scale("A:minor")
  .sub(24)
  .s("gm_synth_bass_1")
  .gain(.74)
  .attack(.003)
  .decay(.13)
  .sustain(0)
  .release(.04)
  .lpf(760)
  .lpq(7)
  .shape(.18)
  .orbit(1);

const pad = chords
  .voicing()
  .s("gm_pad_warm")
  .gain(.14)
  .attack(.55)
  .decay(.4)
  .sustain(.65)
  .release(2)
  .lpf(sine.range(650, 1800).slow(8))
  .room(.45)
  .roomsize(.74)
  .pan(.5)
  .orbit(1);

const stab = chords
  .voicing()
  .s("piano")
  .struct("~ x ~ [~ x] ~ ~ x ~")
  .gain(.18)
  .attack(.004)
  .decay(.16)
  .sustain(0)
  .release(.08)
  .hpf(260)
  .lpf(1800)
  .delay(.12)
  .delaytime(.25)
  .delayfeedback(.28)
  .room(.16)
  .orbit(1);

const arp = chords
  .voicing()
  .arp("0 1 2 1 3 2 1 0")
  .fast(2)
  .s("square")
  .fm(2)
  .gain(.055)
  .attack(.003)
  .decay(.07)
  .sustain(0)
  .release(.04)
  .lpf(1350)
  .delay(.22)
  .delaytime(.375)
  .delayfeedback(.35)
  .pan(.62)
  .orbit(1);

const vocalChop = n("<4 ~ [2 4] ~ 0 ~ [~ 2] ~>")
  .scale("A:minor")
  .add(12)
  .s("sine")
  .fm(4)
  .gain(.075)
  .attack(.004)
  .decay(.055)
  .sustain(0)
  .release(.035)
  .hpf(720)
  .lpf(2850)
  .delay(.2)
  .delaytime(.25)
  .delayfeedback(.32)
  .room(.22)
  .pan(sine.range(.12, .88).slow(2));

const intro = stack(
  kick,
  offhat.mask("<0 1>"),
  shaker,
  pad.gain(.1)
);

const build = stack(
  kick,
  clap,
  offhat,
  shaker,
  perc.mask("<0 1>"),
  bass.mask("<0 1 1 1>"),
  pad,
  vocalChop.mask("<0 0 1 0>")
);

const drop = stack(
  drums,
  bass,
  stab,
  arp.mask("<1 0 1 1>"),
  vocalChop
);

const breakPart = stack(
  shaker.gain(.018),
  hats.gain(.028),
  pad.gain(.2),
  arp.mask("<0 1>"),
  vocalChop.gain(.095)
);

const peak = stack(
  drums,
  bass.every(4, x => x.off(.125, y => y.add(12).gain(.12))),
  stab,
  arp,
  vocalChop.mask("<1 1 0 1>")
);

arrange(
  [4, intro],
  [4, build],
  [8, drop],
  [4, breakPart],
  [8, peak],
  [4, drop]
)
