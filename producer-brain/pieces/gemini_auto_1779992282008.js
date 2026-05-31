setcpm(100/4);

const pulse4 = stack(
  s("bd ~ ~ ~ bd ~ ~ ~")
    .bank("RolandTR808")
    .gain(0.82)
    .lpf(110)
    .duckorbit(2)
    .duckattack(0.035)
    .duckdepth(0.42),
  s("~ ~ sd ~ ~ ~ sd ~")
    .bank("RolandTR909")
    .gain(0.34)
    .room(0.18),
  s("hh*8")
    .bank("RolandTR707")
    .gain(0.15)
    .hpf(5200)
    .pan(0.08),
  s("~ oh ~ ~ ~ oh ~ ~")
    .bank("RolandTR909")
    .gain(0.12)
    .hpf(3400)
    .room(0.22)
);

const hand3 = stack(
  s("lt mt ht")
    .bank("AlesisHR16")
    .gain(0.42)
    .lpf(1700)
    .room(0.2)
    .pan(-0.32),
  s("~ rim ~")
    .bank("RolandTR707")
    .gain(0.22)
    .hpf(900)
    .room(0.28)
    .pan(0.38)
);

const mallet5 = n("0 2 3 5 6")
  .scale("G:dorian")
  .add(12)
  .s("sine")
  .fm(5)
  .attack(0.004)
  .decay(0.18)
  .sustain(0.12)
  .release(0.06)
  .gain(0.34)
  .lpf(3600)
  .delay(0.18)
  .delaytime(0.25)
  .delayfeedback(0.22)
  .pan(0.22)
  .orbit(2)
  .every(4, x => x.add(12).gain(0.24));

const bass7 = n("0 0 3 2 4 6 3")
  .scale("G:dorian")
  .sub(24)
  .s("gm_synth_bass_1")
  .attack(0.01)
  .decay(0.24)
  .sustain(0.34)
  .release(0.07)
  .gain(0.54)
  .lpf(720)
  .orbit(2);

const pad = chord("<Gm7 ~ C7 ~ Bbmaj7 ~ Fmaj7 ~>")
  .voicing()
  .s("gm_pad_warm")
  .attack(1.2)
  .decay(0.4)
  .sustain(0.72)
  .release(3.2)
  .gain(0.24)
  .lpf(2100)
  .room(0.65)
  .roomsize(0.8)
  .orbit(2);

const drone = note("g2")
  .s("sine")
  .attack(2)
  .release(4)
  .gain(0.11)
  .lpf(430)
  .room(0.55)
  .orbit(2);

const shimmer = chord("<Gm7 C7 Bbmaj7 Fmaj7>")
  .voicing()
  .arp("0 2 1 3")
  .s("triangle")
  .fm(2)
  .attack(0.01)
  .decay(0.22)
  .sustain(0.18)
  .release(0.18)
  .gain(0.13)
  .hpf(900)
  .lpf(4200)
  .delay(0.22)
  .delaytime(0.5)
  .delayfeedback(0.28)
  .mask("<0 1 0 1>")
  .orbit(2);

arrange(
  [4, stack(pad, pulse4, hand3)],
  [8, stack(pad, pulse4, hand3, mallet5)],
  [16, stack(pad, drone, pulse4, hand3, mallet5, bass7)],
  [8, stack(pad, drone, hand3, mallet5, bass7, shimmer)]
)
