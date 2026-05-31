setcpm(84/4);

const drums = stack(
  s("bd [~ bd] ~ bd").bank("RolandTR808").gain(0.9),
  s("~ sd ~ sd").bank("RolandTR808").gain(0.7).room(0.2),
  s("hh*8").bank("RolandTR808").gain(0.5).pan(sine.range(0.3, 0.7).slow(8))
);

const chords = chord("<Cmaj7 Am7 Dm9 G7>")
  .voicing()
  .arp("0 2 1 3")
  .s("gm_epiano1")
  .gain(0.8)
  .room(0.6)
  .delay(0.3)
  .delaytime(0.375)
  .delayfeedback(0.5);

const bass = note("<c2 a1 d2 g1>")
  .s("gm_acoustic_bass")
  .gain(0.95);

const lead = n("<~ 4 [7 9] 11 12 ~ 7 ~>")
  .scale("c:major")
  .s("triangle")
  .fm(3)
  .gain(0.3)
  .room(0.8)
  .delay(0.5)
  .delaytime(0.5)
  .delayfeedback(0.6);

stack(drums, chords, bass, lead);
