setcpm(108/4);

const pad = chord("<Am F C G>")
  .voicing()
  .s("gm_pad_warm")
  .gain(0.55)
  .lpf(sine.range(800, 1600).slow(8))
  .release(1.5);

const bass = note("<a1 f1 c2 g1>")
  .struct("x ~ x x ~ x ~ x")
  .s("gm_synth_bass_1")
  .lpf(400)
  .decay(0.18)
  .sustain(0.1)
  .gain(0.7);

const lead = note("<[e5 ~ g5 a5 ~ e5 d5 ~] [f5 ~ a5 c6 ~ a5 f5 ~] [e5 ~ g5 c6 ~ g5 e5 ~] [d5 ~ g5 b5 ~ g5 d5 ~]>")
  .s("sine")
  .fm(3.5)
  .decay(0.12)
  .sustain(0.04)
  .release(0.1)
  .gain(0.75)
  .delay(0.25)
  .delayfeedback(0.35)
  .delaytime(0.375)
  .room(0.3)
  .pan(sine.range(-0.3, 0.3).slow(8));

const kick = s("bd*4").bank("RolandTR909").gain(0.9);
const snare = s("~ sd ~ sd").bank("RolandTR909").gain(0.7);
const hats = s("~ hh ~ hh").bank("RolandTR909").gain(0.6).hpf(1000);
const shaker = s("~ [rim*2] ~ rim").bank("RolandTR909").gain(0.35).hpf(1200);

const intro = stack(
  pad.lpf(800),
  lead.lpf(1000).gain(0.5),
  shaker.gain(0.2)
);

const groove = stack(
  pad,
  bass,
  lead,
  kick,
  snare,
  hats,
  shaker
);

const breakPart = stack(
  pad.lpf(1500),
  lead,
  shaker.gain(0.2)
);

const drop = stack(
  pad.orbit(1),
  bass.orbit(1),
  lead.orbit(1),
  kick.duckorbit(1).duckdepth(0.6).duckattack(0.05),
  snare,
  hats,
  shaker
);

arrange(
  [4, intro],
  [8, groove],
  [4, breakPart],
  [8, drop]
);
