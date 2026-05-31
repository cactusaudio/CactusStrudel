setcpm(140/4);

const kick = s("bd")
  .bank("RolandTR909")
  .struct("<x ~ ~ x ~ x ~ ~ x ~ x ~ ~ x ~ x>")
  .gain(1.15)
  .shape(0.25)
  .duckorbit(1)
  .duckattack(0.03)
  .duckdepth(0.75);

const snare = s("sd")
  .bank("RolandTR909")
  .struct("~ ~ x ~ ~ ~ x ~")
  .gain(0.72)
  .room(0.25)
  .shape(0.18);

const claps = s("cp")
  .bank("RolandTR707")
  .struct("<~ ~ ~ x ~ ~ ~ ~ ~ ~ x ~ ~ [x ~] ~ ~>")
  .gain(0.45)
  .hpf(900)
  .room(0.35)
  .delay(0.18)
  .delayfeedback(0.25);

const hats = s("<hh [hh hh] hh [hh hh hh]>")
  .bank("RolandTR808")
  .gain("<0.34 0.22 0.28 0.42>")
  .hpf(5200)
  .pan(rand.range(0.15, 0.85).slow(2))
  .every(3, x => x.fast(2))
  .every(5, x => x.palindrome())
  .room(0.18);

const openhats = s("oh")
  .bank("RolandTR909")
  .struct("<~ x ~ ~ ~ ~ x ~>")
  .gain(0.38)
  .hpf(3600)
  .decay(0.08)
  .pan(0.7);

const toms = s("lt mt ht")
  .bank("AlesisHR16")
  .struct("<~ ~ ~ ~ x ~ ~ [x x] ~ x ~ ~ ~ ~ [x ~] ~>")
  .gain(0.42)
  .speed("<0.8 1 1.25 1.5>")
  .pan("<0.25 0.5 0.75>")
  .room(0.3);

const bass = n("<0 0 [3 5] 0 7 5 [3 2] 0>")
  .scale("d:dorian")
  .sub(24)
  .s("saw")
  .lpf(perlin.range(180, 820).slow(6))
  .lpq(0.35)
  .gain(0.64)
  .decay(0.16)
  .sustain(0.25)
  .release(0.08)
  .orbit(1)
  .shape(0.32)
  .every(4, x => x.off(0.125, y => y.add(12).gain(0.35)))
  .every(7, x => x.fast(2));

const acid = n("<0 [2 3] 5 [7 10] 12 [10 7] 5 [3 2]>")
  .scale("d:dorian")
  .s("square")
  .fm("<2 3 4 6>")
  .lpf(sine.range(550, 3200).slow(4))
  .lpq(0.6)
  .gain(0.32)
  .attack(0.005)
  .decay(0.08)
  .sustain(0.15)
  .release(0.04)
  .pan(saw.range(0.2, 0.8).slow(3))
  .delay(0.22)
  .delaytime(0.1875)
  .delayfeedback(0.32)
  .orbit(1)
  .every(6, x => x.palindrome())
  .every(8, x => x.add(12));

const bleeps = n("<12 10 7 5 [3 5] 2 0 [7 10]>")
  .scale("d:dorian")
  .s("sine")
  .fm("<5 9 13 17>")
  .fast(2)
  .gain(rand.range(0.08, 0.28).slow(1))
  .pan(rand.range(0.05, 0.95))
  .decay(0.05)
  .release(0.03)
  .lpf(rand.range(900, 6200).slow(2))
  .crush("<2 3 4 6>")
  .delay(0.35)
  .delaytime(0.125)
  .delayfeedback(0.45)
  .every(5, x => x.off(0.0625, y => y.add(7).gain(0.5)))
  .every(9, x => x.jux(rev));

const chordstab = chord("<Dm9 G13 Am7 Cmaj7>")
  .voicing()
  .arp("<0 2 1 3 2 0 1 2>")
  .s("supersaw")
  .gain(0.22)
  .attack(0.01)
  .decay(0.14)
  .sustain(0.22)
  .release(0.18)
  .lpf(perlin.range(700, 2800).slow(8))
  .lpq(0.4)
  .pan(sine.range(0.25, 0.75).slow(5))
  .delay(0.3)
  .delaytime(0.25)
  .delayfeedback(0.35)
  .room(0.45)
  .orbit(1)
  .every(4, x => x.fast(2))
  .every(11, x => x.palindrome());

const pad = chord("<Dm9 Fmaj7 G13 Am7>")
  .voicing()
  .s("gm_pad_warm")
  .gain(0.28)
  .attack(0.7)
  .release(1.5)
  .lpf(tri.range(900, 4200).slow(12))
  .room(0.65)
  .roomsize(0.8)
  .pan(sine.range(0.1, 0.9).slow(9))
  .orbit(1);

const noise = s("white")
  .struct("<~ ~ x ~ ~ x ~ ~>")
  .gain(0.08)
  .hpf(7200)
  .decay(0.025)
  .release(0.02)
  .pan(rand.range(0, 1))
  .every(4, x => x.fast(4));

const drums = stack(kick, snare, claps, hats, openhats, toms);
const synths = stack(bass, acid, bleeps, chordstab, pad, noise);

arrange(
  [4, stack(kick, hats, bass, bleeps.gain(0.12))],
  [4, stack(kick, snare, hats, bass, acid, noise)],
  [8, stack(drums, bass, acid, bleeps, chordstab)],
  [4, stack(kick, hats.fast(2), openhats, bass.every(2, x => x.add(12)), bleeps.jux(rev), noise.fast(2))],
  [8, stack(drums, synths)],
  [4, stack(kick, claps, hats, toms, bass, acid.fast(2), bleeps, chordstab.every(2, x => x.add(12)))],
  [8, stack(drums, synths.every(4, x => x.jux(rev)))]
);
