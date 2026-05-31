setcpm(118 / 4);

const chords = chord("<Cmaj7 Am7 Dm7 G7sus4>");

const pad = chords.voicing()
  .s("gm_pad_warm")
  .gain(0.6)
  .lpf(900)
  .release(1.5)
  .orbit(1);

const lead = chords.voicing()
  .arp("0 2 1 3")
  .s("gm_epiano1")
  .gain(0.7)
  .decay(0.2)
  .sustain(0.1)
  .release(0.4)
  .delay(0.25)
  .delayfeedback(0.5)
  .orbit(1);

const bass = note("<c2 a1 d2 g1>")
  .s("gm_synth_bass_1")
  .gain(0.8)
  .lpf(350);

const kick = s("bd!4")
  .bank("RolandTR909")
  .gain(1.1)
  .duckorbit(1)
  .duckdepth(0.65)
  .duckattack(0.04);

const snare = s("~ sd ~ sd")
  .bank("RolandTR909")
  .gain(0.8);

const hats = s("hh [hh oh] hh hh")
  .bank("RolandTR909")
  .gain("0.4 0.6 0.5 0.7");

stack(pad, lead, bass, kick, snare, hats)
