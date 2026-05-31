setcpm(122/4);

const drums = stack(
  s("bd ~ bd ~").bank("RolandTR909").gain(1.2).duckorbit(1),
  s("~ sd ~ sd").bank("RolandTR909").gain(0.95).room(0.3).orbit(1),
  s("hh hh hh hh").bank("RolandTR909").gain(0.7).pan("0.3 0.7").orbit(1),
  s("~ ~ ~ oh").bank("RolandTR909").gain(0.65).orbit(1)
);

const chords = chord("<Am7 Dm7 G7 Cmaj7>")
  .voicing()
  .s("gm_pad_warm")
  .gain(0.75)
  .lpf(sine.range(600, 1600).slow(4))
  .lpq(3)
  .room(0.5)
  .roomsize(0.8)
  .orbit(1)
  .duckdepth(0.45);

const bass = note("<a1 d2 g1 c2>")
  .s("gm_synth_bass_1")
  .gain(0.9)
  .lpf(700)
  .decay(0.15)
  .sustain(0.55)
  .orbit(1)
  .duckdepth(0.6);

const lead = chord("<Am7 Dm7 G7 Cmaj7>")
  .voicing()
  .arp("0 2 1 3")
  .s("supersaw")
  .gain(0.35)
  .add(12)
  .lpf(1300)
  .delay(0.5)
  .delaytime(0.375)
  .delayfeedback(0.4)
  .pan(sine.range(0.2, 0.8).slow(3))
  .orbit(1)
  .duckdepth(0.3);

stack(drums, chords, bass, lead);
