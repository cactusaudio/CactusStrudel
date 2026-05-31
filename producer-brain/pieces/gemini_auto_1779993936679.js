setcpm(118/4);

const progression = chord("<Dm9 Gm9 Bbmaj7 A7>");

const kick = s("bd bd bd bd")
  .bank("RolandTR808")
  .gain(0.47)
  .lpf(1050)
  .decay(0.32)
  .shape(0.08)
  .room(0.08)
  .duckorbit(1)
  .duckattack(0.035)
  .duckdepth(0.34);

const shaker = s("[hh hh] [hh hh] [hh hh] [hh hh]")
  .bank("RolandTR707")
  .gain(0.105)
  .hpf(4800)
  .lpf(9800)
  .decay(0.035)
  .pan(perlin.range(-0.22, 0.22).slow(6))
  .room(0.18);

const brush = s("~ rim ~ [sd rim]")
  .bank("LinnDrum")
  .gain(0.16)
  .hpf(950)
  .lpf(6200)
  .decay(0.12)
  .room(0.32)
  .pan(0.12);

const openHat = s("~ oh ~ oh")
  .bank("RolandTR909")
  .gain(0.065)
  .hpf(5200)
  .decay(0.08)
  .pan(-0.18)
  .room(0.22);

const drums = stack(kick, shaker, brush, openHat);

const rhodes = progression
  .voicing()
  .struct("[x ~] ~ [~ x] [x ~]")
  .s("gm_epiano1")
  .attack(0.025)
  .decay(0.18)
  .sustain(0.55)
  .release(0.85)
  .gain(0.46)
  .lpf(sine.range(1400, 2600).slow(8))
  .room(0.42)
  .roomsize(0.65)
  .pan(perlin.range(-0.12, 0.08).slow(8))
  .orbit(1);

const rhodesArp = progression
  .voicing()
  .arp("0 1 2 3 2 1")
  .fast(2)
  .s("gm_epiano1")
  .attack(0.01)
  .release(0.28)
  .gain(0.18)
  .lpf(3600)
  .delay(0.18)
  .delaytime(0.375)
  .delayfeedback(0.26)
  .room(0.34)
  .pan(0.2)
  .mask("<0 1 1 1>")
  .orbit(1);

const pad = progression
  .voicing()
  .s("gm_pad_warm")
  .attack(0.7)
  .release(2.4)
  .gain(0.18)
  .lpf(sine.range(700, 2100).slow(12))
  .room(0.7)
  .roomsize(0.86)
  .pan(-0.05)
  .orbit(1);

const bass = note("<[d2 ~ a1 d2] [g1 ~ d2 f2] [bb1 ~ f2 a1] [a1 ~ e2 g1]>")
  .s("gm_acoustic_bass")
  .attack(0.015)
  .decay(0.16)
  .sustain(0.28)
  .release(0.12)
  .gain(0.52)
  .lpf(760)
  .room(0.12)
  .pan(-0.04)
  .orbit(1);

const leadNotes = note("<~ [f4 a4] c5 [a4 g4] d5 [c5 a4] ~ [g4 f4] ~ [a4 c5] [d5 c5] a4>");

const lead = stack(
  leadNotes
    .s("gm_flute")
    .attack(0.08)
    .release(0.48)
    .gain(0.31)
    .lpf(sine.range(2400, 4300).slow(5))
    .vib(0.16)
    .room(0.52)
    .pan(0.16),
  leadNotes
    .s("triangle")
    .fm(3)
    .attack(0.06)
    .release(0.34)
    .gain(0.09)
    .lpf(2200)
    .vib(0.1)
    .room(0.38)
    .pan(0.2)
)
  .mask("<0 0 1 1 1 0 1 1>")
  .orbit(1);

const intro = stack(shaker, brush, rhodes, pad);
const groove = stack(drums, rhodes, bass, pad);
const solo = stack(drums, rhodes, rhodesArp, bass, pad, lead);
const breakdown = stack(shaker.gain(0.75), brush, rhodes, pad.gain(1.25), lead.mask("<1 1 0 1>"));
const outro = stack(kick.gain(0.72), shaker, rhodes, bass, pad.gain(0.72));

arrange(
  [4, intro],
  [8, groove],
  [8, solo],
  [4, breakdown],
  [8, solo],
  [4, outro]
)
