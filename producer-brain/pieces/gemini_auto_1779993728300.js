setcpm(174/4);

const chords = chord("<Cm9 Abmaj7 Ebmaj7 Bb9>").voicing();

const kick = s("<[bd ~ ~ bd ~ ~ bd ~ ~ bd ~ ~ ~ ~ bd ~] [bd ~ ~ bd ~ bd ~ ~ bd ~ ~ bd ~ ~ bd ~] [bd ~ ~ ~ bd ~ bd ~ ~ bd ~ ~ bd ~ ~ ~] [bd ~ ~ bd ~ ~ bd ~ bd ~ ~ ~ ~ bd ~ ~]>")
  .bank("RolandTR909")
  .gain(0.82)
  .decay(0.16)
  .duckorbit(1)
  .duckattack(0.025)
  .duckdepth(0.62);

const snare = s("<[~ ~ ~ ~ sd ~ ~ [sd rim] ~ ~ ~ ~ sd ~ ~ rim] [~ ~ ~ rim sd ~ ~ ~ ~ rim ~ ~ sd ~ [rim sd] ~] [~ ~ rim ~ sd ~ ~ rim ~ ~ ~ ~ sd ~ ~ ~] [~ ~ ~ ~ sd ~ rim ~ ~ ~ ~ rim sd ~ ~ rim]>")
  .bank("RolandTR909")
  .gain(0.68)
  .decay(0.12)
  .room(0.22)
  .hpf(170);

const hats = stack(
  s("hh*16")
    .bank("RolandTR707")
    .gain(0.18)
    .decay(0.032)
    .hpf(4200)
    .pan(perlin.range(0.42, 0.58).slow(2)),
  s("<[~ hh ~ hh ~ hh [hh hh] hh ~ hh ~ hh ~ hh hh ~] [hh ~ hh hh ~ hh ~ hh hh ~ hh ~ [hh hh] ~ hh ~] [~ hh hh ~ hh ~ hh hh ~ hh ~ hh ~ [hh hh] ~ hh] [hh ~ hh ~ [hh hh] ~ hh ~ hh hh ~ hh ~ hh ~ hh]>")
    .bank("RolandTR808")
    .gain(0.09)
    .decay(0.02)
    .hpf(5200)
);

const openHats = s("<[~ ~ oh ~ ~ ~ hh ~ ~ ~ oh ~ ~ ~ oh ~] [~ ~ oh ~ ~ oh ~ ~ ~ ~ oh ~ ~ hh ~ ~] [~ oh ~ ~ ~ ~ oh ~ ~ ~ oh ~ ~ ~ hh ~] [~ ~ oh ~ ~ ~ ~ oh ~ oh ~ ~ ~ ~ oh ~]>")
  .bank("RolandTR909")
  .gain(0.16)
  .decay(0.09)
  .hpf(3300)
  .pan(0.62);

const ghosts = s("<[~ rim ~ ~ ~ ~ sd ~ ~ rim ~ ~ ~ cp ~ ~] [rim ~ ~ ~ ~ rim sd ~ ~ ~ rim ~ ~ cp ~ rim] [~ rim ~ rim ~ ~ sd ~ rim ~ ~ ~ ~ cp ~ ~] [~ ~ rim ~ ~ rim sd ~ ~ rim ~ ~ cp ~ ~ rim]>")
  .bank("RolandTR707")
  .gain(0.19)
  .decay(0.075)
  .hpf(900)
  .room(0.18);

const drumsCore = stack(kick, snare, hats, openHats, ghosts)
  .every(4, x => x.superimpose(y => y.fast(2).gain(0.10).hpf(1600)));

const bassNotes = note("<[c2 ~ c2 [c2 eb2] ~ g1 ~ eb2 bb1 ~ bb1 c2 eb2 ~ g1 ~] [ab1 ~ ab1 [ab1 c2] ~ eb2 ~ c2 g1 ~ g1 ab1 c2 ~ eb2 ~] [eb2 ~ eb2 [eb2 g2] ~ bb1 ~ g2 bb1 ~ bb1 eb2 g2 ~ f2 ~] [bb1 ~ bb1 [bb1 d2] ~ f2 ~ d2 ab1 ~ ab1 bb1 d2 ~ f1 ~]>");

const subBass = bassNotes
  .s("sine")
  .gain(0.74)
  .attack(0.006)
  .release(0.15)
  .lpf(88)
  .orbit(1);

const bassEdge = bassNotes
  .s("sawtooth")
  .gain(0.13)
  .attack(0.004)
  .release(0.09)
  .lpf(sine.range(220, 620).slow(4))
  .lpq(0.22)
  .orbit(1);

const rhodes = chords
  .s("gm_epiano1")
  .gain(0.34)
  .attack(0.025)
  .sustain(0.62)
  .release(1.7)
  .lpf(sine.range(1100, 3600).slow(8))
  .room(0.48)
  .roomsize(0.78)
  .orbit(1);

const warmPad = chords
  .s("gm_pad_warm")
  .gain(0.24)
  .attack(0.9)
  .sustain(0.7)
  .release(4.2)
  .lpf(sine.range(650, 2200).slow(12))
  .room(0.72)
  .roomsize(0.9)
  .orbit(1);

const sparkle = chord("<Cm9 Abmaj7 Ebmaj7 Bb9>")
  .voicing()
  .arp("0 1 2 3 2 1 3 2")
  .s("sawtooth")
  .gain(0.13)
  .attack(0.006)
  .release(0.11)
  .lpf(2700)
  .delay(0.22)
  .delaytime(0.1875)
  .delayfeedback(0.36)
  .room(0.38)
  .pan(sine.range(0.24, 0.76).slow(3))
  .orbit(1);

const vocalAir = n("<[~ 7 ~ [10 7] ~ 5 ~ 3 ~ 7 [5 3] ~ 2 ~ 0 ~] [~ 10 ~ 12 ~ [7 5] ~ 3 ~ 5 ~ [7 10] ~ 5 ~] [~ 7 ~ 5 ~ 3 ~ [2 3] ~ 7 ~ [5 3] ~ 2 ~] [~ 5 ~ [7 10] ~ 12 ~ 10 ~ 7 [5 3] ~ 2 ~ 0 ~]>")
  .scale("C:minor")
  .add(12)
  .s("triangle")
  .fm(3)
  .gain(0.19)
  .attack(0.006)
  .release(0.17)
  .hpf(860)
  .lpf(perlin.range(2400, 7200).slow(5))
  .delay(0.32)
  .delaytime(0.25)
  .delayfeedback(0.42)
  .room(0.64)
  .pan(perlin.range(0.18, 0.82).slow(4))
  .orbit(1);

const noiseWash = note("<c5 eb5 g5 bb5>")
  .s("pink")
  .gain(0.026)
  .attack(2)
  .release(3.5)
  .hpf(3200)
  .lpf(sine.range(5200, 9400).slow(16))
  .room(0.82)
  .roomsize(0.92)
  .pan(perlin.range(0.1, 0.9).slow(10))
  .orbit(1);

const intro = stack(
  warmPad.gain(0.32),
  rhodes.gain(0.25).lpf(sine.range(600, 2200).slow(8)),
  sparkle.mask("<0 1 0 1>").gain(0.08),
  vocalAir.mask("<0 0 1 1>").gain(0.13),
  noiseWash,
  s("hh*8").bank("RolandTR707").gain(0.08).decay(0.03).hpf(5000).pan(0.62),
  kick.gain(0.34).lpf(720)
);

const dropA = stack(
  drumsCore,
  subBass,
  bassEdge,
  rhodes,
  warmPad,
  sparkle.mask("<1 1 0 1>"),
  vocalAir.mask("<0 1 1 1>"),
  noiseWash.gain(0.02)
);

const breakdown = stack(
  warmPad.gain(0.42),
  rhodes.gain(0.24).lpf(1300),
  sparkle.mask("<1 0 1 0>").gain(0.10).delayfeedback(0.55),
  vocalAir.gain(0.18).release(0.25),
  subBass.mask("<1 0 0 0>").gain(0.34),
  s("~ ~ ~ ~ sd ~ ~ ~").bank("RolandTR909").gain(0.18).room(0.5).lpf(1800),
  noiseWash.gain(0.03)
);

const dropB = stack(
  drumsCore,
  hats.fast(2).gain(0.07).mask("<0 1>"),
  ghosts.fast(2).gain(0.10).hpf(1400).mask("<1 0 1 1>"),
  subBass,
  bassEdge.gain(0.18),
  rhodes,
  warmPad.gain(0.22),
  sparkle.superimpose(x => x.add(12).gain(0.06)).mask("<1 1 1 0>"),
  vocalAir.every(4, x => x.jux(rev)).gain(0.21),
  noiseWash.gain(0.018)
);

const outro = stack(
  warmPad.gain(0.3),
  rhodes.gain(0.22).lpf(sine.range(500, 1800).slow(8)),
  sparkle.mask("<1 0 0 0>").gain(0.08),
  vocalAir.mask("<0 1 0 0>").gain(0.12),
  kick.mask("<1 0 0 0>").gain(0.28).lpf(500),
  noiseWash.gain(0.03)
);

arrange(
  [8, intro],
  [16, dropA],
  [8, breakdown],
  [16, dropB],
  [8, outro]
)
