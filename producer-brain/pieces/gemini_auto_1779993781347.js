setcpm(116/4);

const kick = s("bd ~ ~ bd ~ ~ bd ~").bank("RolandTR909")
  .gain(0.82)
  .shape(0.18)
  .duckorbit(1)
  .duckattack(0.04)
  .duckdepth(0.55);

const hats = stack(
  s("hh*8").bank("RolandTR909")
    .gain(0.19)
    .hpf(5200)
    .pan(sine.range(0.42,0.58).slow(6)),
  s("~ oh ~ oh").bank("RolandTR909")
    .gain(0.13)
    .hpf(4200)
    .decay(0.18)
    .room(0.18)
    .pan(0.64),
  s("~ ~ cp ~ ~ ~ rim ~").bank("LinnDrum")
    .gain(0.12)
    .hpf(1800)
    .room(0.22)
    .delay(0.12)
);

const rhodes = chord("<Cmaj7 Am7 Fmaj7 G7>")
  .voicing()
  .struct("[x ~] [~ x] [x ~] [~ x]")
  .s("gm_epiano1")
  .gain(0.43)
  .attack(0.012)
  .decay(0.28)
  .sustain(0.55)
  .release(0.45)
  .lpf(sine.range(1500,2800).slow(8))
  .room(0.45)
  .delay(0.18)
  .delaytime(0.375)
  .delayfeedback(0.28)
  .orbit(1);

const stabEcho = chord("<Cmaj7 Am7 Fmaj7 G7>")
  .voicing()
  .arp("0 2 3 1")
  .struct("~ [x ~] ~ [~ x]")
  .s("gm_epiano1")
  .gain(0.18)
  .attack(0.01)
  .release(0.28)
  .lpf(2200)
  .room(0.55)
  .delay(0.32)
  .delaytime(0.5)
  .delayfeedback(0.36)
  .pan(sine.range(0.30,0.70).slow(4))
  .orbit(1);

const bass = n("<0 5 3 4> [~ <2 0>] <5 4> [~ 4]")
  .scale("C:major")
  .sub(24)
  .s("gm_acoustic_bass")
  .gain(0.48)
  .attack(0.006)
  .decay(0.18)
  .sustain(0.38)
  .release(0.16)
  .lpf(850)
  .orbit(1);

const pad = chord("<Cmaj7 Am7 Fmaj7 G7>")
  .voicing()
  .slow(2)
  .s("gm_pad_warm")
  .gain(0.22)
  .attack(0.55)
  .release(1.3)
  .lpf(sine.range(900,1800).slow(12))
  .room(0.68)
  .pan(sine.range(0.25,0.75).slow(10))
  .orbit(1);

const flute = n("<4 ~ 7 9> <7 5 ~ 4> <2 4 5 ~> <7 ~ 9 11>")
  .scale("C:major")
  .add(12)
  .struct("~ x ~ [x ~]")
  .s("gm_flute")
  .gain(0.16)
  .attack(0.04)
  .release(0.42)
  .vib(0.08)
  .lpf(3200)
  .room(0.52)
  .delay(0.24)
  .delaytime(0.75)
  .delayfeedback(0.30)
  .pan(0.57);

const intro = stack(
  hats,
  rhodes.gain(0.34),
  pad
);

const groove = stack(
  kick,
  hats,
  rhodes,
  stabEcho,
  bass,
  pad
);

const lift = stack(
  kick,
  hats,
  rhodes.superimpose(x => x.off(0.25, y => y.add(12)).gain(0.16)),
  stabEcho,
  bass,
  pad.gain(0.28),
  flute
);

const breakSection = stack(
  hats.gain(0.55),
  rhodes.gain(0.36).lpf(1600),
  pad.gain(0.30),
  flute.gain(0.13)
);

arrange(
  [8, intro],
  [16, groove],
  [16, lift],
  [8, breakSection],
  [16, groove],
  [16, lift]
);
