setcpm(128/4);

const sweepWide = saw.range(450, 5200).slow(8);
const sweepDark = sine.range(180, 1400).slow(6);
const crackleDrift = rand.range(0.015, 0.055).slow(1);

const kick = s("bd ~ [~ bd] ~ bd [bd ~] ~ [~ bd]")
  .bank("LinnDrum")
  .gain(0.95)
  .shape(0.18)
  .duckorbit(1)
  .duckattack(0.02)
  .duckdepth(0.55);

const snare = s("~ [rim ~] sd [~ rim] ~ [cp ~] sd [~ sd]")
  .bank("LinnDrum")
  .gain(0.78)
  .room(0.18)
  .shape(0.12);

const hats = s("[hh hh] [hh ~] [hh hh] [~ oh] [hh hh] hh [hh ~] [oh hh]")
  .bank("RolandTR909")
  .gain(0.42)
  .hpf(5200)
  .pan(sine.range(0.25, 0.75).slow(2));

const ghosts = s("~ rim ~ [rim rim] ~ lt [~ rim] mt")
  .bank("AlesisHR16")
  .gain(0.28)
  .hpf(900)
  .delay(0.12)
  .delaytime(0.125)
  .delayfeedback(0.24);

const breakA = stack(kick, snare, hats, ghosts)
  .every(4, x => x.fast(2).mask("<1 1 0 1>").gain(0.72))
  .every(7, x => x.jux(rev).gain(0.72));

const breakB = stack(
  kick.mask("<1 1 1 0>"),
  snare.fast(1).mask("<1 1 1 1>"),
  hats.fast(2).gain(0.32),
  ghosts.fast(2).gain(0.33)
).every(3, x => x.jux(rev).gain(0.68));

const bass = note("a1 ~ [a1 a1] c2 ~ e2 [g1 ~] a1")
  .s("gm_synth_bass_1")
  .lpf(sweepDark)
  .attack(0.01)
  .decay(0.16)
  .sustain(0.2)
  .release(0.06)
  .gain(0.78)
  .shape(0.22)
  .orbit(1);

const subBass = note("a1 ~ ~ c2 ~ ~ g1 ~")
  .s("sine")
  .lpf(140)
  .gain(0.34)
  .release(0.08)
  .orbit(1);

const pad = chord("<Am9 Fmaj7 Dm9 E7>")
  .voicing()
  .s("gm_pad_warm")
  .attack(1.2)
  .sustain(0.72)
  .release(2.4)
  .lpf(sweepWide)
  .room(0.55)
  .roomsize(0.8)
  .gain(0.42)
  .orbit(1);

const stabs = chord("<Am7 Fmaj7 Dm7 E7>")
  .voicing()
  .struct("x ~ [~ x] ~ x [~ x] ~ [x ~]")
  .s("gm_epiano1")
  .attack(0.01)
  .decay(0.22)
  .sustain(0.18)
  .release(0.12)
  .lpf(perlin.range(700, 3600).slow(4))
  .delay(0.18)
  .delaytime(0.1875)
  .delayfeedback(0.32)
  .gain(0.58)
  .orbit(1);

const arp = chord("<Am7 Fmaj7 Dm7 E7>")
  .voicing()
  .arp("0 1 [2 1] 3 2 [1 0] 2 [3 1]")
  .s("square")
  .fm(2)
  .attack(0.005)
  .decay(0.1)
  .sustain(0.08)
  .release(0.05)
  .lpf(sine.range(900, 4200).slow(5))
  .pan(tri.range(0.15, 0.85).slow(3))
  .gain(0.24)
  .orbit(1);

const lead = n("~ 7 [6 4] 2 ~ 0 2 [4 7]")
  .scale("A:minor")
  .add(12)
  .s("gm_flute")
  .attack(0.02)
  .decay(0.2)
  .sustain(0.25)
  .release(0.18)
  .vib(0.18)
  .delay(0.16)
  .delaytime(0.25)
  .delayfeedback(0.28)
  .lpf(3600)
  .gain(0.34)
  .orbit(1);

const crackle = stack(
  s("pink")
    .struct("[x ~ ~ x] ~ [~ x] [x ~ ~ ~]")
    .hpf(5200)
    .lpf(9600)
    .decay(0.018)
    .release(0.02)
    .gain(crackleDrift)
    .pan(rand.range(0.1, 0.9).slow(3)),
  s("white")
    .struct("~ [x ~ ~ ~] ~ [~ ~ x ~]")
    .hpf(7200)
    .decay(0.008)
    .release(0.01)
    .gain(rand.range(0.004, 0.022).slow(2))
);

const sweeps = s("white")
  .struct("x ~ ~ ~")
  .attack(1.4)
  .release(2.2)
  .hpf(500)
  .lpf(sine.range(1200, 9000).slow(8))
  .gain(0.045)
  .pan(sine.range(0.05, 0.95).slow(4))
  .room(0.45);

const intro = stack(
  crackle,
  sweeps,
  pad.gain(0.34),
  hats.gain(0.5),
  stabs.mask("<0 1>").gain(0.42)
);

const groove = stack(
  crackle,
  breakA,
  bass,
  subBass,
  stabs,
  arp,
  pad.gain(0.24)
);

const filterDown = stack(
  crackle,
  breakA.lpf(saw.range(350, 1600).slow(4)).gain(0.72),
  bass.lpf(sine.range(120, 430).slow(4)).gain(0.7),
  subBass.gain(0.26),
  pad.gain(0.48),
  sweeps
);

const drop = stack(
  crackle,
  breakA,
  breakB.mask("<0 1 0 1>").gain(0.62),
  bass.gain(0.92),
  subBass.gain(0.45),
  stabs.gain(0.72),
  arp.gain(0.42),
  lead,
  sweeps
);

const outro = stack(
  crackle,
  breakA.mask("<1 0 1 0>").lpf(1100).gain(0.62),
  bass.mask("<1 1 0 0>").gain(0.58),
  pad.gain(0.5),
  stabs.mask("<1 0>").gain(0.35)
);

arrange(
  [4, intro],
  [8, groove],
  [4, filterDown],
  [8, drop],
  [4, drop.every(2, x => x.fast(2).gain(0.72))],
  [4, outro]
)
