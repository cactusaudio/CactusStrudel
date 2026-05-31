setcpm(130/4);

const prog = chord("<Am9 Fmaj7 Dm9 E7>").voicing();

const pad = prog
  .s("gm_pad_warm")
  .gain(0.34)
  .attack(0.7)
  .release(2.2)
  .lpf(sine.range(900, 2700).slow(16))
  .room(0.65)
  .roomsize(0.85)
  .orbit(1);

const kick = s("<[bd ~ [~ bd] bd] [bd ~ bd [bd ~]] [bd [~ bd] ~ bd] [bd ~ [bd ~] ~]>")
  .bank("RolandTR909")
  .gain(0.95)
  .shape(0.28)
  .duckorbit(1)
  .duckattack(0.015)
  .duckdepth(0.74);

const snare = s("<[~ sd ~ [sd ~]] [~ sd [~ sd] ~] [[~ sd] ~ ~ sd] [~ sd ~ [sd sd]]>")
  .bank("RolandTR909")
  .gain(0.55)
  .hpf(170)
  .room(0.28)
  .every(4, x => x.off(0.03125, y => y.gain(0.32)));

const hats = s("<[hh*5] [hh*7] [[hh hh] ~ hh [~ hh]] [hh*9]>")
  .bank("RolandTR909")
  .gain(rand.range(0.10, 0.30).slow(2))
  .hpf(5200)
  .pan(rand.range(0.08, 0.92))
  .crush(5)
  .room(0.12);

const clicks = s("<[rim ~ cp rim*2] [~ rim [cp ~] rim] [rim*3 ~ cp ~] [[rim cp] ~ rim cp]>")
  .bank("AlesisHR16")
  .fast(2)
  .gain(0.23)
  .hpf(2400)
  .pan(saw.range(0.05, 0.95).slow(5))
  .delay(0.22)
  .delaytime(0.0625)
  .delayfeedback(0.38)
  .every(7, x => x.jux(rev));

const fizz = s("white")
  .struct("<[x ~ x [~ x]] [~ x x ~] [[x x] ~ x ~] [x ~ [x x] ~]>")
  .fast(2)
  .gain(0.055)
  .hpf(3600)
  .attack(0.001)
  .decay(0.025)
  .release(0.02)
  .pan(rand.range(0, 1))
  .crush(4);

const bass = note("<[a1 ~ a1 c2] [f1 ~ f1 e1] [d1 a1 ~ c2] [e1 ~ g1 e2]>")
  .s("gm_synth_bass_1")
  .gain(0.68)
  .attack(0.004)
  .decay(0.16)
  .release(0.08)
  .lpf(perlin.range(380, 1050).slow(8))
  .shape(0.22)
  .orbit(1);

const lead = n("<[0 2 [4 7] ~] [9 7 4 [2 0]] [[11 12] 9 ~ 7] [4 [5 7] 2 [0 14]]>")
  .scale("A:minor")
  .s("sine")
  .fm(6)
  .fast(2)
  .gain(0.27)
  .attack(0.003)
  .decay(0.12)
  .sustain(0.12)
  .release(0.055)
  .lpf(perlin.range(850, 4300).slow(6))
  .pan(tri.range(0.15, 0.85).slow(3))
  .delay(0.25)
  .delaytime(0.125)
  .delayfeedback(0.34)
  .orbit(1)
  .every(3, x => x.off(0.125, y => y.add(12).gain(0.22)))
  .every(5, x => x.jux(rev));

const shards = prog
  .arp("<[0 2 1 3] [3 1 2 0] [0 [1 3] 2 1] [2 3 0 [1 0]]>")
  .s("square")
  .fm(3)
  .fast(2)
  .gain(0.20)
  .attack(0.002)
  .decay(0.09)
  .release(0.035)
  .hpf(450)
  .lpf(sine.range(1200, 5400).slow(4))
  .pan(rand.range(0.05, 0.95))
  .crush(6)
  .delay(0.18)
  .delaytime(0.09375)
  .delayfeedback(0.31)
  .orbit(1);

const keys = prog
  .arp("<[0 ~ 2 3] [1 2 ~ 0] [0 3 2 ~] [3 ~ 1 0]>")
  .s("gm_epiano1")
  .fast(1.5)
  .gain(0.18)
  .attack(0.01)
  .release(0.32)
  .lpf(2600)
  .room(0.42)
  .pan(0.42)
  .orbit(1);

const drums = stack(kick, snare, hats, clicks, fizz);

const intro = stack(
  pad.gain(0.55),
  shards.mask("<0 1 1 1>").gain(0.55),
  keys.mask("<0 0 1 1>").gain(0.45),
  fizz.gain(0.45)
);

const main = stack(
  drums,
  bass,
  pad,
  lead,
  shards,
  keys
);

const fracture = stack(
  kick.mask("<1 0 0 1>"),
  snare.mask("<0 1 1 0>"),
  hats.fast(0.75).gain(0.65),
  clicks.fast(1.333).gain(0.8),
  fizz,
  pad,
  lead.slow(2).gain(0.55),
  bass.mask("<1 0 1 0>")
);

const finalRush = stack(
  kick,
  snare,
  hats.fast(2).gain(0.75),
  clicks.fast(2).gain(0.9),
  fizz.fast(2).gain(1.2),
  bass.every(2, x => x.off(0.25, y => y.add(12).gain(0.35))),
  pad,
  lead.every(2, x => x.jux(rev)),
  shards.fast(1.5).gain(0.85),
  keys
);

const outro = stack(
  pad,
  bass.mask("<1 0 1 0>").gain(0.7),
  shards.slow(2).gain(0.55),
  fizz.gain(0.5)
);

arrange(
  [4, intro],
  [8, main],
  [4, fracture],
  [8, finalRush],
  [4, outro]
)
