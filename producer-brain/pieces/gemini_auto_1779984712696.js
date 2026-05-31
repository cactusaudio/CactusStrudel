setcpm(122/4);

const kick = s("bd ~ ~ bd ~ bd ~ ~")
  .bank("RolandTR909")
  .gain(0.85)
  .duckorbit(1)
  .duckattack(0.08)
  .duckdepth(0.45);

const hats = stack(
  s("~ hh ~ hh ~ hh ~ hh")
    .bank("RolandTR808")
    .gain(0.22)
    .hpf(5200)
    .pan(0.18),
  s("~ ~ oh ~ ~ ~ oh ~")
    .bank("RolandTR808")
    .gain(0.16)
    .hpf(4200)
    .delay(0.12)
    .delaytime(0.25)
    .delayfeedback(0.18)
    .pan(-0.22)
);

const handPerc = stack(
  s("~ rim ~ [rim rim] ~ rim ~ [~ rim]")
    .bank("LinnDrum")
    .gain(0.24)
    .hpf(900)
    .pan(perlin.range(-0.45,0.45).slow(6)),
  s("~ ~ cp ~ ~ cp ~ ~")
    .bank("RolandTR707")
    .gain(0.18)
    .hpf(1200)
    .room(0.25)
    .pan(-0.35),
  s("[hh hh] ~ [hh hh] ~ [hh hh] ~ [hh hh] ~")
    .bank("AlesisHR16")
    .gain(0.09)
    .hpf(7000)
    .pan(0.38)
);

const pad = chord("<Dmaj7 Bm7 Gmaj7 A7>")
  .voicing()
  .s("gm_pad_warm")
  .attack(0.6)
  .release(1.6)
  .sustain(0.65)
  .lpf(sine.range(900,2600).slow(8))
  .room(0.55)
  .roomsize(0.72)
  .gain(0.34)
  .orbit(1);

const keys = chord("<Dmaj7 Bm7 Gmaj7 A7>")
  .voicing()
  .arp("0 1 2 1 3 2 1 0")
  .s("gm_epiano1")
  .attack(0.02)
  .decay(0.18)
  .sustain(0.12)
  .release(0.22)
  .lpf(3400)
  .delay(0.16)
  .delaytime(0.375)
  .delayfeedback(0.25)
  .gain(0.3)
  .pan(sine.range(-0.25,0.25).slow(4))
  .orbit(1);

const bass = n("<0 5 3 4> <0 5 3 4>")
  .scale("D:major")
  .sub(12)
  .s("gm_synth_bass_1")
  .struct("x ~ [x ~] ~ x ~ ~ x")
  .attack(0.03)
  .decay(0.22)
  .sustain(0.45)
  .release(0.22)
  .lpf(850)
  .gain(0.48)
  .orbit(1);

const pluck = n("<0 2 4 6 7 6 4 2> <9 7 6 4 2 4 6 7> <4 6 7 9 11 9 7 6> <7 6 4 2 1 2 4 6>")
  .scale("D:major")
  .s("square")
  .fm(2)
  .attack(0.005)
  .decay(0.16)
  .sustain(0.08)
  .release(0.24)
  .lpf(sine.range(1400,5200).slow(4))
  .delay(0.22)
  .delaytime(0.25)
  .delayfeedback(0.32)
  .room(0.22)
  .gain(0.31)
  .pan(tri.range(-0.38,0.38).slow(8))
  .orbit(1);

const hook = n("<7 ~ 6 4 2 ~ 4 6> <9 7 ~ 6 4 2 ~ 0> <11 ~ 9 7 6 ~ 7 9> <7 6 4 ~ 2 1 2 ~>")
  .scale("D:major")
  .s("supersaw")
  .attack(0.01)
  .decay(0.2)
  .sustain(0.1)
  .release(0.28)
  .lpf(3600)
  .gain(0.24)
  .delay(0.18)
  .delaytime(0.5)
  .delayfeedback(0.24)
  .pan(perlin.range(-0.3,0.3).slow(5))
  .orbit(1);

const fluteAir = n("<~ 11 ~ 9> <~ 7 ~ 6> <~ 9 ~ 11> <~ 7 ~ 4>")
  .scale("D:major")
  .s("gm_flute")
  .attack(0.12)
  .release(0.8)
  .lpf(4200)
  .room(0.48)
  .gain(0.16)
  .pan(0.28)
  .orbit(1);

arrange(
  [4, stack(pad, keys, bass)],
  [4, stack(kick, hats, pad, keys, bass, pluck)],
  [8, stack(kick, hats, handPerc, pad, keys, bass, pluck, hook)],
  [4, stack(hats, handPerc, pad, keys, fluteAir)],
  [8, stack(kick, hats, handPerc, pad, keys, bass, pluck.superimpose(x => x.add(12).gain(0.18)), hook, fluteAir)]
);
