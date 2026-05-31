setcpm(120/4);

const drums = stack(
  s("bd ~ [~ bd] ~").bank("RolandTR808").gain(1.0).duckorbit(1).duckdepth(0.55),
  s("~ sd ~ sd").bank("RolandTR808").gain(0.85),
  s("hh*8").bank("RolandTR909").gain(0.65).pan(sine.range(0.25, 0.75).slow(4))
);

const chords = chord("<Am9 D9 Gmaj9 Cmaj9>")
  .voicing()
  .s("gm_pad_warm")
  .gain(0.55)
  .room(0.5)
  .orbit(1);

const bass = note("<a1 d2 g1 c2>")
  .s("gm_synth_bass_1")
  .gain(0.85)
  .orbit(1);

const lead = n("<0 2 4 7>*2")
  .scale("C:major")
  .add(12)
  .s("gm_epiano1")
  .gain(0.75)
  .delay(0.5)
  .delaytime(0.375)
  .delayfeedback(0.5)
  .orbit(1);

stack(drums, chords, bass, lead)
