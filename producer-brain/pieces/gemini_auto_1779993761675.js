setcpm(174/4);

const prog = "<Am9 Fmaj7 Cmaj7 G7>";

const kick = s("bd").bank("RolandTR909")
  .struct("x ~ ~ ~ ~ ~ x ~ ~ x ~ ~ ~ ~ [x ~] ~")
  .gain(0.88)
  .shape(0.18)
  .duckorbit(1)
  .duckattack(0.018)
  .duckdepth(0.72);

const snare = stack(
  s("sd").bank("RolandTR909")
    .struct("~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~")
    .gain(0.78)
    .room(0.18),
  s("cp").bank("RolandTR707")
    .struct("~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~")
    .gain(0.2)
    .hpf(1800)
    .room(0.34),
  s("sd").bank("LinnDrum")
    .struct("~ ~ x ~ ~ x ~ [x ~] ~ x ~ ~ ~ ~ x ~")
    .gain(0.14)
    .hpf(900)
    .lpf(5200)
    .room(0.24)
);

const hats = stack(
  s("hh").bank("RolandTR909")
    .struct("x*16")
    .gain(rand.range(0.1, 0.2).slow(2))
    .hpf(4800)
    .pan(sine.range(0.38, 0.62).slow(5)),
  s("hh").bank("RolandTR707")
    .struct("~ x ~ x ~ x ~ x ~ x ~ x ~ x ~ x")
    .gain(0.06)
    .hpf(6500)
    .pan(0.68),
  s("oh").bank("RolandTR909")
    .struct("~ ~ x ~ ~ ~ x ~ ~ ~ x ~ ~ ~ [x ~] ~")
    .gain(0.14)
    .hpf(4200)
    .release(0.18)
    .pan(0.32)
);

const perc = stack(
  s("rim").bank("RolandTR707")
    .struct("~ ~ ~ x ~ ~ ~ ~ ~ x ~ ~ ~ ~ x ~")
    .gain(0.12)
    .hpf(2200)
    .delay(0.16)
    .delaytime(0.1875)
    .delayfeedback(0.28),
  s("mt").bank("AlesisHR16")
    .struct("~ ~ ~ ~ ~ ~ [x ~] ~ ~ ~ ~ ~ ~ ~ x ~")
    .gain(0.09)
    .hpf(500)
    .lpf(2400)
    .room(0.28)
);

const drumsFull = stack(kick, snare, hats, perc);

const rhodes = chord(prog).voicing()
  .struct("x ~ [~ x] ~ x ~ ~ [x ~]")
  .off(0.375, x => x.add(12).gain(0.3))
  .s("gm_epiano1")
  .attack(0.01)
  .decay(0.28)
  .sustain(0.58)
  .release(0.8)
  .lpf(sine.range(1700, 4300).slow(8))
  .gain(0.42)
  .room(0.4)
  .roomsize(0.78)
  .delay(0.18)
  .delaytime(0.375)
  .delayfeedback(0.26)
  .orbit(1);

const pad = chord(prog).voicing()
  .slow(2)
  .s("gm_pad_warm")
  .attack(1.2)
  .decay(0.5)
  .sustain(0.72)
  .release(2.4)
  .lpf(sine.range(850, 3100).slow(12))
  .gain(0.28)
  .pan(sine.range(0.25, 0.75).slow(9))
  .room(0.75)
  .roomsize(0.92)
  .orbit(1);

const bassline = "<[a1 ~ a1 e2 ~ a1 g1 ~ a1 ~ c2 ~ e2 ~ g1 ~] [f1 ~ f1 c2 ~ f1 e1 ~ f1 ~ a1 ~ c2 ~ e1 ~] [c2 ~ c2 g1 ~ c2 e2 ~ c2 ~ g1 ~ e2 ~ d2 ~] [g1 ~ g1 d2 ~ g1 f2 ~ g1 ~ b1 ~ d2 ~ f2 ~]>";

const sub = stack(
  note(bassline)
    .s("sine")
    .attack(0.002)
    .decay(0.16)
    .sustain(0.5)
    .release(0.08)
    .lpf(115)
    .gain(0.62)
    .orbit(1),
  note(bassline)
    .s("gm_synth_bass_1")
    .attack(0.004)
    .decay(0.12)
    .sustain(0.42)
    .release(0.07)
    .lpf(540)
    .gain(0.2)
    .orbit(1)
);

const leadMotif = "<[~ 4 6 ~ 7 ~ 9 7] [~ 6 4 ~ 2 ~ 4 6] [~ 7 9 ~ 11 9 7 ~] [6 ~ 4 2 ~ 1 2 ~]>";

const lead = n(leadMotif).scale("A:minor")
  .add(12)
  .off(0.25, x => x.add(7).gain(0.34))
  .s("gm_flute")
  .attack(0.045)
  .decay(0.18)
  .sustain(0.38)
  .release(0.32)
  .lpf(sine.range(2400, 6200).slow(6))
  .gain(0.2)
  .pan(sine.range(0.42, 0.58).slow(4))
  .room(0.48)
  .delay(0.2)
  .delaytime(0.375)
  .delayfeedback(0.34)
  .orbit(1);

const glass = chord(prog).voicing()
  .arp("0 2 1 3 2 1 0 2")
  .fast(4)
  .jux(rev)
  .s("sine")
  .fm(3)
  .attack(0.01)
  .decay(0.12)
  .sustain(0.18)
  .release(0.36)
  .hpf(1400)
  .lpf(sine.range(3600, 7600).slow(10))
  .gain(0.09)
  .room(0.62)
  .roomsize(0.88)
  .delay(0.22)
  .delaytime(0.25)
  .delayfeedback(0.32)
  .mask("<0 1 1 1>")
  .orbit(1);

const air = s("pink")
  .struct("x ~ ~ ~")
  .attack(0.7)
  .decay(0.4)
  .sustain(0.25)
  .release(2.2)
  .hpf(2300)
  .lpf(perlin.range(3600, 7800).slow(14))
  .gain(perlin.range(0.035, 0.075).slow(8))
  .pan(sine.range(0.18, 0.82).slow(11))
  .room(0.82)
  .roomsize(0.95)
  .orbit(1);

const musicBed = stack(pad, rhodes, sub, air);

const intro = stack(
  pad.gain(1.05).lpf(2200),
  rhodes.mask("<1 0 1 0>").gain(0.75).lpf(1900),
  hats.mask("<0 1>").gain(0.42),
  glass.mask("<0 0 1 0>").gain(0.55),
  air.gain(1.15)
);

const drop = stack(
  drumsFull,
  musicBed,
  lead.mask("<0 1 0 1>").gain(0.78),
  glass.gain(0.72)
);

const breakdown = stack(
  pad.gain(1.15).lpf(2600),
  rhodes.mask("<1 1 0 1>").gain(0.85),
  hats.gain(0.32).mask("<1 0 1 1>"),
  snare.gain(0.22).hpf(1200),
  lead.mask("<1 0 1 0>").gain(0.62),
  glass.mask("<0 1 0 0>").gain(0.62),
  air.gain(1.3)
);

const peak = stack(
  drumsFull,
  musicBed,
  lead,
  glass.gain(0.95),
  perc.gain(1.18)
);

const outro = stack(
  pad.gain(0.95).lpf(1900),
  rhodes.mask("<1 0 0 1>").gain(0.68).lpf(1700),
  sub.gain(0.42).mask("<1 0 1 0>"),
  hats.mask("<1 0>").gain(0.28),
  air.gain(1.25)
);

arrange(
  [8, intro],
  [16, drop],
  [8, breakdown],
  [16, peak],
  [8, outro]
)
