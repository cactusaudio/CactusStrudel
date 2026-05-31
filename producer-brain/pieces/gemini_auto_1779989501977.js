setcpm(132/4);

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(1.15)
  .shape(.65)
  .clip(.9)
  .hpf(25)
  .duckorbit(1)
  .duckattack(.025)
  .duckdepth(.65);

const clap = s("~ cp ~ cp")
  .bank("RolandTR909")
  .gain(.42)
  .hpf(900)
  .room(.25)
  .roomsize(.55);

const offhats = s("~ oh ~ oh ~ oh ~ oh")
  .bank("RolandTR909")
  .gain(.48)
  .hpf(6200)
  .decay(.18)
  .pan(.18)
  .room(.12);

const tickhats = s("hh*16")
  .bank("RolandTR909")
  .gain(.16)
  .hpf(7800)
  .decay(.035)
  .pan(rand.range(-.35, .35))
  .crush(6);

const rim = s("~ rim [~ rim] ~ rim")
  .bank("RolandTR707")
  .gain(.28)
  .hpf(1800)
  .pan(-.25)
  .delay(.12)
  .delaytime(.1875)
  .delayfeedback(.28);

const toms = s("lt ~ mt ~ ht ~ ~ mt")
  .bank("RolandTR808")
  .gain(.22)
  .lpf(900)
  .room(.18)
  .mask("<0 1 1 1>");

const grit = s("pink")
  .struct("x*16")
  .gain(rand.range(.012, .045))
  .hpf(7200)
  .crush(5)
  .shape(.25)
  .pan(rand.range(-.7, .7));

const acidSeq = note("g2 [g2 g3] bb2 g2 c3 [d3 f3] d3 ~ g2 [f3 g3] d3 c3 bb2 [c3 bb2] g2 [~ d3]")
  .every(4, x => x.add(12));

const acidIntro = acidSeq
  .s("sawtooth")
  .fm(1)
  .attack(.003)
  .decay(.09)
  .sustain(0)
  .release(.035)
  .lpf(saw.range(220, 900).slow(8))
  .lpq(sine.range(6, 12).slow(8))
  .gain(.38)
  .shape(.32)
  .crush(7)
  .delay(.12)
  .delaytime(.125)
  .delayfeedback(.28)
  .orbit(1);

const acidBuild = acidSeq
  .s("sawtooth")
  .fm(1.2)
  .attack(.003)
  .decay(.105)
  .sustain(0)
  .release(.04)
  .lpf(saw.range(300, 2600).slow(8))
  .lpq(saw.range(8, 19).slow(16))
  .gain(.52)
  .shape(.48)
  .clip(.82)
  .crush(6)
  .delay(.16)
  .delaytime(.125)
  .delayfeedback(.34)
  .orbit(1);

const acidScream = acidSeq
  .off(.03125, x => x.add(12))
  .s("sawtooth")
  .fm(1.7)
  .attack(.002)
  .decay(.095)
  .sustain(0)
  .release(.03)
  .lpf(saw.range(650, 5200).slow(16))
  .lpq(saw.range(13, 30).slow(16))
  .gain(.54)
  .shape(.72)
  .clip(.78)
  .crush(5)
  .detune(sine.range(-7, 7).slow(5))
  .delay(.22)
  .delaytime(.1875)
  .delayfeedback(.42)
  .orbit(1);

const sub = note("g1 ~ g1 ~ bb1 ~ c2 ~ g1 ~ d2 ~ bb1 ~ c2 d2")
  .s("gm_synth_bass_1")
  .attack(.005)
  .decay(.16)
  .sustain(.22)
  .release(.05)
  .lpf(180)
  .gain(.5)
  .orbit(1);

const stab = chord("<Gm7 Ebmaj7 F7 D7>")
  .voicing()
  .struct("x ~ ~ [~ x]")
  .s("square")
  .fm(2)
  .attack(.004)
  .decay(.12)
  .sustain(0)
  .release(.08)
  .lpf(sine.range(700, 2600).slow(4))
  .lpq(9)
  .gain(.22)
  .shape(.5)
  .pan(sine.range(-.4, .4).slow(4))
  .room(.22)
  .orbit(1);

const pressure = s("white")
  .struct("x@4")
  .attack(.2)
  .decay(.8)
  .sustain(.25)
  .release(2)
  .gain(saw.range(.018, .12).slow(4))
  .hpf(saw.range(2500, 9800).slow(4))
  .room(.35)
  .roomsize(.8)
  .crush(8);

arrange(
  [4, stack(kick, acidIntro, grit)],
  [8, stack(kick, clap, offhats, acidBuild, sub, grit)],
  [8, stack(kick, clap, offhats, tickhats, rim, acidBuild, sub, stab, grit)],
  [4, stack(kick, clap, acidScream, sub, pressure)],
  [8, stack(kick, clap, offhats, tickhats, rim, toms, acidScream, sub, stab, grit)]
)
