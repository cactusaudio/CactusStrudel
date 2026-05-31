setcpm(174/4);

const kick = s("bd ~ ~ ~ ~ ~ bd ~ ~ bd ~ ~ ~ ~ bd ~")
  .bank("RolandTR909")
  .gain(1.15)
  .shape(0.25)
  .duckorbit(1)
  .duckattack(0.02)
  .duckdepth(0.72);

const snare = s("~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ ~")
  .bank("RolandTR909")
  .gain(1.05)
  .room(0.25)
  .shape(0.18);

const ghost = s("~ ~ rim ~ ~ sd ~ rim ~ ~ rim ~ ~ sd rim ~")
  .bank("AlesisHR16")
  .gain(0.28)
  .hpf(900)
  .room(0.18)
  .pan(perlin.range(0.25,0.75).slow(3));

const hats = s("hh hh hh [hh hh] hh hh hh hh hh [hh hh] hh hh hh hh [hh hh] hh")
  .bank("RolandTR808")
  .gain(0.43)
  .hpf(6500)
  .pan(sine.range(0.35,0.65).slow(2));

const openhat = s("~ ~ oh ~ ~ ~ oh ~ ~ ~ oh ~ ~ ~ oh ~")
  .bank("RolandTR808")
  .gain(0.22)
  .hpf(7200)
  .release(0.08);

const rideNoise = s("white")
  .struct("x ~ x ~ x ~ x ~ x ~ x ~ x ~ x ~")
  .gain(0.055)
  .hpf(8500)
  .pan(rand.range(0.25,0.75))
  .room(0.4);

const drums = stack(kick, snare, ghost, hats, openhat, rideNoise);

const drumsFill = stack(
  kick,
  snare,
  ghost.fast(2).gain(0.22),
  hats.fast(2).gain(0.35),
  openhat,
  s("~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ sd sd sd sd")
    .bank("LinnDrum")
    .gain(0.7)
    .hpf(500)
    .room(0.3)
);

const sub = note("<a1 a1 g1 e1>")
  .struct("x ~ [x x] ~ x ~ x ~")
  .s("sine")
  .attack(0.006)
  .decay(0.12)
  .sustain(0.65)
  .release(0.09)
  .lpf(90)
  .gain(0.9)
  .orbit(1)
  .duckattack(0.02)
  .duckdepth(0.5);

const reese = note("<a2 a2 g2 e2>")
  .struct("x ~ ~ x ~ x ~ ~")
  .s("saw")
  .detune(0.18)
  .lpf(perlin.range(220,780).slow(6))
  .lpq(0.25)
  .gain(0.18)
  .room(0.12)
  .orbit(1)
  .duckdepth(0.45);

const pad = chord("<Am9 Fmaj7 Dm9 E7>")
  .voicing()
  .s("gm_pad_warm")
  .attack(1.8)
  .release(3.6)
  .lpf(sine.range(650,2500).slow(16))
  .gain(0.36)
  .room(0.85)
  .roomsize(0.9)
  .pan(sine.range(0.25,0.75).slow(12))
  .orbit(1)
  .duckdepth(0.22);

const shimmer = chord("<Am9 Fmaj7 Dm9 E7>")
  .voicing()
  .arp("0 1 2 3 2 1")
  .fast(2)
  .s("triangle")
  .add(12)
  .attack(0.02)
  .release(0.45)
  .lpf(3200)
  .delay(0.32)
  .delaytime(0.1875)
  .delayfeedback(0.42)
  .room(0.65)
  .gain(0.13)
  .pan(perlin.range(0.15,0.85).slow(5))
  .mask("<1 0 1 1>");

const flute = n("<0 2 4 7 9 7 4 2>")
  .scale("A:minor")
  .add(12)
  .struct("~ ~ x ~ ~ x ~ ~")
  .s("gm_flute")
  .attack(0.05)
  .release(0.8)
  .gain(0.17)
  .lpf(3600)
  .delay(0.22)
  .room(0.55)
  .pan(sine.range(0.2,0.8).slow(7));

const atmos = stack(
  pad,
  shimmer,
  s("pink")
    .struct("x ~ ~ ~")
    .gain(0.075)
    .hpf(1800)
    .lpf(perlin.range(2600,9000).slow(10))
    .attack(0.4)
    .release(2.5)
    .room(0.95)
    .pan(perlin.range(0.1,0.9).slow(9))
);

const intro = stack(
  atmos,
  flute,
  s("hh ~ ~ ~ ~ ~ hh ~")
    .bank("RolandTR808")
    .gain(0.18)
    .hpf(7000)
    .room(0.45)
);

const drop = stack(drums, sub, reese, atmos, flute);

const dropFill = stack(drumsFill, sub, reese, atmos, flute);

const breakdown = stack(
  atmos,
  flute.superimpose(x => x.off(0.25, y => y.add(7)).gain(0.08)),
  note("a1 ~ ~ ~")
    .s("sine")
    .gain(0.35)
    .lpf(70)
    .orbit(1)
);

const outro = stack(
  pad,
  shimmer.gain(0.08),
  s("pink")
    .struct("x ~ ~ ~")
    .gain(0.04)
    .hpf(2400)
    .lpf(6200)
    .room(0.9)
);

arrange(
  [8, intro],
  [16, drop],
  [4, dropFill],
  [16, drop],
  [8, breakdown],
  [16, drop],
  [4, dropFill],
  [8, outro]
)
