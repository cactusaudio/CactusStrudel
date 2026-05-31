setcpm(130/4);

const kick = s("bd ~ [~ bd] ~ bd ~ [bd ~] ~")
  .bank("LinnDrum")
  .gain(1.15)
  .shape(0.35)
  .duckorbit(1)
  .duckattack(0.025)
  .duckdepth(0.82);

const snare = s("~ ~ sd [~ sd] ~ [~ rim] sd [cp sd]")
  .bank("RolandTR707")
  .gain(0.9)
  .hpf(160)
  .shape(0.22)
  .room(0.18);

const hats = s("hh*16")
  .bank("RolandTR909")
  .gain(0.22)
  .hpf(5200)
  .pan(sine.range(-0.35, 0.35).slow(2));

const openHats = s("~ ~ oh ~ ~ ~ [oh ~] ~")
  .bank("RolandTR909")
  .gain(0.32)
  .hpf(4200)
  .decay(0.08);

const choppedBreak = s("[bd hh] [rim hh] [sd hh] [[bd rim] hh] [bd hh] [sd hh] [bd hh] [sd oh]")
  .bank("AlesisHR16")
  .gain(0.42)
  .hpf(120)
  .lpf(7600)
  .pan(tri.range(-0.18, 0.18).slow(4))
  .room(0.12);

const drums = stack(kick, snare, hats, openHats, choppedBreak)
  .every(4, x => x.fast(2).gain(0.74));

const bass = stack(
  note("d1 [d1 d1] ~ d1 f1 [g1 f1] d1 [c2 a1]")
    .s("sawtooth")
    .attack(0.005)
    .decay(0.16)
    .sustain(0.24)
    .release(0.06)
    .lpf(perlin.range(260, 1200).slow(4))
    .shape(0.45)
    .gain(0.72),
  note("d1 ~ d1 ~ f1 ~ a1 c2")
    .s("sine")
    .fm(2)
    .attack(0.004)
    .decay(0.18)
    .sustain(0.32)
    .release(0.05)
    .lpf(220)
    .gain(0.45)
).orbit(1);

const stabs = stack(
  chord("<Dm7 C7 Bbmaj7 A7>")
    .voicing()
    .struct("x ~ ~ [x ~] ~ x ~ [~ x]")
    .s("gm_epiano1")
    .attack(0.004)
    .decay(0.22)
    .sustain(0.1)
    .release(0.08)
    .hpf(420)
    .lpf(5200)
    .crush(7)
    .gain(0.58)
    .delay(0.18)
    .delaytime(0.375)
    .delayfeedback(0.22),
  chord("<Dm7 C7 Bbmaj7 A7>")
    .voicing()
    .arp("0 2 3 1")
    .struct("[x x] ~ ~ x ~ [x ~] ~ ~")
    .s("square")
    .attack(0.002)
    .decay(0.11)
    .sustain(0.05)
    .release(0.05)
    .hpf(650)
    .lpf(3400)
    .gain(0.23)
    .pan(sine.range(-0.45, 0.45).slow(3))
).orbit(1);

const hook = n("~ 0 [2 3] 5 ~ 3 2 [0 2]")
  .scale("D:minor")
  .add(12)
  .s("square")
  .attack(0.006)
  .decay(0.12)
  .sustain(0.18)
  .release(0.07)
  .lpf(sine.range(1200, 5200).slow(2))
  .delay(0.24)
  .delaytime(0.25)
  .delayfeedback(0.28)
  .gain(0.28)
  .orbit(1)
  .every(4, x => x.add(12).gain(0.55));

const pad = chord("<Dm9 Bbmaj7 Fmaj7 C7>")
  .voicing()
  .slow(2)
  .s("gm_pad_warm")
  .attack(0.45)
  .decay(0.8)
  .sustain(0.65)
  .release(1.8)
  .lpf(2600)
  .hpf(120)
  .room(0.5)
  .roomsize(0.78)
  .gain(0.28)
  .orbit(1);

const filteredDrums = stack(kick, snare, hats, choppedBreak)
  .hpf(380)
  .lpf(4300)
  .gain(0.62);

const intro = stack(
  pad.gain(0.45),
  filteredDrums,
  stabs.gain(0.62)
);

const drop = stack(
  drums,
  bass,
  stabs,
  hook
);

const breakdown = stack(
  pad.gain(0.58),
  stabs.gain(0.78).lpf(3100),
  hats.gain(0.18),
  s("~ ~ ~ [oh oh]").bank("RolandTR909").gain(0.25).hpf(3600).room(0.35)
);

const drop2 = stack(
  drums.superimpose(x => x.fast(2).hpf(300).gain(0.24)),
  bass.superimpose(x => x.add(12).lpf(1800).gain(0.18)),
  stabs.gain(1.05),
  hook.superimpose(x => x.add(7).gain(0.38))
);

arrange(
  [4, intro],
  [8, drop],
  [4, breakdown],
  [8, drop2],
  [4, drop]
)
