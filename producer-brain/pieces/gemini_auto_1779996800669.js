setcpm(140/4);

const kick = s("bd ~ ~ bd ~ ~ bd ~")
  .bank("RolandTR909")
  .gain(1.05)
  .shape(.55)
  .crush(5)
  .lpf(950)
  .duckorbit(0)
  .duckattack(.02)
  .duckdepth(.78);

const kickMut = kick
  .every(4, rev)
  .superimpose(x => x.fast(2).gain(.28).lpf(1300))
  .mask("<1 1 1 0>");

const kickChop = kick
  .every(2, rev)
  .superimpose(x => x.fast(2).gain(.34).lpf(1500))
  .superimpose(x => x.fast(4).gain(.16).hpf(70))
  .mask("<1 1 1 1 0 1 1 1>");

const snare = s("sd")
  .bank("AlesisHR16")
  .struct("~ ~ x ~ x ~ ~ x ~ x ~ ~ x ~ ~ ~")
  .gain(.72)
  .crush(4)
  .shape(.48)
  .room(.23)
  .roomsize(.55)
  .every(4, rev);

const hats = s("hh")
  .bank("RolandTR707")
  .struct("x ~ x ~ x ~ ~ x ~ x ~ x ~ ~ x ~")
  .gain(.38)
  .hpf(5200)
  .crush(6)
  .pan(rand.range(.12, .88))
  .every(3, rev);

const rim = s("rim")
  .bank("LinnDrum")
  .struct("x ~ ~ x ~ x ~ ~ x ~ ~ x")
  .gain(.46)
  .hpf(1800)
  .crush(5)
  .delay(.18)
  .delaytime(.125)
  .delayfeedback(.32)
  .pan(perlin.range(.2, .8).slow(3))
  .every(4, rev);

const toms = s("<lt mt ht mt>")
  .bank("RolandTR808")
  .struct("~ x ~ ~ ~ x ~ x ~ ~ x ~")
  .gain(.42)
  .lpf(760)
  .crush(5)
  .shape(.35)
  .mask("<0 1 1 1>")
  .every(4, rev);

const bass = n("0 ~ [0 0] ~ -2 ~ 3 [5 7]")
  .scale("D:minor")
  .s("square")
  .fm(5)
  .attack(.005)
  .decay(.18)
  .sustain(0)
  .release(.05)
  .lpf(perlin.range(120, 900).slow(8))
  .gain(.7)
  .shape(.42)
  .crush(4)
  .orbit(0);

const bassMut = bass
  .every(4, rev)
  .superimpose(x => x.fast(2).add(12).gain(.24).lpf(1400))
  .mask("<1 1 1 1 0 1 1 1>");

const bassClimb = n("0 [0 3] -2 [3 5] 7 ~ [5 3] -2")
  .scale("D:minor")
  .s("square")
  .fm(8)
  .attack(.003)
  .decay(.14)
  .sustain(0)
  .release(.04)
  .lpf(saw.range(180, 1600).slow(4))
  .gain(.68)
  .crush(3)
  .shape(.62)
  .orbit(0)
  .every(4, rev);

const pad = chord("<Dm9 Fmaj7 Bbmaj7 A7>")
  .voicing()
  .s("gm_pad_warm")
  .attack(.25)
  .decay(.8)
  .sustain(.55)
  .release(1.2)
  .lpf(sine.range(520, 2400).slow(16))
  .gain(.28)
  .room(.7)
  .roomsize(.9)
  .orbit(0)
  .mask("<0 1 1 1>");

const stabs = chord("<Dm9 Fmaj7 Bbmaj7 A7>")
  .voicing()
  .arp("0 2 1 3")
  .s("sawtooth")
  .struct("x ~ ~ [x x] ~ x ~ ~")
  .attack(.003)
  .decay(.11)
  .sustain(0)
  .release(.04)
  .lpf(saw.range(450, 4200).slow(4))
  .crush(5)
  .shape(.72)
  .gain(.36)
  .pan(perlin.range(.2, .8).slow(2))
  .every(4, rev)
  .off(.25, x => x.add(7).gain(.22));

const lead = n("12 [14 15] ~ 19 17 ~ [15 12] 10")
  .scale("D:minor")
  .s("sine")
  .fm(8)
  .attack(.004)
  .decay(.09)
  .sustain(.08)
  .release(.06)
  .delay(.26)
  .delaytime(.1875)
  .delayfeedback(.4)
  .crush(3)
  .gain(.34)
  .pan(perlin.range(.08, .92).slow(5))
  .every(4, rev)
  .jux(rev);

const leadChop = lead
  .fast(2)
  .superimpose(x => x.add(7).gain(.16))
  .mask("<1 0 1 1>");

const noise = note("d2")
  .s("pink")
  .struct("~ ~ ~ x ~ ~ x ~")
  .attack(.006)
  .decay(.2)
  .sustain(0)
  .release(.05)
  .hpf(2100)
  .lpf(perlin.range(2700, 8500).slow(6))
  .gain(.22)
  .pan(rand.range(0, 1))
  .crush(6)
  .every(4, rev);

const intro = kick;

const build1 = stack(
  kickMut,
  bass
);

const build2 = stack(
  kickMut,
  bass,
  snare,
  hats
);

const build3 = stack(
  kickMut,
  bassMut,
  snare,
  hats,
  rim,
  stabs
);

const dense = stack(
  kickChop,
  snare,
  hats,
  rim,
  toms,
  bassMut,
  stabs,
  lead,
  pad,
  noise
);

const strip1 = stack(
  hats.mask("<1 0 1 1>"),
  rim,
  bass.mask("<1 1 0 1>"),
  pad,
  noise.mask("<0 1 0 1>")
);

const strip2 = stack(
  kick.mask("<1 0 0 1>"),
  pad.gain(.34),
  lead.mask("<1 0 0 1>"),
  rim.mask("<0 1 0 0>")
);

const climax = stack(
  kickChop,
  snare.fast(2).gain(.78),
  hats.fast(2).gain(.42),
  rim.fast(2).gain(.46),
  toms,
  bassClimb,
  stabs.fast(2).gain(.44),
  leadChop.fast(2).gain(.38),
  pad.gain(.22),
  noise.fast(2).gain(.28)
);

arrange(
  [8, intro],
  [8, build1],
  [8, build2],
  [8, build3],
  [8, dense],
  [8, strip1],
  [8, strip2],
  [8, climax]
)
