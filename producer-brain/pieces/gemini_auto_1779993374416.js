setcpm(122/4);

const prog = chord("<Fm9 Dbmaj7 Abmaj7 Eb9>");

const kick = s("bd bd bd bd")
  .bank("RolandTR909")
  .gain(.76)
  .decay(.42)
  .lpf(950)
  .room(.06)
  .duckorbit(1)
  .duckattack(.025)
  .duckdepth(.58);

const hats = stack(
  s("[~ hh]*4")
    .bank("RolandTR909")
    .gain(.18)
    .decay(.045)
    .hpf(6500)
    .pan(.18)
    .delay(.035)
    .delaytime(.125)
    .delayfeedback(.16),
  s("~ [hh hh] ~ [hh ~]")
    .bank("RolandTR707")
    .gain(.075)
    .decay(.035)
    .hpf(7600)
    .pan(-.26)
    .delay(.025)
    .delaytime(.1875)
    .delayfeedback(.12)
);

const clap = stack(
  s("~ cp ~ cp")
    .bank("RolandTR909")
    .gain(.24)
    .decay(.18)
    .hpf(1200)
    .room(.32)
    .pan(-.04),
  s("~ sd ~ sd")
    .bank("LinnDrum")
    .gain(.08)
    .decay(.12)
    .hpf(900)
    .room(.24)
    .pan(.08)
);

const perc = stack(
  s("~ rim ~ [rim ~]")
    .bank("RolandTR808")
    .gain(.09)
    .decay(.08)
    .hpf(2500)
    .pan(-.35)
    .mask("<1 0 1 1>"),
  s("~ ~ [lt ~] ~")
    .bank("AlesisHR16")
    .gain(.07)
    .decay(.16)
    .hpf(500)
    .lpf(2400)
    .pan(.34)
    .mask("<0 1 1 0>")
);

const rhodes = prog
  .voicing()
  .struct("x ~ [~ x] ~")
  .s("gm_epiano1")
  .attack(.018)
  .decay(.32)
  .sustain(.48)
  .release(.85)
  .lpf(perlin.range(1850, 3350).slow(12))
  .lpq(.22)
  .gain(.49)
  .room(.42)
  .delay(.18)
  .delaytime(.375)
  .delayfeedback(.34)
  .pan(sine.range(-.16, .16).slow(8))
  .orbit(1);

const pad = prog
  .slow(2)
  .voicing()
  .s("gm_pad_warm")
  .attack(.8)
  .decay(.6)
  .sustain(.55)
  .release(2.2)
  .lpf(sine.range(900, 1800).slow(16))
  .gain(.23)
  .room(.72)
  .roomsize(.85)
  .pan(tri.range(-.28, .28).slow(10))
  .orbit(1);

const bassline = note("<[f1 ~ f1 c2] [db1 ~ db1 eb1] [ab0 ~ ab0 c1] [eb1 ~ eb1 bb0]>")
  .s("gm_synth_bass_1")
  .attack(.025)
  .decay(.18)
  .sustain(.36)
  .release(.22)
  .lpf(620)
  .lpq(.18)
  .detune(sine.range(-3, 3).slow(8))
  .gain(.44)
  .orbit(1);

const sub = note("<f1 db1 ab0 eb1>")
  .struct("x ~ ~ ~")
  .s("sine")
  .fm(1)
  .attack(.02)
  .release(.18)
  .lpf(180)
  .gain(.26)
  .orbit(1);

const bass = stack(bassline, sub);

const arp = prog
  .voicing()
  .arp("0 1 2 1 2 1 0 1")
  .fast(2)
  .s("sine")
  .fm(3)
  .attack(.01)
  .decay(.12)
  .sustain(.14)
  .release(.24)
  .lpf(sine.range(1300, 3100).slow(6))
  .gain(.145)
  .delay(.22)
  .delaytime(.1875)
  .delayfeedback(.43)
  .pan(sine.range(-.45, .45).slow(5))
  .orbit(1);

const lead = n("<[~ 2 3 4] [~ 5 4 2] [~ 7 5 4] [3 ~ 2 0]>")
  .scale("F:minor")
  .add(12)
  .s("gm_flute")
  .attack(.04)
  .decay(.22)
  .sustain(.3)
  .release(.55)
  .lpf(2600)
  .vib(.12)
  .gain(.16)
  .room(.48)
  .delay(.16)
  .delaytime(.25)
  .delayfeedback(.28)
  .pan(.22)
  .orbit(1);

const intro = stack(
  kick.gain(.48),
  hats.gain(.55),
  rhodes,
  pad.gain(.72)
);

const groove = stack(
  kick,
  hats,
  clap,
  perc,
  rhodes,
  pad,
  bass
);

const lift = stack(
  groove,
  arp.mask("<0 1 1 1>"),
  lead.mask("<0 0 1 0>").gain(.75)
);

const breakbeat = stack(
  hats.gain(.6),
  perc.gain(.7),
  rhodes.gain(.9),
  pad.gain(1),
  arp.mask("<1 1 0 1>").gain(.6),
  lead.mask("<0 1 1 1>")
);

const drop = stack(
  kick,
  hats,
  clap,
  perc,
  rhodes,
  pad,
  bass,
  arp,
  lead.mask("<0 1 0 1>")
);

const outro = stack(
  kick.gain(.42),
  hats.gain(.42),
  rhodes.gain(.8),
  pad.gain(.9),
  bass.gain(.48)
);

arrange(
  [8, intro],
  [8, groove],
  [8, lift],
  [4, breakbeat],
  [12, drop],
  [4, outro]
)
