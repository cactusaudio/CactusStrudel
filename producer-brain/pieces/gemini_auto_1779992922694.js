setcpm(122/4);

const prog = "<Dm9 Bbmaj7 Fmaj7 C9>";

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(0.92)
  .shape(0.18)
  .duckorbit(1)
  .duckattack(0.06)
  .duckdepth(0.82);

const clap = s("~ sd ~ sd")
  .bank("RolandTR909")
  .gain(0.43)
  .room(0.18)
  .hpf(900);

const hats = s("~ hh ~ hh")
  .fast(2)
  .bank("RolandTR909")
  .gain(0.22)
  .hpf(6500)
  .pan(sine.range(0.35, 0.65).slow(4))
  .every(8, x => x.gain(0.32));

const openhat = s("~ oh ~ oh")
  .bank("RolandTR909")
  .gain(0.18)
  .decay(0.18)
  .hpf(5200)
  .room(0.12);

const perc = stack(
  s("~ rim ~ [rim rim]").bank("RolandTR707").gain(0.16).hpf(1800).pan(0.72),
  s("~ ~ cp ~").bank("LinnDrum").gain(0.12).hpf(1200).room(0.25)
).every(4, x => x.fast(2).gain(0.8));

const pad = chord(prog)
  .voicing()
  .s("gm_pad_warm")
  .attack(1.35)
  .decay(1.8)
  .sustain(0.78)
  .release(2.4)
  .lpf(sine.range(650, 2500).slow(16))
  .lpq(0.18)
  .gain(0.28)
  .room(0.68)
  .roomsize(0.86)
  .pan(sine.range(0.42, 0.58).slow(8))
  .orbit(1);

const rhodes = chord(prog)
  .voicing()
  .struct("~ x ~ [x x]")
  .s("gm_epiano1")
  .attack(0.018)
  .decay(0.42)
  .sustain(0.32)
  .release(0.55)
  .lpf(sine.range(1050, 3400).slow(12))
  .lpq(0.24)
  .gain(0.48)
  .room(0.34)
  .delay(0.18)
  .delaytime(0.25)
  .delayfeedback(0.28)
  .orbit(1);

const bass = note("<[~ d2 a1 d2] [~ bb1 f1 bb1] [~ f1 c2 f1] [~ c2 g1 c2]>")
  .s("gm_acoustic_bass")
  .attack(0.01)
  .decay(0.22)
  .sustain(0.46)
  .release(0.2)
  .lpf(1250)
  .gain(0.62)
  .orbit(1);

const arp = chord(prog)
  .voicing()
  .arp("0 2 3 1")
  .fast(2)
  .s("triangle")
  .attack(0.015)
  .decay(0.16)
  .sustain(0.12)
  .release(0.22)
  .lpf(sine.range(1200, 4300).slow(8))
  .delay(0.22)
  .delaytime(0.375)
  .delayfeedback(0.36)
  .gain(0.15)
  .pan(sine.range(0.25, 0.75).slow(6))
  .orbit(1);

const lead = n("<[~ 2 4 ~] [5 ~ 4 2] [~ 7 6 5] [4 ~ 2 ~]>")
  .scale("D:minor")
  .add(12)
  .s("sine")
  .fm(3)
  .attack(0.03)
  .decay(0.18)
  .sustain(0.25)
  .release(0.48)
  .lpf(3100)
  .delay(0.24)
  .delaytime(0.5)
  .delayfeedback(0.32)
  .room(0.42)
  .gain(0.18)
  .off(0.25, x => x.add(7).gain(0.42))
  .orbit(1);

const drumsFull = stack(kick, clap, hats, openhat, perc);

arrange(
  [8, stack(pad, rhodes.gain(0.55), kick, hats.gain(0.5))],
  [16, stack(drumsFull, bass, pad, rhodes)],
  [8, stack(pad.gain(0.9), rhodes.gain(0.72), arp.gain(0.8), openhat.gain(0.35))],
  [16, stack(drumsFull, bass, pad, rhodes, arp, lead)],
  [8, stack(kick, clap.gain(0.7), hats, bass, pad, rhodes, lead.gain(0.62))],
  [4, stack(pad, rhodes.gain(0.45), s("bd ~ ~ ~").bank("RolandTR909").gain(0.65).duckorbit(1).duckattack(0.06).duckdepth(0.65))]
)
