setcpm(168/4);

const breakCore = stack(
  s("[bd hh] [~ bd] [sd hh] [~ bd] [bd hh] [bd hh] [sd hh] [oh hh]")
    .bank("RolandTR909")
    .gain(0.82)
    .shape(0.34)
    .crush(7)
    .clip(0.9),
  s("~ [rim ~] ~ [sd ~] ~ [rim rim] ~ [cp ~]")
    .bank("RolandTR707")
    .gain(0.32)
    .hpf(800)
    .room(0.12),
  s("hh*16")
    .bank("AlesisHR16")
    .gain(0.18)
    .hpf(5000)
    .pan(perlin.range(0.25, 0.75).slow(2))
)
  .every(4, x => x.jux(rev))
  .every(8, x => x.superimpose(y => y.fast(2).gain(0.35)))
  .duckorbit(0)
  .duckattack(0.015)
  .duckdepth(0.7);

const breakFill = stack(
  s("[bd hh] [sd hh] [bd bd] [sd hh] [bd hh] [rim hh] [sd bd] [oh sd]")
    .bank("LinnDrum")
    .gain(0.78)
    .shape(0.45)
    .crush(6),
  s("hh*16")
    .bank("RolandTR808")
    .gain(0.16)
    .hpf(5200)
)
  .every(2, x => x.jux(rev))
  .duckorbit(0)
  .duckattack(0.012)
  .duckdepth(0.78);

const sub = note("e1 ~ [e1 e1] ~ g1 ~ b0 ~ e1 ~ ~ d1 [e1 g1] ~ b0 ~")
  .s("sine")
  .gain(0.92)
  .attack(0.01)
  .decay(0.2)
  .sustain(0.65)
  .release(0.08)
  .lpf(92)
  .shape(0.24)
  .orbit(0);

const dubSub = note("e1 ~ ~ ~ [e1 d1] ~ b0 ~ e1 ~ g1 ~ ~ d1 b0 ~")
  .s("sine")
  .gain(0.82)
  .attack(0.01)
  .decay(0.28)
  .sustain(0.6)
  .release(0.12)
  .lpf(85)
  .shape(0.18)
  .orbit(0);

const stabs = chord("<Em7 Cmaj7 D7 Bm7>")
  .voicing()
  .s("gm_pad_warm")
  .struct("~ x ~ [~ x] ~ x ~ [~ x]")
  .attack(0.01)
  .decay(0.22)
  .sustain(0)
  .release(0.26)
  .lpf(perlin.range(900, 2300).slow(8))
  .lpq(4)
  .room(0.62)
  .roomsize(0.82)
  .delay(0.34)
  .delaytime(0.375)
  .delayfeedback(0.55)
  .gain(0.34)
  .pan(sine.range(0.35, 0.65).slow(4))
  .orbit(0);

const arpChop = chord("<Em7 Cmaj7 D7 Bm7>")
  .voicing()
  .arp("0 2 3 1 2 0 3 2")
  .s("saw")
  .gain(0.18)
  .attack(0.005)
  .decay(0.09)
  .sustain(0.1)
  .release(0.08)
  .lpf(sine.range(900, 4200).slow(6))
  .hpf(280)
  .delay(0.18)
  .delaytime(0.1875)
  .delayfeedback(0.32)
  .pan(perlin.range(0.2, 0.8).slow(3))
  .mask("<0 1 1 0 1 1 0 1>")
  .orbit(0);

const raggaLead = n("~ 7 ~ [9 7] 4 ~ [2 4] ~")
  .scale("E:minor")
  .add(12)
  .s("square")
  .fm(3)
  .gain(0.16)
  .attack(0.004)
  .decay(0.11)
  .sustain(0.2)
  .release(0.08)
  .hpf(650)
  .lpf(3600)
  .crush(8)
  .delay(0.22)
  .delaytime(0.25)
  .delayfeedback(0.38)
  .pan(sine.range(0.15, 0.85).slow(2))
  .mask("<0 0 1 1 0 1 1 1>");

const grit = note("e3*16")
  .s("brown")
  .struct("x ~ ~ x ~ x ~ ~ x ~ x ~ ~ x ~ ~")
  .gain(0.045)
  .hpf(900)
  .lpf(perlin.range(1700, 6500).slow(5))
  .crush(4)
  .room(0.3)
  .pan(rand.range(0.1, 0.9));

const intro = stack(
  breakCore.hpf(260).gain(0.78),
  stabs.gain(0.85),
  grit.gain(0.7)
);

const drop = stack(
  breakCore,
  sub,
  stabs,
  grit
);

const rinse = stack(
  breakFill,
  sub,
  stabs.gain(0.9),
  arpChop,
  grit.gain(1.2)
);

const dubBreak = stack(
  s("~ ~ sd ~ ~ ~ rim ~").bank("RolandTR808").gain(0.28).hpf(500).room(0.5).delay(0.25),
  dubSub,
  stabs.gain(1.15),
  grit.gain(0.55)
);

const finalRun = stack(
  breakCore,
  breakFill.gain(0.5).mask("<0 1 0 1>"),
  sub,
  stabs,
  arpChop,
  raggaLead,
  grit
);

arrange(
  [4, intro],
  [8, drop],
  [4, rinse],
  [4, dubBreak],
  [8, finalRun],
  [4, stack(breakFill, sub, stabs.gain(1.05), raggaLead, grit.gain(1.25))]
)
