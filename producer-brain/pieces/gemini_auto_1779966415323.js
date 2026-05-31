setcpm(92/4);

const prog = "<Am F C G>";

const pad = chord(prog).voicing()
  .s("gm_pad_warm")
  .attack(1.2).release(2.6)
  .lpf(sine.range(900, 2100).slow(12))
  .room(0.78).gain(0.42)
  .duckorbit(1).duckdepth(0.22);

const bass = chord(prog).voicing().arp("0").sub(24)
  .s("sine")
  .attack(0.03).decay(0.25).sustain(0.7).release(0.45)
  .lpf(520).gain(0.74)
  .duckorbit(1).duckdepth(0.35);

const pluck = chord(prog).voicing().arp("<0 2 3 1 2 0 3 2>")
  .struct("x ~ ~ x ~ x ~ ~")
  .s("triangle")
  .attack(0.005).decay(0.18).sustain(0).release(0.28)
  .lpf(2600).gain(0.32)
  .delay(0.34).delaytime(0.375).delayfeedback(0.42)
  .room(0.55).pan(sine.range(0.35, 0.65).slow(9));

const counter = chord(prog).voicing().arp("<~ ~ 2 ~ 1 ~ ~ 3>")
  .s("gm_epiano1")
  .attack(0.01).release(0.6)
  .lpf(1800).gain(0.25)
  .delay(0.28).delaytime(0.5).delayfeedback(0.35)
  .room(0.6).pan(0.6);

const air = s("pink").struct("x").slow(4)
  .attack(2).release(2.5)
  .hpf(2800).lpf(perlin.range(4000, 8500).slow(13))
  .gain(0.07).room(0.85).pan(0.5);

const kick = s("bd").bank("RolandTR808")
  .struct("x ~ ~ ~ ~ ~ x ~")
  .gain(0.88).orbit(1).shape(0.18);

const rim = s("rim").bank("RolandTR808")
  .struct("~ ~ ~ ~ x ~ ~ ~")
  .gain(0.42).room(0.35).pan(0.55);

const hats = s("hh").bank("RolandTR808")
  .struct("~ x ~ x ~ x ~ x")
  .gain(perlin.range(0.18, 0.30).slow(5))
  .pan(0.42).hpf(7000);

const ohEvery2 = s("oh").bank("RolandTR808")
  .struct("~ ~ ~ ~ ~ ~ x ~").slow(2)
  .gain(0.22).pan(0.38).hpf(5500);

const drumsSparse = stack(kick, hats);
const drumsFull = stack(kick, rim, hats, ohEvery2);

arrange(
  [8, stack(pad, bass, air)],
  [8, stack(pad, bass, pluck, air, drumsSparse)],
  [8, stack(pad, bass, pluck, counter, air, drumsFull)]
)
