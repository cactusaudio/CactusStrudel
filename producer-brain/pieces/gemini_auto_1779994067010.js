setcpm(130/4);

const changes = chord("<Dm9 Gm9 Bbmaj7 A7>").voicing();

const kick = s("bd ~ [~ bd] ~ bd [~ bd] ~ [bd ~]")
  .bank("RolandTR909")
  .gain(0.95)
  .shape(0.22)
  .clip(0.9)
  .duckorbit(1)
  .duckattack(0.025)
  .duckdepth(0.55);

const snare = stack(
  s("~ [~ sd] ~ sd ~ [sd ~] [~ rim] ~")
    .bank("RolandTR909")
    .gain(0.72)
    .room(0.18)
    .roomsize(0.35),
  s("~ ~ ~ cp ~ ~ [cp ~] ~")
    .bank("RolandTR707")
    .gain(0.34)
    .hpf(1200)
    .room(0.22)
);

const hatGrid = stack(
  s("hh*11")
    .bank("RolandTR909")
    .gain(rand.range(0.045, 0.12))
    .hpf(5200)
    .pan(sine.range(-0.55, 0.55).slow(3)),
  s("hh*7")
    .bank("RolandTR707")
    .gain(rand.range(0.035, 0.09))
    .hpf(6200)
    .pan(tri.range(0.45, -0.45).slow(5)),
  s("[~ hh] [hh ~] [~ hh hh] [hh ~]")
    .bank("LinnDrum")
    .gain(0.11)
    .hpf(4700)
    .pan(perlin.range(-0.35, 0.35).slow(4))
).mask("<1 1 0 1 1 1 0 1>");

const openHat = s("~ oh ~ [~ oh] ~ ~ [oh ~] ~")
  .bank("RolandTR909")
  .gain(0.22)
  .hpf(4300)
  .release(0.18)
  .pan(0.18);

const perc = stack(
  s("rim [~ rim] ~ [rim ~] ~ [~ rim] rim ~")
    .bank("AlesisHR16")
    .gain(0.16)
    .hpf(1600)
    .pan(-0.28),
  s("~ lt ~ [mt ~] ~ [~ ht] ~ mt")
    .bank("RolandTR808")
    .gain(0.18)
    .speed("<1 1.25 0.8 1.5>")
    .lpf(1800)
    .pan(0.32)
);

const drums = stack(kick, snare, hatGrid, openHat, perc)
  .room(0.12)
  .roomsize(0.42);

const keys = changes
  .s("gm_epiano1")
  .struct("<[x ~ x] [~ x ~ x] [x x ~] [~ x x ~]>")
  .attack(0.01)
  .decay(0.34)
  .sustain(0.42)
  .release(0.28)
  .gain(0.56)
  .lpf(sine.range(1800, 5200).slow(6))
  .lpq(0.8)
  .pan(perlin.range(-0.18, 0.18).slow(8))
  .room(0.32)
  .delay(0.16)
  .delaytime(0.375)
  .delayfeedback(0.22);

const keysSparse = changes
  .s("gm_epiano1")
  .struct("x ~ ~ [~ x]")
  .attack(0.02)
  .decay(0.55)
  .sustain(0.5)
  .release(0.5)
  .gain(0.48)
  .lpf(3600)
  .room(0.42)
  .delay(0.2)
  .delaytime(0.5)
  .delayfeedback(0.28);

const pad = chord("<Dm9 Bbmaj7 Gm9 A7>").voicing()
  .s("gm_pad_warm")
  .slow(2)
  .attack(0.8)
  .release(2.4)
  .gain(0.34)
  .lpf(sine.range(900, 2600).slow(8))
  .pan(sine.range(-0.22, 0.22).slow(12))
  .room(0.55)
  .roomsize(0.82);

const arp = changes
  .arp("0 [2 3] 1 [3 2]")
  .s("sine")
  .fm(3)
  .attack(0.006)
  .decay(0.14)
  .sustain(0.1)
  .release(0.12)
  .gain(0.22)
  .lpf(saw.range(1200, 4600).slow(5))
  .pan(tri.range(-0.42, 0.42).slow(4))
  .delay(0.24)
  .delaytime(0.25)
  .delayfeedback(0.31);

const stab = changes
  .s("saw")
  .struct("~ [x ~] ~ [~ x]")
  .attack(0.004)
  .decay(0.12)
  .sustain(0)
  .release(0.08)
  .gain(0.17)
  .lpf(1400)
  .lpq(1.6)
  .pan(-0.12);

const acousticBass = n("<[0 ~ [0 2] ~ 5 ~ [4 3] ~] [3 ~ [3 5] ~ 7 [5 ~] ~ 3] [5 ~ [5 7] ~ 9 ~ [7 5] ~] [4 ~ [4 6] ~ 8 [7 ~] ~ 4]>")
  .scale("D:minor")
  .sub(24)
  .s("gm_acoustic_bass")
  .attack(0.008)
  .decay(0.22)
  .sustain(0.34)
  .release(0.12)
  .gain(0.58)
  .lpf(1250)
  .room(0.08)
  .pan(-0.06);

const subBass = n("<[0 ~ ~ 0] [3 ~ ~ 3] [5 ~ ~ 5] [4 ~ ~ 4]>")
  .scale("D:minor")
  .sub(36)
  .s("sine")
  .attack(0.01)
  .release(0.18)
  .gain(0.24)
  .lpf(180);

const bass = stack(acousticBass, subBass).orbit(1);

const lead = n("<[~ ~ 7 9] [10 ~ 9 7] [~ 5 7 ~] [12 10 ~ 9]>")
  .scale("D:minor")
  .add(12)
  .s("gm_flute")
  .attack(0.04)
  .decay(0.22)
  .sustain(0.58)
  .release(0.38)
  .gain(0.28)
  .vib(0.18)
  .lpf(3600)
  .pan(0.26)
  .room(0.36)
  .delay(0.18)
  .delaytime(0.375)
  .delayfeedback(0.26)
  .off(0.25, x => x.add(7).gain(0.18))
  .mask("<0 1 1 1>");

const music = stack(pad, keys, bass, arp, stab).orbit(1);
const intro = stack(pad.orbit(1), keysSparse.orbit(1), hatGrid.gain(0.42), perc.gain(0.28));
const main = stack(drums, music);
const mainLead = stack(drums, music, lead.orbit(1));
const breakDown = stack(
  pad.gain(0.85).orbit(1),
  keysSparse.orbit(1),
  bass.gain(0.72),
  snare.gain(0.32),
  perc.gain(0.38),
  lead.gain(0.7).orbit(1)
);
const outro = stack(pad.gain(0.72).orbit(1), keysSparse.orbit(1), hatGrid.gain(0.28), openHat.gain(0.18));

arrange(
  [8, intro],
  [16, main],
  [16, mainLead],
  [8, breakDown],
  [16, mainLead],
  [8, outro]
)
