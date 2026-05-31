setcpm(174/4);

const drums = stack(
  s("[bd ~ ~ ~ sd ~ ~ bd ~ bd sd ~ ~ ~ sd ~]").bank("RolandTR909").duckorbit(1).duckdepth(0.85).duckattack(0.01),
  s("[hh ~ hh hh]*4").bank("RolandTR909").gain(0.6)
);

const reese = note("<[a2,e3] ~ ~ ~ ~ ~ ~ ~ [d3,a3] ~ ~ ~ ~ ~ ~ ~>")
  .s("supersaw")
  .detune(16)
  .lpf(650)
  .decay(0.3)
  .sustain(0.25)
  .release(0.3)
  .gain(0.75)
  .orbit(1);

const pad = chord("<Am7 D7>")
  .voicing()
  .s("gm_pad_warm")
  .gain(0.4)
  .lpf(900)
  .orbit(1);

const lead = n("0 2 3 5 7 5 3 2")
  .scale("a:dorian")
  .s("piano")
  .gain(0.5)
  .delay(0.25)
  .delayfeedback(0.3)
  .orbit(1);

stack(drums, reese, pad, lead);
