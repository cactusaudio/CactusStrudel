setcpm(124/4);

const changes = chord("<Fmaj7 Dm9 Gm9 C9 Bbmaj7 Am7 Gm9 C9>");

const kick = s("bd bd bd bd")
  .bank("RolandTR909")
  .gain(0.82)
  .shape(0.18)
  .duckorbit(1)
  .duckattack(0.035)
  .duckdepth(0.72);

const hats = stack(
  s("hh*8")
    .bank("RolandTR909")
    .gain("[0.12 0.06 0.09 0.06]*2")
    .hpf(5200)
    .pan(sine.range(0.42,0.58).slow(8)),
  s("~ oh ~ oh")
    .bank("RolandTR909")
    .gain(0.18)
    .hpf(4200)
    .decay(0.18)
);

const brushedSnare = stack(
  s("~ sd ~ sd")
    .bank("LinnDrum")
    .gain(0.34)
    .hpf(1400)
    .lpf(7600)
    .room(0.16)
    .roomsize(0.42),
  s("sd*16")
    .bank("RolandTR707")
    .gain("<0.035 0.05 0.04 0.065>")
    .hpf(3600)
    .lpf(9800)
    .attack(0.01)
    .decay(0.06)
    .pan(perlin.range(0.35,0.65).slow(3))
);

const perc = stack(
  s("~ rim ~ [rim ~] ~ rim ~ [~ rim]")
    .bank("RolandTR707")
    .gain(0.12)
    .hpf(1800)
    .room(0.12)
    .delay(0.08)
    .delaytime(0.25)
    .delayfeedback(0.18),
  s("~ ~ cp ~")
    .bank("AlesisHR16")
    .gain(0.09)
    .hpf(2600)
    .room(0.18)
);

const drums = stack(kick, hats, brushedSnare, perc);

const bass = note("<f2 a2 c3 d3 eb3 e3 f3 c3 d2 f2 a2 c3 bb2 a2 g2 e2 g2 bb2 d3 f3 e3 c3 a2 g2 c2 e2 g2 bb2 a2 g2 e2 c2>")
  .s("gm_acoustic_bass")
  .gain(0.48)
  .attack(0.01)
  .decay(0.18)
  .sustain(0.42)
  .release(0.08)
  .lpf(1150)
  .lpq(1.2)
  .orbit(1);

const pianoStabs = changes
  .voicing()
  .arp("<[0 2] [1 3] [0 1] [2 3]>")
  .s("piano")
  .gain(0.34)
  .attack(0.008)
  .decay(0.22)
  .sustain(0.18)
  .release(0.12)
  .lpf(perlin.range(2400,5200).slow(6))
  .room(0.18)
  .roomsize(0.55)
  .delay(0.12)
  .delaytime(0.375)
  .delayfeedback(0.26)
  .pan(sine.range(0.36,0.64).slow(12))
  .orbit(1);

const warmPad = changes
  .voicing()
  .s("gm_pad_warm")
  .gain(0.18)
  .attack(0.7)
  .release(1.4)
  .lpf(sine.range(900,2400).slow(16))
  .room(0.34)
  .roomsize(0.8)
  .pan(tri.range(0.28,0.72).slow(24))
  .orbit(1);

const rhodes = changes
  .voicing()
  .arp("<0 1 2 3 2 1 0 2>")
  .s("gm_epiano1")
  .gain(0.22)
  .attack(0.02)
  .decay(0.28)
  .sustain(0.22)
  .release(0.16)
  .lpf(3600)
  .room(0.22)
  .delay(0.18)
  .delaytime(0.5)
  .delayfeedback(0.24)
  .pan(sine.range(0.25,0.75).slow(10))
  .orbit(1);

const fluteHook = n("<0 2 4 5 4 2 0 ~ 5 7 9 7 5 4 2 ~ 4 5 7 9 7 5 4 2 9 7 5 4 2 0 ~ ~>")
  .scale("F:major")
  .s("gm_flute")
  .gain(0.16)
  .attack(0.04)
  .release(0.24)
  .vib(0.08)
  .lpf(4400)
  .room(0.26)
  .delay(0.16)
  .delaytime(0.25)
  .delayfeedback(0.28)
  .pan(0.58)
  .mask("<0 0 1 1>")
  .orbit(1);

const intro = stack(
  kick.gain(0.62),
  hats.gain(0.7),
  warmPad.gain(0.22),
  rhodes.gain(0.14)
);

const main = stack(
  drums,
  bass,
  pianoStabs,
  warmPad,
  rhodes
);

const breakSection = stack(
  hats.gain(0.45),
  brushedSnare.gain(0.35),
  warmPad.gain(0.32),
  rhodes.gain(0.26),
  fluteHook.gain(0.24)
);

const peak = stack(
  drums,
  bass.gain(0.54),
  pianoStabs.gain(0.42),
  warmPad.gain(0.22),
  rhodes.gain(0.28),
  fluteHook
);

arrange(
  [8, intro],
  [16, main],
  [8, breakSection],
  [16, peak]
);
