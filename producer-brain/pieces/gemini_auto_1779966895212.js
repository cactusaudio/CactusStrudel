setcpm(124/4);

const prog = "<Am F C G>";

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(0.92)
  .duckorbit(1)
  .duckattack(0.035)
  .duckdepth(0.58);

const clap = s("~ sd ~ sd")
  .bank("RolandTR909")
  .gain(0.38)
  .room(0.18)
  .roomsize(0.35);

const hats = stack(
  s("[~ oh]*4")
    .bank("RolandTR909")
    .gain(0.18)
    .hpf(5200)
    .pan(sine.range(0.42, 0.58).slow(4)),
  s("hh*8")
    .bank("RolandTR909")
    .gain(0.075)
    .hpf(6500)
    .pan(sine.range(0.25, 0.75).slow(3))
    .mask("<0 1 1 1>")
);

const perc = stack(
  s("~ rim ~ [rim ~]")
    .bank("RolandTR707")
    .gain(0.12)
    .hpf(2500)
    .room(0.22)
    .mask("<0 1 1 1>"),
  s("~ ~ ~ [mt ht]")
    .bank("RolandTR909")
    .gain(0.16)
    .lpf(1800)
    .room(0.28)
    .mask("<0 0 0 1>")
);

const drums = stack(kick, clap, hats, perc);

const pad = chord(prog)
  .voicing()
  .s("gm_pad_warm")
  .attack(0.45)
  .decay(0.2)
  .sustain(0.82)
  .release(1.6)
  .lpf(sine.range(900, 2300).slow(8))
  .gain(0.34)
  .room(0.55)
  .roomsize(0.78)
  .orbit(1);

const arp = chord(prog)
  .voicing()
  .arp("0 1 2 1 2 1 0 1")
  .add(12)
  .s("supersaw")
  .attack(0.01)
  .decay(0.18)
  .sustain(0.18)
  .release(0.12)
  .lpf(perlin.range(1700, 4400).slow(4))
  .gain(0.25)
  .delay(0.22)
  .delaytime(0.1875)
  .delayfeedback(0.28)
  .room(0.32)
  .orbit(1)
  .every(4, x => x.off(0.125, y => y.add(12).gain(0.12)));

const hook = note("<[a4 c5 e5 g5 e5 c5 e5 ~] [a4 c5 f5 c5 a4 f4 a4 ~] [g4 c5 e5 g5 e5 c5 e5 ~] [b4 d5 g5 d5 b4 g4 b4 ~]>")
  .s("sine")
  .fm(3)
  .attack(0.01)
  .decay(0.16)
  .sustain(0.12)
  .release(0.18)
  .lpf(sine.range(2200, 5200).slow(6))
  .gain(0.22)
  .delay(0.18)
  .delaytime(0.25)
  .delayfeedback(0.34)
  .room(0.38)
  .orbit(1);

const bass = stack(
  note("<a1 f1 c2 g1>")
    .s("gm_synth_bass_1")
    .struct("x ~ x [~ x]")
    .attack(0.01)
    .decay(0.22)
    .sustain(0.35)
    .release(0.12)
    .lpf(650)
    .gain(0.48)
    .orbit(1),
  note("<a2 f2 c3 g2>")
    .s("sawtooth")
    .struct("~ x ~ x")
    .attack(0.005)
    .decay(0.11)
    .sustain(0)
    .release(0.06)
    .hpf(80)
    .lpf(1100)
    .gain(0.16)
    .orbit(1)
);

const air = note("a4")
  .s("white")
  .struct("x")
  .attack(0.55)
  .decay(0.35)
  .sustain(0.18)
  .release(2)
  .hpf(4200)
  .lpf(sine.range(7000, 11500).slow(8))
  .gain(0.035)
  .room(0.72)
  .roomsize(0.9)
  .pan(sine.range(0.2, 0.8).slow(7));

const intro = stack(
  pad.gain(0.28),
  arp.gain(0.12).hpf(260).mask("<1 1 1 0>"),
  air.gain(0.026)
);

const groove = stack(
  drums,
  bass,
  pad,
  arp,
  hook.gain(0.15).mask("<0 1 1 1>"),
  air.gain(0.022)
);

const breakPart = stack(
  pad.gain(0.36).lpf(sine.range(700, 1800).slow(4)),
  hook.gain(0.18).delayfeedback(0.46),
  arp.gain(0.12).hpf(420).mask("<1 0 1 0>"),
  air.gain(0.05)
);

const drop = stack(
  drums,
  bass.gain(0.55),
  pad.gain(0.32),
  arp.superimpose(x => x.add(12).gain(0.1)),
  hook.superimpose(x => x.add(12).gain(0.08)),
  air.gain(0.028),
  s("oh*4")
    .bank("RolandTR909")
    .gain(0.07)
    .hpf(6500)
    .pan(sine.range(0.35, 0.65).slow(2))
    .mask("<0 1 0 1>")
);

arrange(
  [4, intro],
  [8, groove],
  [4, breakPart],
  [8, drop]
)
