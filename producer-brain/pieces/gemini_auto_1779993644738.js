setcpm(168/4);

const kick = s("bd ~ ~ ~ ~ bd ~ bd ~ ~ bd ~ ~ ~ ~ bd")
  .bank("RolandTR909")
  .gain(0.95)
  .shape(0.18)
  .duckorbit(1)
  .duckattack(0.012)
  .duckdepth(0.55);

const snare = s("~ ~ ~ [sd ~] sd ~ [~ sd] ~ ~ ~ ~ ~ sd ~ [sd sd] ~")
  .bank("LinnDrum")
  .gain(0.72)
  .hpf(650)
  .room(0.18)
  .shape(0.28);

const ghost = s("~ [rim ~] ~ ~ ~ [sd rim] ~ ~ ~ rim ~ [sd ~] ~ ~ [rim sd] ~")
  .bank("RolandTR707")
  .gain(0.23)
  .hpf(1400)
  .pan(perlin.range(-0.45, 0.45).slow(3))
  .delay(0.18)
  .delaytime(0.125)
  .delayfeedback(0.35);

const hats = s("[hh hh] hh [hh hh] hh [hh hh] [hh oh] [hh hh] hh [hh hh] hh [hh hh] hh [hh hh] [hh hh] [hh oh] hh")
  .bank("RolandTR909")
  .gain(0.18)
  .hpf(5200)
  .pan(perlin.range(-0.25, 0.25).slow(2))
  .room(0.12);

const amenA = stack(kick, snare, ghost, hats)
  .every(4, x => x.jux(rev));

const amenB = stack(
  s("bd ~ ~ bd ~ ~ bd ~ ~ bd ~ ~ bd ~ [bd ~] ~")
    .bank("RolandTR909")
    .gain(0.92)
    .shape(0.2)
    .duckorbit(1)
    .duckattack(0.01)
    .duckdepth(0.58),
  s("~ ~ ~ ~ sd [~ sd] ~ sd ~ ~ rim ~ sd ~ [sd sd] ~")
    .bank("LinnDrum")
    .gain(0.72)
    .hpf(700)
    .room(0.2)
    .shape(0.3),
  s("~ rim ~ [rim sd] ~ ~ rim ~ ~ [sd ~] ~ rim ~ ~ [rim sd] rim")
    .bank("RolandTR707")
    .gain(0.24)
    .hpf(1500)
    .delay(0.22)
    .delaytime(0.1875)
    .delayfeedback(0.42)
    .pan(perlin.range(-0.55, 0.55).slow(2)),
  hats
).every(4, x => x.fast(2));

const subA = n("~ 0 ~ 0 ~ 3 -2 ~ 0 ~ ~ -2 ~ 3 ~ 0")
  .scale("E:minor")
  .sub(24)
  .s("sine")
  .gain(0.78)
  .lpf(105)
  .attack(0.01)
  .decay(0.22)
  .sustain(0.65)
  .release(0.12)
  .orbit(1);

const subB = n("0 ~ ~ 0 ~ 3 ~ -2 0 ~ [~ -2] ~ 3 ~ -2 0")
  .scale("E:minor")
  .sub(24)
  .s("sine")
  .gain(0.82)
  .lpf(115)
  .attack(0.008)
  .decay(0.2)
  .sustain(0.7)
  .release(0.1)
  .orbit(1);

const pad = chord("<Em7 Cmaj7 Am7 B7>")
  .voicing()
  .slow(4)
  .s("gm_pad_warm")
  .gain(0.24)
  .attack(1.2)
  .release(3.5)
  .lpf(sine.range(650, 2200).slow(8))
  .room(0.72)
  .roomsize(0.86)
  .pan(sine.range(-0.18, 0.18).slow(6));

const dubStabs = chord("<Em7 Cmaj7 Am7 B7>")
  .voicing()
  .arp("0 2 3 [1 2]")
  .s("gm_epiano1")
  .struct("x ~ ~ [x ~] ~ x ~ ~")
  .gain(0.32)
  .attack(0.01)
  .release(0.28)
  .lpf(1800)
  .delay(0.48)
  .delaytime(0.375)
  .delayfeedback(0.64)
  .room(0.3)
  .pan(perlin.range(-0.35, 0.35).slow(4))
  .orbit(1);

const fluteEcho = n("~ ~ 2 ~ ~ 4 ~ 3 ~ ~ 0 ~ ~ -2 ~ ~")
  .scale("E:minor")
  .add(12)
  .s("gm_flute")
  .gain(0.18)
  .attack(0.04)
  .release(0.45)
  .lpf(2600)
  .delay(0.42)
  .delaytime(0.25)
  .delayfeedback(0.58)
  .room(0.55)
  .pan(sine.range(0.25, -0.25).slow(5));

const noiseWash = s("white")
  .struct("x ~ ~ ~ ~ ~ ~ ~")
  .gain(0.035)
  .attack(0.02)
  .release(0.9)
  .hpf(6500)
  .lpf(9200)
  .delay(0.35)
  .delaytime(0.5)
  .delayfeedback(0.48)
  .pan(rand.range(-0.8, 0.8));

const intro = stack(
  pad.mask("<1 0 1 0>"),
  dubStabs.gain(0.22),
  hats.gain(0.08),
  fluteEcho.gain(0.12)
);

const halfDrop = stack(
  amenA.gain(0.82),
  subA.gain(0.62),
  pad.gain(0.18),
  dubStabs,
  noiseWash
);

const fullDrop = stack(
  amenA,
  subA,
  pad.gain(0.16).mask("<1 0 0 1>"),
  dubStabs,
  fluteEcho,
  noiseWash
);

const cutDrop = stack(
  amenB,
  subB,
  pad.gain(0.14).mask("<1 0 1 0>"),
  dubStabs.gain(0.38),
  fluteEcho.gain(0.2),
  noiseWash
);

const breakdown = stack(
  subA.gain(0.45).lpf(80),
  pad.gain(0.3),
  dubStabs.gain(0.18).delayfeedback(0.78),
  ghost.gain(0.16),
  fluteEcho.gain(0.22)
);

arrange(
  [8, intro],
  [16, halfDrop],
  [24, fullDrop],
  [8, breakdown],
  [24, cutDrop],
  [8, stack(pad.gain(0.22), dubStabs.gain(0.16), subB.gain(0.35), ghost.gain(0.12))]
)
