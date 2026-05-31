setcpm(120/4);

const drums = stack(
  s("bd ~ bd [bd bd]").bank("RolandTR909").duckorbit(1).duckdepth(0.65).duckattack(0.02).gain(0.9),
  s("~ sd ~ sd").bank("RolandTR909").gain(0.7),
  s("hh*8").bank("RolandTR909").gain(0.45),
  s("~ oh ~ oh").bank("RolandTR909").gain(0.5)
);

const chords = chord("<Cm9 Abmaj7 Fm9 G7>").voicing()
  .s("gm_epiano1")
  .gain(0.6)
  .room(0.4)
  .orbit(1);

const bass = n("<0 [~ 0] 5 7>").scale("c:minor")
  .add(36)
  .s("gm_synth_bass_1")
  .gain(0.75)
  .orbit(1);

const lead = note("<c4 eb4 g4 bb4 ab4 c5 eb5 g5>").slow(2)
  .s("supersaw")
  .gain(0.25)
  .lpf(sine.range(800, 2400).slow(4))
  .lpq(4)
  .delay(0.3).delaytime(0.375).delayfeedback(0.5)
  .room(0.5);

stack(drums, chords, bass, lead)
