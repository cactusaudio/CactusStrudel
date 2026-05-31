setcpm(122/4);

const kick = s("bd*4").bank("RolandTR909").gain(0.95).shape(0.25).duckorbit(1);

const clap = s("~ cp ~ cp").bank("RolandTR909").gain(0.55).room(0.35).roomsize(0.7).delay(0.12).delaytime(0.375).delayfeedback(0.2);

const hats = stack(
  s("hh*8").bank("RolandTR909").gain(sine.range(0.18, 0.32).slow(4)).pan(sine.range(0.35, 0.65).slow(7)).hpf(7000),
  s("~ oh ~ oh ~ oh ~ oh").bank("RolandTR909").gain(0.32).room(0.2).hpf(3500).clip(0.6)
);

const rim = s("~ ~ ~ ~ ~ ~ rim ~").bank("RolandTR909").gain(0.28).pan(0.7).room(0.25).delay(0.18).delaytime(0.1875).delayfeedback(0.25);

const crackle = s("white*16").gain(0.06).hpf(2200).lpf(9000);

const bass = note("<f1 f1 f1 [f1 ~ f1 c2] db1 db1 ab1 [ab1 ~ eb1 g1]>")
  .s("sine").fm(2)
  .lpf(sine.range(180, 520).slow(16))
  .lpq(4)
  .gain(0.78)
  .attack(0.005).decay(0.18).sustain(0.5).release(0.15)
  .orbit(2).duckorbit(1).duckattack(0.02).duckdepth(0.55);

const chords = chord("<Fm9 Dbmaj7 Abmaj7 Eb/G>/2")
  .voicing()
  .add(12)
  .s("gm_epiano1")
  .struct("~ ~ x ~ ~ ~ x ~ ~ ~ x ~ ~ ~ ~ ~")
  .attack(0.01).release(0.4)
  .gain(0.42)
  .lpf(2400)
  .room(0.55).roomsize(0.8)
  .delay(0.28).delaytime(0.1875).delayfeedback(0.42)
  .pan(0.42)
  .orbit(3).duckorbit(1).duckattack(0.04).duckdepth(0.25);

const pad = chord("<Fm9 Dbmaj7 Abmaj7 Eb/G>/2")
  .voicing()
  .s("gm_pad_warm")
  .attack(1.6).release(2.4)
  .gain(0.34)
  .lpf(sine.range(900, 1800).slow(24))
  .lpq(2)
  .room(0.7).roomsize(0.9)
  .orbit(4).duckorbit(1).duckattack(0.08).duckdepth(0.45);

const drone = note("<f2 f2 db2 ab2>/2")
  .s("sine").fm(1.5)
  .attack(2).release(3)
  .gain(0.22)
  .lpf(600)
  .room(0.6)
  .orbit(5).duckorbit(1).duckattack(0.1).duckdepth(0.3);

const ahh = note("<~ ~ ~ ~ ~ ~ ~ f4>/4")
  .s("gm_pad_warm")
  .attack(0.8).release(2.5)
  .gain(0.28)
  .lpf(1600)
  .room(0.8).roomsize(0.95)
  .delay(0.4).delaytime(0.375).delayfeedback(0.55)
  .pan(0.55)
  .orbit(6).duckorbit(1).duckattack(0.06).duckdepth(0.35);

arrange(
  [4, stack(kick, bass, drone, crackle)],
  [4, stack(kick, hats, bass, pad, drone, crackle)],
  [8, stack(kick, clap, hats, bass, chords, pad, drone, crackle)],
  [8, stack(kick, clap, hats, rim, bass, chords, pad, drone, ahh, crackle)],
  [8, stack(kick, clap, hats, rim, bass, chords, pad, drone, ahh, crackle)]
)
