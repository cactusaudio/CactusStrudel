setcpm(125/4);

const chords = chord("<Cm7 Abmaj7 Fm7 Bb9>")
  .voicing()
  .s("gm_pad_warm")
  .lpf(sine.range(500, 1200).slow(8))
  .gain(0.45)
  .room(0.6)
  .orbit(1);

const bass = note("<c2*2 ~ c2 eb2 ~ bb1 c2 ~>")
  .s("sawtooth")
  .lpf(400)
  .decay(0.15)
  .gain(0.75)
  .orbit(1);

const drums = stack(
  s("bd ~ ~ [bd bd]").bank("RolandTR909").gain(0.9),
  s("~ sd ~ sd").bank("RolandTR909").gain(0.75),
  s("hh*8").bank("RolandTR909").gain(sine.range(0.3, 0.8).slow(2))
).duckorbit(1).duckdepth(0.6);

const lead = n("<[0 2 3 ~] [7 5 3 ~] [8 7 5 ~] [10 8 7 12]>")
  .scale("c:minor")
  .s("piano")
  .gain(0.55)
  .delay(0.5)
  .delaytime(0.375)
  .delayfeedback(0.5)
  .room(0.3);

stack(chords, bass, drums, lead)
