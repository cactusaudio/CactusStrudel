setcpm(130/4);

const kick = s("<[bd ~ [~ bd] ~ bd ~ [bd ~] ~] [bd ~ ~ [bd bd] ~ bd ~ [~ bd]] [[bd ~] ~ bd ~ [~ bd] ~ bd ~] [bd [~ bd] ~ ~ bd ~ [bd ~] [~ bd]]>")
  .bank("RolandTR909")
  .gain(0.95)
  .shape(0.28)
  .clip(0.9)
  .duckorbit(1)
  .duckattack(0.06)
  .duckdepth(0.48);

const snare = s("<[~ ~ sd ~ ~ [sd ~] ~ sd] [~ [sd ~] ~ sd ~ ~ [sd ~] ~] [~ ~ sd [~ rim] ~ ~ sd ~] [~ ~ sd ~ [sd ~] ~ ~ sd]>")
  .bank("RolandTR909")
  .gain(0.58)
  .room(0.22)
  .roomsize(0.35)
  .hpf(180)
  .pan(-0.04);

const hats = stack(
  s("hh*11")
    .bank("RolandTR909")
    .gain(sine.range(0.055, 0.13).slow(3))
    .hpf(5200)
    .pan(sine.range(-0.42, 0.42).slow(5)),
  s("<[~ oh ~ [hh ~] ~ oh ~ ~] [[hh ~] ~ oh ~ ~ [hh oh] ~ ~] [~ oh [~ hh] ~ oh ~ [hh ~] ~] [~ [hh ~] ~ oh ~ [~ oh] ~ hh]>")
    .bank("RolandTR808")
    .gain(0.14)
    .hpf(4300)
    .decay(0.18)
    .pan(0.26)
);

const perc = stack(
  s("<[rim ~ ~ rim ~ cp [~ rim] ~] [~ rim [~ cp] ~ rim ~ ~ cp] [rim ~ [rim ~] ~ cp ~ [~ rim] ~] [~ cp ~ rim [~ rim] ~ cp ~]>")
    .bank("LinnDrum")
    .gain(0.24)
    .hpf(900)
    .room(0.16)
    .pan(0.18),
  s("lt*5")
    .bank("AlesisHR16")
    .gain(0.08)
    .hpf(420)
    .lpf(1800)
    .pan(-0.32)
    .mask("<1 0 1 1>")
);

const fill = s("<[~ ~ ~ ~ ~ ~ [sd sd] [mt ht]] [~ ~ ~ ~ [rim sd] ~ mt ht] [~ ~ [rim ~] ~ ~ [sd sd] [mt ~] ht] [~ ~ ~ cp ~ sd [mt ht] [sd sd]]>")
  .bank("RolandTR808")
  .gain(0.38)
  .room(0.28)
  .hpf(220)
  .mask("<0 0 0 1>");

const drums = stack(kick, snare, hats, perc, fill);

const bass = n("<[0 ~ [0 2] ~ 4 ~ [2 0] ~] [[2 ~] ~ 4 ~ [5 4] ~ 2 ~] [[3 ~] [3 5] ~ 6 ~ [5 3] ~] [[4 ~] 6 ~ [4 3] ~ [2 1] ~]>")
  .scale("f#:minor")
  .sub(24)
  .s("gm_synth_bass_1")
  .attack(0.005)
  .decay(0.18)
  .sustain(0.22)
  .release(0.08)
  .lpf(sine.range(420, 1450).slow(4))
  .shape(0.18)
  .gain(0.76)
  .orbit(1);

const pad = chord("<F#m9 Emaj7 Dmaj7 C#7>")
  .voicing()
  .s("gm_pad_warm")
  .attack(0.45)
  .decay(0.7)
  .sustain(0.72)
  .release(1.4)
  .lpf(sine.range(900, 2400).slow(8))
  .room(0.42)
  .roomsize(0.82)
  .gain(0.46)
  .pan(sine.range(-0.18, 0.18).slow(6))
  .orbit(1);

const stabs = chord("<F#m9 Amaj7 Bm9 C#7>")
  .voicing()
  .s("gm_epiano1")
  .struct("<[x ~ ~ x ~ x ~ ~] [~ x ~ x ~ ~ x ~] [[x ~] ~ ~ x ~ x ~ [~ x]] [~ x x ~ ~ x ~ ~]>")
  .attack(0.012)
  .decay(0.28)
  .sustain(0.18)
  .release(0.16)
  .lpf(perlin.range(1500, 4200).slow(5))
  .room(0.24)
  .delay(0.18)
  .delaytime(0.375)
  .delayfeedback(0.32)
  .gain(0.52)
  .off(0.125, x => x.add(12).gain(0.22).pan(0.24))
  .orbit(1);

const bellArp = chord("<F#m9 Emaj7 Dmaj7 C#7>")
  .voicing()
  .arp("<[0 2 1 3 2 1 0 2] [1 3 2 0 2 3 1 0] [0 1 3 2 1 0 2 3] [3 2 1 0 2 1 3 0]>")
  .mask("<[1 1 0 1 1 0 1 0] [1 0 1 1 0 1 0 1] [1 1 1 0 1 0 1 0] [0 1 1 0 1 1 0 1]>")
  .s("triangle")
  .fm(2)
  .attack(0.004)
  .decay(0.18)
  .sustain(0.08)
  .release(0.22)
  .lpf(2800)
  .delay(0.24)
  .delaytime(0.25)
  .delayfeedback(0.38)
  .gain(0.36)
  .pan(tri.range(-0.36, 0.36).slow(4))
  .orbit(1);

const lead = n("<[~ 4 6 ~ 7 ~ [9 7] ~] [~ 6 ~ 4 [2 4] ~ 6 ~] [[7 ~] 9 ~ 11 ~ [9 7] ~ 6] [~ 4 [6 7] ~ 9 ~ 6 ~]>")
  .scale("f#:minor")
  .add(12)
  .s("sine")
  .fm(5)
  .attack(0.015)
  .decay(0.22)
  .sustain(0.14)
  .release(0.3)
  .vib(0.16)
  .lpf(sine.range(1400, 3600).slow(7))
  .delay(0.22)
  .delaytime(0.375)
  .delayfeedback(0.42)
  .room(0.18)
  .gain(0.42)
  .pan(sine.range(0.18, -0.24).slow(5))
  .orbit(1);

const intro = stack(
  hats.gain(0.52),
  perc.gain(0.35).mask("<0 1 1 1>"),
  pad.gain(0.86),
  stabs.gain(0.32).mask("<1 0 1 0>"),
  bass.gain(0.42).mask("<0 1 0 1>")
);

const groove = stack(
  drums,
  bass,
  stabs,
  pad.gain(0.52),
  bellArp.gain(0.34)
);

const solo = stack(
  drums,
  bass.superimpose(x => x.add(12).gain(0.12).lpf(2200)),
  stabs,
  pad.gain(0.5),
  bellArp.gain(0.48),
  lead.gain(0.64)
);

const breakdown = stack(
  hats.gain(0.38),
  perc.gain(0.22).mask("<1 0 1 0>"),
  pad.gain(0.96),
  stabs.gain(0.28).mask("<1 0 0 1>"),
  bellArp.gain(0.28).mask("<1 0 1 0>"),
  lead.gain(0.52)
);

const reprise = stack(
  drums.gain(1.07),
  bass.superimpose(x => x.add(7).gain(0.1).lpf(1700)),
  stabs.gain(1.06),
  pad.gain(0.54),
  bellArp.gain(0.56).every(4, x => x.add(12)),
  lead.every(3, x => x.add(7)).gain(0.72)
);

const outro = stack(
  kick.mask("<1 0>"),
  snare.mask("<1 0>"),
  hats.gain(0.36),
  perc.gain(0.18),
  pad.gain(0.78),
  bass.gain(0.36),
  stabs.gain(0.22).mask("<1 0 1 0>")
);

arrange(
  [4, intro],
  [8, groove],
  [8, solo],
  [4, breakdown],
  [8, reprise],
  [4, outro]
)
