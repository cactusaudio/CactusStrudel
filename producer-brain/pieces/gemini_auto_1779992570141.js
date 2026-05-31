setcpm(125/4);

const kick = s("bd bd bd bd")
  .bank("RolandTR909")
  .gain(1.15)
  .decay(0.32)
  .shape(0.18)
  .duckorbit(1)
  .duckattack(0.02)
  .duckdepth(0.72);

const hats = stack(
  s("~ hh ~ hh").bank("RolandTR909").gain(0.22).hpf(6500).pan(0.12),
  s("~ ~ oh ~").bank("RolandTR909").gain(0.13).hpf(5200).decay(0.08).pan(-0.18),
  s("[~ hh] ~ [hh ~] hh").bank("RolandTR707").gain(0.11).hpf(7200).speed(1.35)
);

const clap = s("~ ~ sd ~")
  .bank("RolandTR909")
  .gain(0.42)
  .hpf(900)
  .room(0.18)
  .roomsize(0.35);

const congas = stack(
  s("~ [mt ~] ~ [lt mt]").bank("AlesisHR16").gain(0.35).hpf(260).lpf(3600).pan(-0.24),
  s("[~ ht] ~ [lt ~] ~").bank("AlesisHR16").gain(0.24).hpf(320).lpf(4200).pan(0.28),
  s("~ rim ~ [~ rim]").bank("RolandTR808").gain(0.18).hpf(1300).delay(0.13).delayfeedback(0.22)
);

const bass = n("<0 0 3 0> [~ 0] <5 3> [0 ~]")
  .scale("A:minor")
  .sub(12)
  .s("gm_synth_bass_1")
  .gain(0.78)
  .attack(0.005)
  .decay(0.18)
  .sustain(0.35)
  .release(0.08)
  .lpf(sine.range(120, 520).slow(8))
  .lpq(0.25)
  .orbit(1);

const dubstab = chord("<Am7 Dm7 Em7 Am7>")
  .voicing()
  .struct("~ [x ~] ~ [~ x]")
  .s("gm_pad_warm")
  .gain(0.52)
  .attack(0.008)
  .decay(0.23)
  .sustain(0)
  .release(0.36)
  .lpf(perlin.range(450, 1450).slow(6))
  .lpq(0.36)
  .delay(0.42)
  .delaytime(0.375)
  .delayfeedback(0.55)
  .room(0.35)
  .roomsize(0.65)
  .pan(sine.range(-0.32, 0.32).slow(5))
  .orbit(1);

const skank = chord("<Am7 Am7 Dm7 Em7>")
  .voicing()
  .arp("0 2 1 3")
  .struct("~ x ~ [x ~]")
  .s("saw")
  .gain(0.16)
  .attack(0.004)
  .decay(0.08)
  .sustain(0)
  .release(0.08)
  .lpf(980)
  .hpf(240)
  .delay(0.18)
  .delayfeedback(0.3)
  .pan(-0.1)
  .orbit(1);

const hook = n("~ 7 ~ [5 3] ~ 2 [3 ~] 0")
  .scale("A:minor")
  .add(12)
  .s("square")
  .fm(2)
  .gain(0.12)
  .attack(0.01)
  .decay(0.12)
  .sustain(0.2)
  .release(0.1)
  .lpf(1800)
  .delay(0.22)
  .delaytime(0.25)
  .delayfeedback(0.34)
  .pan(0.2)
  .orbit(1);

const noise = s("white")
  .struct("~ ~ ~ [x ~]")
  .gain(0.05)
  .attack(0.001)
  .decay(0.04)
  .sustain(0)
  .release(0.02)
  .hpf(7600)
  .pan(rand.range(-0.6, 0.6));

arrange(
  [4, stack(kick, hats, congas, bass)],
  [8, stack(kick, hats, clap, congas, bass, dubstab)],
  [8, stack(kick, hats, clap, congas, bass, dubstab, skank, noise)],
  [4, stack(hats, congas, dubstab, hook)],
  [8, stack(kick, hats, clap, congas, bass, dubstab, skank, hook, noise)]
)
