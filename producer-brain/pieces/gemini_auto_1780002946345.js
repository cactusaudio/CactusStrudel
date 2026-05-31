setcpm(122/4);

const chords = chord("<Fm9 Dbmaj7 Abmaj7 Eb6>")
  .voicing()
  .s("gm_epiano1")
  .attack(0.01).release(0.4)
  .lpf(sine.range(800, 2600).slow(8))
  .room(0.4).roomsize(3)
  .gain(0.6)
  .orbit(2);

const pad = chord("<Fm9 Dbmaj7 Abmaj7 Eb6>")
  .voicing()
  .s("gm_pad_warm")
  .attack(1.2).release(2)
  .lpf(900)
  .room(0.6).roomsize(5)
  .gain(0.4)
  .orbit(2);

const bass = n("<0 0 5 4>")
  .scale("F2:minor")
  .s("gm_synth_bass_1")
  .struct("x ~ x ~ x ~ x x")
  .attack(0.01).decay(0.2).sustain(0.3).release(0.1)
  .lpf(sine.range(500, 1400).slow(4))
  .gain(0.8)
  .orbit(3);

const lead = n("<7 6 5 7 9 7 5 4>")
  .scale("F4:minor")
  .s("triangle")
  .off(0.25, x => x.add(12).gain(0.4))
  .struct("x ~ ~ x ~ x ~ ~")
  .attack(0.01).release(0.3)
  .lpf(2400)
  .delay(0.3).delaytime(0.375).delayfeedback(0.3)
  .room(0.5).roomsize(4)
  .gain(0.5)
  .orbit(2);

const kick = s("bd*4").bank("RolandTR909")
  .gain(0.95)
  .duckorbit(2).duckattack(0.01).duckdepth(0.7);

const clap = s("~ cp ~ cp").bank("RolandTR909")
  .gain(0.6).room(0.3);

const hats = s("hh*8").bank("RolandTR909")
  .gain(saw.range(0.2, 0.5).fast(8))
  .pan(sine.range(0.3, 0.7).fast(4))
  .hpf(7000);

const openhat = s("~ ~ oh ~").bank("RolandTR909")
  .gain(0.35).hpf(6000);

stack(
  kick,
  clap,
  hats,
  openhat,
  bass,
  chords,
  pad,
  lead
)
