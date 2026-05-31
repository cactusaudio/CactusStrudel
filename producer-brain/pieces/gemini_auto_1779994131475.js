setcpm(88/4);

const crackle = note("c6*16")
  .s("pink")
  .decay(0.015)
  .sustain(0)
  .release(0.02)
  .gain(rand.range(0.004, 0.035).slow(2))
  .hpf(3200)
  .lpf(perlin.range(5200, 9000).slow(6))
  .pan(rand.range(-0.75, 0.75))
  .room(0.18)
  .roomsize(0.35);

const kick = s("bd ~ [~ bd] ~ bd ~ ~ [bd ~]")
  .bank("LinnDrum")
  .gain(0.9)
  .shape(0.25)
  .lpf(1800)
  .duckorbit(1)
  .duckattack(0.06)
  .duckdepth(0.58);

const snare = s("~ ~ sd ~ ~ [~ sd] sd ~")
  .bank("LinnDrum")
  .gain(0.55)
  .hpf(180)
  .lpf(5200)
  .room(0.32)
  .roomsize(0.45)
  .delay(0.08)
  .delaytime(0.375)
  .delayfeedback(0.18);

const hats = s("hh*8")
  .bank("RolandTR909")
  .gain(perlin.range(0.035, 0.11).slow(5))
  .hpf(4300)
  .lpf(9800)
  .pan(perlin.range(-0.35, 0.35).slow(3))
  .room(0.12)
  .mask("<1 1 0 1>");

const ghostRim = s("~ rim ~ [~ rim] ~ ~ rim ~")
  .bank("RolandTR707")
  .gain(0.16)
  .hpf(900)
  .lpf(4200)
  .room(0.25)
  .delay(0.18)
  .delaytime(0.25)
  .delayfeedback(0.22)
  .pan(-0.28);

const sub = n("<0 ~ ~ 0 [~ -2] ~ 3 ~>")
  .scale("C:minor")
  .sub(24)
  .s("sine")
  .attack(0.015)
  .decay(0.18)
  .sustain(0.55)
  .release(0.12)
  .gain(0.62)
  .lpf(95)
  .orbit(1);

const rhodes = chord("<Cm9 Abmaj7 Fm9 G7>")
  .voicing()
  .s("gm_epiano1")
  .struct("x ~ ~ [~ x] ~ x ~ ~")
  .attack(0.025)
  .decay(0.45)
  .sustain(0.42)
  .release(1.8)
  .gain(0.38)
  .lpf(perlin.range(950, 2100).slow(8))
  .lpq(0.65)
  .room(0.55)
  .roomsize(0.72)
  .delay(0.28)
  .delaytime(0.75)
  .delayfeedback(0.32)
  .pan(-0.12)
  .orbit(1);

const sampleStab = note("<[c4,eb4,g4,bb4] ~ [ab3,c4,eb4,g4] ~ [f3,ab3,c4,eb4] ~ [g3,b3,d4,f4] ~>")
  .s("piano")
  .attack(0.005)
  .decay(0.28)
  .sustain(0.18)
  .release(0.55)
  .gain(0.26)
  .speed(0.78)
  .coarse(1)
  .crush(7)
  .lpf(perlin.range(620, 1450).slow(4))
  .lpq(0.9)
  .room(0.42)
  .delay(0.18)
  .delaytime(0.5)
  .delayfeedback(0.24)
  .pan(0.18)
  .orbit(1);

const smokeLead = n("~ 2 ~ 3 ~ [4 3] ~ 1")
  .scale("C:minor")
  .add(12)
  .s("gm_flute")
  .attack(0.08)
  .decay(0.22)
  .sustain(0.35)
  .release(0.7)
  .gain(0.18)
  .lpf(1800)
  .vib(0.18)
  .room(0.62)
  .roomsize(0.8)
  .delay(0.22)
  .delaytime(0.75)
  .delayfeedback(0.35)
  .pan(perlin.range(0.15, 0.48).slow(6))
  .mask("<0 1 0 1>")
  .orbit(1);

const pad = chord("<Cm9 Cm9 Abmaj7 G7>")
  .voicing()
  .s("gm_pad_warm")
  .slow(2)
  .attack(0.65)
  .decay(1.2)
  .sustain(0.5)
  .release(2.8)
  .gain(0.18)
  .lpf(perlin.range(700, 1600).slow(10))
  .room(0.7)
  .roomsize(0.92)
  .pan(perlin.range(-0.25, 0.25).slow(9))
  .orbit(1);

const drums = stack(kick, snare, hats, ghostRim);
const full = stack(crackle, drums, sub, rhodes, sampleStab, smokeLead, pad);
const stripped = stack(crackle, kick, snare, sub, rhodes, sampleStab);
const hush = stack(crackle, rhodes, pad, sampleStab.mask("<1 0 0 1>"));
const breakbeat = stack(crackle, drums.every(4, x => x.fast(2)), sub, rhodes, sampleStab, smokeLead);

arrange(
  [4, hush],
  [8, stripped],
  [8, full],
  [4, stack(crackle, snare, hats, rhodes, pad, smokeLead)],
  [8, breakbeat],
  [8, full],
  [4, stack(crackle, sub, rhodes, sampleStab, pad)]
)
