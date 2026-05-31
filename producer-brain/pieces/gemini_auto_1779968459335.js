setcpm(110/4);

const padChords = "<Cm9 Bbmaj7 Abmaj7 G7>";

const pad = chord(padChords).voicing()
  .s("gm_pad_warm")
  .attack(0.8).decay(1).sustain(0.7).release(2)
  .room(0.8).roomsize(0.85)
  .pan(sine.range(0.3, 0.7).slow(4))
  .gain(0.8)
  .orbit(1);

const arp = chord(padChords).voicing()
  .arp("0 1 2 3 2 1 0 1")
  .s("sine").fm(3)
  .attack(0.01).decay(0.15).sustain(0).release(0.2)
  .delay(0.5).delaytime(0.33).delayfeedback(0.6)
  .pan(perlin.range(0.1, 0.9).slow(2))
  .gain(0.7)
  .orbit(1);

const bass = n("[c2 ~ c2 ~] [~ bb1 bb1 ~] [ab1 ~ ab1 ~] [~ g1 g1 d2]")
  .s("triangle").fm(2)
  .lpf(saw.range(2000, 300).fast(4))
  .lpq(3)
  .attack(0.01).decay(0.3).sustain(0.1).release(0.5)
  .gain(1.1)
  .orbit(1);

const kick = s("bd ~ ~ bd ~ bd ~ ~").bank("RolandTR808")
  .duckorbit(1).duckdepth(0.8).duckattack(0.01)
  .gain(1.4);

const hats = s("hh*16").bank("RolandTR808")
  .pan(perlin.range(0.2, 0.8).fast(2))
  .gain(sine.range(0.4, 0.8).fast(8))
  .room(0.1);

const snare = s("~ sd ~ [sd cp]").bank("RolandTR808")
  .room(0.4).roomsize(0.6)
  .gain(1.1);

const glitch = s("[rim*3 ~] [ht mt] [~ lt*2] [rim ~ rim rim]").bank("RolandTR909")
  .speed(rand.range(0.8, 1.4))
  .pan(rand)
  .gain(0.65)
  .orbit(1);

const drums = stack(kick, hats, snare, glitch);

arrange(
  [4, pad],
  [4, stack(pad, arp)],
  [4, stack(pad, arp, kick)],
  [8, stack(pad, arp, drums, bass)],
  [8, stack(
    pad,
    arp.fast(2).jux(rev),
    drums,
    bass.superimpose(x => x.add(12).gain(0.6))
  )],
  [4, stack(pad, arp, kick, bass)],
  [4, pad.jux(rev)]
)
