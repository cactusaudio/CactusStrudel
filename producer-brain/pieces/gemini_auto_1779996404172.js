setcpm(130/4);

const kick = s("<[bd ~ ~ ~ ~ bd ~ ~] [bd ~ ~ ~ ~ bd ~ ~] [bd ~ ~ bd ~ ~ ~ ~] [bd ~ ~ ~ ~ [~ bd] ~ bd]>")
  .bank("RolandTR909")
  .gain(0.85)
  .shape(0.18)
  .duckorbit(1)
  .duckattack(0.01)
  .duckdepth(0.75);

const snare = s("~ ~ sd ~ ~ ~ sd ~")
  .bank("RolandTR909")
  .gain(0.52)
  .hpf(180)
  .shape(0.12);

const clap = s("~ ~ cp ~ ~ ~ cp ~")
  .bank("RolandTR707")
  .gain(0.34)
  .hpf(900)
  .delay(0.07)
  .delaytime(0.025)
  .delayfeedback(0.18);

const ghosts = s("sd")
  .struct("<[~ [~ x] ~ ~ ~ [x ~] ~ ~] [~ ~ [~ x] ~ ~ [~ x] ~ [~ x]]>")
  .bank("RolandTR909")
  .gain(0.12)
  .hpf(900)
  .pan(0.58);

const swingHats = s("<[[hh@3 hh] [~ hh] [hh@3 hh] [hh hh]] [[hh@3 hh] [hh hh] [~ hh] [hh@3 hh]] [[hh@3 hh] [~ hh] [hh hh] [hh@3 hh]] [[~ hh] [hh@3 hh] [hh hh] [hh@3 hh]]>")
  .bank("RolandTR808")
  .gain(0.18)
  .hpf(5200)
  .pan(sine.range(0.42, 0.62).slow(2));

const openHat = s("<[~ oh ~ ~ ~ oh ~ ~] [~ oh ~ [~ oh] ~ oh ~ ~]>")
  .bank("RolandTR909")
  .gain(0.16)
  .hpf(6500)
  .decay(0.08)
  .pan(0.66);

const shaker = s("hh")
  .struct("[x ~ x ~]*2")
  .bank("AlesisHR16")
  .gain(0.11)
  .hpf(7200)
  .speed(1.35)
  .pan(sine.range(0.28, 0.72).slow(3));

const rimSkips = s("rim")
  .struct("<[~ x ~ [x ~] ~ ~ x ~] [~ ~ x ~ ~ x ~ [~ x]]>")
  .bank("RolandTR707")
  .gain(0.13)
  .hpf(1800)
  .pan(0.32)
  .delay(0.12)
  .delaytime(0.1875)
  .delayfeedback(0.22);

const drums = stack(kick, snare, clap, ghosts, swingHats, openHat, shaker, rimSkips);

const rhodes = chord("<Gm9 Ebmaj7 Cm9 D7>").voicing()
  .s("gm_epiano1")
  .struct("<[x ~ [~ x] ~] [[~ x] ~ x ~] [x ~ ~ [~ x]] [[~ x] x ~ ~]>")
  .attack(0.004)
  .decay(0.16)
  .sustain(0.16)
  .release(0.09)
  .lpf(perlin.range(900, 2400).slow(8))
  .room(0.22)
  .gain(0.28)
  .orbit(1);

const rhodesArp = chord("<Gm9 Ebmaj7 Cm9 D7>").voicing()
  .arp("0 [2 3] 1 [3 2] 0 [1 2] 3 [2 1]")
  .s("gm_epiano1")
  .attack(0.003)
  .decay(0.08)
  .sustain(0.05)
  .release(0.05)
  .lpf(3200)
  .delay(0.2)
  .delaytime(0.1875)
  .delayfeedback(0.28)
  .gain(0.14)
  .pan(sine.range(0.22, 0.78).slow(4))
  .orbit(1);

const pad = chord("<Gm7 Ebmaj7 Cm7 D7>").voicing()
  .s("gm_pad_warm")
  .attack(0.35)
  .decay(0.4)
  .sustain(0.55)
  .release(1.2)
  .lpf(sine.range(650, 1850).slow(16))
  .room(0.42)
  .roomsize(0.72)
  .gain(0.16)
  .orbit(1);

const vocalChop = n("<[2 ~ 4 5] [~ 7 ~ 5] [4 ~ 2 ~] [[5 4] ~ 2 ~]>")
  .scale("G:minor")
  .add(12)
  .s("triangle")
  .fm(2)
  .attack(0.006)
  .decay(0.09)
  .sustain(0.12)
  .release(0.07)
  .vib(6)
  .lpf(3600)
  .room(0.28)
  .delay(0.24)
  .delaytime(0.1875)
  .delayfeedback(0.34)
  .gain(0.23)
  .pan(sine.range(0.25, 0.75).slow(4))
  .orbit(1);

const vocalStab = note("<[g4,bb4,d5] ~ [f4,bb4,d5] ~ [g4,c5,eb5] ~ [fs4,a4,d5] ~>")
  .s("sine")
  .fm(3)
  .attack(0.015)
  .decay(0.22)
  .sustain(0.2)
  .release(0.22)
  .vib(5)
  .lpf(4200)
  .room(0.36)
  .delay(0.32)
  .delaytime(0.375)
  .delayfeedback(0.42)
  .gain(0.25)
  .pan(0.53)
  .orbit(1);

const subDegrees = n("<[0 ~ ~ ~ ~ -2 ~ ~] [0 ~ [~ 0] ~ 3 ~ 2 ~] [-2 ~ ~ [~ -1] 0 ~ ~ ~] [0 ~ ~ 5 ~ 3 [2 1] ~]>");

const subBass = stack(
  subDegrees.scale("G:minor")
    .sub(24)
    .s("sine")
    .attack(0.008)
    .decay(0.18)
    .sustain(0.42)
    .release(0.08)
    .lpf(120)
    .gain(0.42)
    .orbit(1),
  subDegrees.scale("G:minor")
    .sub(12)
    .s("triangle")
    .fm(1)
    .attack(0.006)
    .decay(0.12)
    .sustain(0.18)
    .release(0.06)
    .lpf(420)
    .gain(0.13)
    .orbit(1)
);

const darkDegrees = n("<[0 ~ [~ 0] ~ ~ -2 ~ ~] [0 ~ ~ [1 2] ~ 5 ~ 3] [-5 ~ ~ -2 ~ [~ -1] 0 ~] [0 ~ 3 ~ 2 ~ [1 0] ~]>");

const darkBass = stack(
  darkDegrees.scale("G:minor")
    .sub(24)
    .s("sine")
    .attack(0.006)
    .decay(0.2)
    .sustain(0.5)
    .release(0.07)
    .lpf(105)
    .gain(0.46)
    .orbit(1),
  darkDegrees.scale("G:minor")
    .sub(12)
    .s("square")
    .fm(1)
    .attack(0.004)
    .decay(0.13)
    .sustain(0.12)
    .release(0.05)
    .lpf(210)
    .shape(0.32)
    .gain(0.12)
    .orbit(1)
);

const intro = stack(
  shaker,
  rimSkips.gain(0.08),
  vocalChop.gain(0.28),
  rhodes.gain(0.16),
  pad.gain(0.11)
);

const drop = stack(
  drums,
  vocalChop,
  rhodes,
  rhodesArp,
  pad.gain(0.08)
);

const main = stack(
  drums,
  subBass,
  vocalChop,
  rhodes,
  rhodesArp,
  pad.gain(0.12)
);

const breakdown = stack(
  shaker.gain(0.08),
  swingHats.gain(0.07),
  vocalStab,
  vocalChop.gain(0.14).lpf(1800),
  rhodes.gain(0.18),
  pad.gain(0.24)
);

const reentry = stack(
  drums,
  darkBass,
  vocalChop.gain(0.19),
  vocalStab.gain(0.12),
  rhodes.gain(0.22),
  rhodesArp.gain(0.1),
  pad.gain(0.1)
);

arrange(
  [4, intro],
  [4, drop],
  [24, main],
  [8, breakdown],
  [16, reentry]
)
