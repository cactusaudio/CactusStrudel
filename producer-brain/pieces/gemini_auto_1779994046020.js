setcpm(110/4);

const chords = chord("<F#m7 Dmaj7 Amaj7 E7>").voicing();

const pad = chords
  .s("gm_pad_warm")
  .attack(0.7)
  .sustain(0.75)
  .release(2.4)
  .lpf(sine.range(1200, 3400).slow(16))
  .room(0.75)
  .roomsize(0.9)
  .gain(0.5)
  .orbit(0);

const darkPad = chords
  .add(-12)
  .s("supersaw")
  .attack(1.2)
  .sustain(0.65)
  .release(3)
  .lpf(900)
  .detune(0.18)
  .room(0.85)
  .roomsize(0.95)
  .gain(0.18)
  .pan(0.35)
  .orbit(0);

const arp = chords
  .arp("0 1 2 3 2 1 0 2")
  .s("sawtooth")
  .attack(0.01)
  .decay(0.09)
  .sustain(0.18)
  .release(0.12)
  .lpf(sine.range(1600, 5200).slow(8))
  .delay(0.28)
  .delaytime(0.25)
  .delayfeedback(0.38)
  .room(0.25)
  .gain(0.28)
  .pan(sine.range(0.25, 0.75).slow(6))
  .orbit(0);

const bass = note("<[f#1 ~ f#1 c#2] [d1 ~ d2 a1] [a1 ~ a1 e2] [e1 ~ e2 b1]>")
  .s("gm_synth_bass_1")
  .attack(0.01)
  .decay(0.18)
  .sustain(0.42)
  .release(0.08)
  .lpf(850)
  .shape(0.22)
  .gain(0.72)
  .orbit(0);

const subBass = note("<f#1 d1 a0 e1>")
  .s("sine")
  .attack(0.02)
  .release(0.35)
  .lpf(180)
  .gain(0.28)
  .orbit(0);

const lead = note("<[~ f#4 a4 c#5] [e5 c#5 b4 a4] [~ d5 c#5 a4] [b4 c#5 e5 ~]>")
  .s("supersaw")
  .attack(0.02)
  .decay(0.16)
  .sustain(0.55)
  .release(0.38)
  .lpf(sine.range(1800, 6200).slow(8))
  .detune(0.22)
  .vib(0.04)
  .delay(0.38)
  .delaytime(0.375)
  .delayfeedback(0.42)
  .room(0.42)
  .roomsize(0.65)
  .gain(0.38)
  .pan(0.58)
  .orbit(0);

const highLead = note("<[~ ~ c#5 e5] [f#5 e5 c#5 ~] [~ d5 f#5 e5] [c#5 b4 a4 ~]>")
  .s("square")
  .fm(3)
  .attack(0.01)
  .decay(0.11)
  .sustain(0.35)
  .release(0.22)
  .lpf(3600)
  .delay(0.24)
  .delaytime(0.125)
  .delayfeedback(0.32)
  .gain(0.19)
  .pan(0.68)
  .orbit(0);

const kick = s("bd")
  .struct("x ~ ~ x ~ x ~ ~")
  .bank("LinnDrum")
  .shape(0.35)
  .gain(1.05)
  .duckorbit(0)
  .duckattack(0.025)
  .duckdepth(0.78);

const snare = s("sd")
  .struct("~ ~ x ~ ~ ~ x ~")
  .bank("LinnDrum")
  .decay(0.32)
  .room(0.9)
  .roomsize(0.18)
  .shape(0.62)
  .gain(0.82);

const clap = s("cp")
  .struct("~ ~ x ~ ~ ~ x [~ x]")
  .bank("RolandTR808")
  .decay(0.22)
  .room(0.55)
  .roomsize(0.32)
  .gain(0.24);

const hats = s("hh*16")
  .bank("RolandTR707")
  .decay(0.045)
  .hpf(5200)
  .gain(0.16)
  .pan(sine.range(0.32, 0.68).slow(4));

const openHat = s("oh")
  .struct("~ ~ ~ x ~ ~ ~ x")
  .bank("RolandTR808")
  .decay(0.22)
  .hpf(4200)
  .gain(0.2)
  .pan(0.72);

const rim = s("rim")
  .struct("~ x ~ ~ x ~ [~ x] ~")
  .bank("RolandTR707")
  .hpf(1800)
  .room(0.25)
  .gain(0.15)
  .pan(0.2);

const drums = stack(kick, snare, clap, hats, openHat, rim);

const intro = stack(
  pad,
  darkPad,
  arp.gain(0.55).mask("<0 1 1 1>"),
  subBass.mask("<0 0 1 1>"),
  kick.mask("<0 1>")
);

const verse = stack(
  pad,
  darkPad,
  arp,
  bass,
  subBass,
  kick,
  snare,
  hats,
  openHat.mask("<0 1>"),
  rim.mask("<0 1 0 1>")
);

const chorus = stack(
  pad.gain(1.12),
  darkPad.gain(1.25),
  arp.gain(1.15),
  bass.gain(1.05),
  subBass,
  drums,
  lead,
  highLead.mask("<0 1 1 1>")
);

const breakdown = stack(
  pad.gain(0.85),
  darkPad.gain(1.35),
  arp.gain(0.62).lpf(1800),
  lead.gain(0.5).mask("<1 0 1 0>"),
  s("sd")
    .struct("~ ~ x ~ ~ ~ x ~")
    .bank("LinnDrum")
    .decay(0.45)
    .room(0.95)
    .roomsize(0.22)
    .shape(0.5)
    .gain(0.42)
);

const finale = stack(
  pad.gain(1.18),
  darkPad.gain(1.3),
  arp.gain(1.25),
  bass.gain(1.12),
  subBass,
  drums,
  lead.gain(1.1),
  highLead.gain(1.2),
  chords
    .arp("3 2 1 0 1 2 3 2")
    .add(12)
    .s("triangle")
    .attack(0.005)
    .decay(0.08)
    .sustain(0.2)
    .release(0.12)
    .lpf(5200)
    .delay(0.32)
    .delaytime(0.1875)
    .delayfeedback(0.35)
    .gain(0.16)
    .pan(sine.range(0.75, 0.25).slow(5))
    .orbit(0)
);

arrange(
  [8, intro],
  [16, verse],
  [16, chorus],
  [8, breakdown],
  [16, finale]
)
