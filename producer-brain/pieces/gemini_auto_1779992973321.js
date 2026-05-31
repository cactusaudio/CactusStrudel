setcpm(130/4);

const kick = s("<[bd ~ [~ bd] ~] [bd ~ ~ [~ bd]] [bd [~ bd] ~ ~] [bd ~ [~ bd] [~ bd]]>")
  .bank("RolandTR909")
  .gain(0.98)
  .shape(0.28)
  .duckorbit(1)
  .duckattack(0.025)
  .duckdepth(0.85);

const snare = stack(
  s("~ sd ~ sd").bank("RolandTR909").gain(0.62).decay(0.11).hpf(140),
  s("~ cp ~ cp").bank("RolandTR909").gain(0.42).decay(0.07).hpf(900)
);

const hats = s("[hh ~ hh] [~ hh ~] [hh ~ hh] [~ hh hh]")
  .bank("RolandTR909")
  .gain(0.26)
  .decay(0.035)
  .hpf(6200)
  .pan(0.56);

const openhat = s("~ [~ oh] ~ [oh ~]")
  .bank("RolandTR909")
  .gain(0.16)
  .decay(0.08)
  .hpf(5000)
  .pan(0.66);

const rim = s("~ rim ~ [~ rim] ~ ~ rim [~ rim]")
  .bank("RolandTR707")
  .gain(0.15)
  .decay(0.04)
  .hpf(1500)
  .pan(0.34);

const noiseTick = s("pink")
  .struct("[x ~ x] [~ x ~] [x ~ x] [~ x x]")
  .attack(0.001)
  .decay(0.025)
  .sustain(0)
  .release(0.01)
  .hpf(7500)
  .gain(0.035)
  .pan(rand.range(0.2, 0.8))
  .orbit(1);

const drums = stack(kick, snare, hats, openhat, rim, noiseTick);

const pad = chord("<F#m9 Dmaj7 Amaj7 C#7>")
  .voicing()
  .s("gm_pad_warm")
  .attack(0.35)
  .decay(0.4)
  .sustain(0.72)
  .release(0.55)
  .lpf(sine.range(900, 2400).slow(16))
  .room(0.45)
  .roomsize(0.75)
  .gain(0.34)
  .orbit(1);

const arp = chord("<F#m9 Dmaj7 Amaj7 C#7>")
  .voicing()
  .arp("0 [1 2] 3 [2 1]")
  .s("piano")
  .attack(0.005)
  .decay(0.16)
  .sustain(0.12)
  .release(0.1)
  .lpf(4200)
  .delay(0.18)
  .delaytime(0.1875)
  .delayfeedback(0.32)
  .gain(0.42)
  .pan(perlin.range(0.25, 0.75).slow(8))
  .orbit(1);

const sub = n("<[0 ~ 0 [~ 0] ~ [0 ~] 0 ~] [5 ~ 5 [~ 5] ~ [5 ~] 5 ~] [6 ~ 6 [~ 6] ~ [6 ~] 6 ~] [4 ~ 4 [~ 4] ~ [4 ~] 4 ~]>")
  .scale("f#:minor")
  .sub(24)
  .s("sine")
  .attack(0.004)
  .decay(0.09)
  .sustain(0.55)
  .release(0.045)
  .lpf(95)
  .gain(0.72)
  .orbit(1);

const chops = n("[~ 4] ~ [2 4] [~ 0] [6 ~] ~ [4 2] ~")
  .scale("f#:minor")
  .add(12)
  .s("triangle")
  .fm(5)
  .attack(0.003)
  .decay(0.075)
  .sustain(0)
  .release(0.045)
  .hpf(520)
  .lpf(2250)
  .delay(0.22)
  .delaytime(0.125)
  .delayfeedback(0.28)
  .room(0.22)
  .gain(0.36)
  .pan(perlin.range(0.18, 0.82).slow(6))
  .mask("<1 1 0 1>")
  .orbit(1);

const lead = n("~ 4 ~ [3 2] ~ 0 [2 3] ~")
  .scale("f#:minor")
  .add(24)
  .s("sawtooth")
  .attack(0.008)
  .decay(0.12)
  .sustain(0.18)
  .release(0.09)
  .lpf(sine.range(800, 3600).slow(8))
  .vib(0.08)
  .delay(0.2)
  .delaytime(0.1875)
  .delayfeedback(0.34)
  .gain(0.22)
  .jux(rev)
  .orbit(1);

const intro = stack(
  pad.gain(0.75),
  hats.gain(0.55),
  openhat.gain(0.5),
  chops.gain(0.55)
);

const drop = stack(
  drums,
  sub,
  pad,
  arp,
  chops,
  noiseTick
);

const breakpart = stack(
  pad.lpf(1000).gain(0.9),
  chops.off(0.25, x => x.add(7).gain(0.22)),
  arp.gain(0.35),
  s("oh").bank("RolandTR909").struct("~ ~ ~ x").gain(0.12).hpf(5000).room(0.3)
);

const drop2 = stack(
  drums,
  sub.superimpose(x => x.add(12).gain(0.16).lpf(170)),
  pad,
  arp.gain(0.72).off(0.25, x => x.add(12).gain(0.25)),
  chops.off(0.25, x => x.add(7).gain(0.22)),
  lead,
  noiseTick.gain(1.2)
);

arrange([8, intro], [16, drop], [8, breakpart], [16, drop2])
