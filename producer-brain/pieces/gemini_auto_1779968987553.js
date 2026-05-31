setcpm(108/4);

const pad = chord("<C G Am F>")
  .voicing()
  .s("gm_pad_warm")
  .attack(0.25)
  .release(0.65)
  .gain(0.5)
  .lpf(800)
  .orbit(1);

const bass = note("<c2 g2 a1 f2>")
  .struct("x ~ x ~ ~ x x ~")
  .s("gm_synth_bass_1")
  .decay(0.12)
  .sustain(0.05)
  .release(0.12)
  .gain(0.8)
  .orbit(1);

const lead = n("<[~ 0 4 7] [9 7 ~ 4] [7 4 ~ 2] [0 2 4 7]>")
  .scale("C:major")
  .add(12)
  .s("triangle")
  .decay(0.1)
  .sustain(0.02)
  .release(0.12)
  .gain(0.6)
  .delay(0.3)
  .delaytime(0.375)
  .delayfeedback(0.4)
  .orbit(1);

const kick = s("bd!4")
  .bank("RolandTR909")
  .gain(0.9)
  .duckorbit(1)
  .duckdepth(0.5)
  .duckattack(0.05);

const snare = s("~ cp ~ cp")
  .bank("RolandTR909")
  .gain(0.7);

const hats = s("~ oh ~ oh")
  .bank("RolandTR909")
  .gain(0.5);

const shaker = s("hh*8")
  .bank("RolandTR909")
  .gain(0.35)
  .pan(sine.range(0.3, 0.7).slow(4));

const intro = stack(
  pad.lpf(600),
  shaker.gain(0.15)
);

const groove = stack(
  kick,
  snare,
  hats,
  shaker,
  bass,
  lead,
  pad
);

const breakSec = stack(
  hats,
  shaker,
  bass.gain(0.4),
  lead.lpf(1000).every(4, x => x.palindrome()),
  pad
);

const drop = stack(
  kick,
  snare,
  hats,
  shaker,
  bass,
  lead.gain(0.65).every(4, x => x.palindrome()),
  pad.lpf(1200)
);

arrange(
  [4, intro],
  [8, groove],
  [4, breakSec],
  [8, drop]
);
