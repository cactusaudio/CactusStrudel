setcpm(120/4);

const chords = chord("<Cm7 Abmaj7 Fm7 G7>")
  .voicing()
  .s("gm_pad_warm")
  .gain(0.5)
  .orbit(1)
  .lpf(sine.range(800, 1600).slow(8))
  .lpq(2)
  .delay(0.3)
  .delayfeedback(0.4);

const bass = note("<c2 [~ c2] eb2 [~ f2]>")
  .s("sawtooth")
  .gain(0.65)
  .orbit(1)
  .lpf(400)
  .lpq(4);

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(0.95)
  .duckorbit(1)
  .duckdepth(0.7)
  .duckattack(0.02);

const percussion = stack(
  s("~ sd ~ sd").bank("RolandTR909").gain(0.75),
  s("hh*8").bank("RolandTR909").gain(saw.range(0.2, 0.5).slow(4)),
  s("~ [~ oh] ~ ~").bank("RolandTR909").gain(0.4)
);

stack(chords, bass, kick, percussion);
