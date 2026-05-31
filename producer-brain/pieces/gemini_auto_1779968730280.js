setcpm(108/4);

const pad = chord("<Am F C G>")
  .voicing()
  .s("gm_pad_warm")
  .attack(0.2)
  .room(0.6)
  .orbit(1);

const bss = note("<a1 f1 c1 g1>")
  .struct("~ x ~ x ~ x ~ x")
  .s("gm_synth_bass_1")
  .decay(0.3)
  .sustain(0.1)
  .orbit(1);

const lead = note("<[e5 ~ ~ c5 ~ ~ g5 [~ e5]] [f5 ~ ~ c5 ~ ~ a5 [~ f5]] [g5 ~ ~ e5 ~ ~ c6 [~ g5]] [d5 ~ ~ b4 ~ ~ g5 [~ d5]]>")
  .s("sine")
  .fm(3)
  .decay(0.15)
  .sustain(0)
  .room(0.4)
  .delay(0.4)
  .delaytime(3/16)
  .delayfeedback(0.3)
  .orbit(1);

const kick = s("bd*4")
  .bank("RolandTR909")
  .duckorbit(1)
  .duckdepth(0.85)
  .gain(1.1);

const cp = s("~ cp ~ cp")
  .bank("RolandTR808")
  .room(0.2)
  .gain(0.9);

const hats = s("~ hh ~ oh")
  .fast(2)
  .bank("RolandTR808")
  .gain(0.7);

const perc = s("~ ~ ~ rim  ~ ~ rim ~  ~ ~ ~ rim  ~ rim ~ ~")
  .bank("RolandTR808")
  .gain(0.8)
  .pan(0.6);

arrange(
  [4, stack(
    pad.lpf(sine.range(400, 1000).slow(4)),
    hats,
    perc
  )],
  [8, stack(
    pad.lpf(1200),
    bss,
    lead,
    kick, cp, hats, perc
  )],
  [4, stack(
    pad.lpf(800),
    lead.lpf(1000).room(0.8),
    cp
  )],
  [8, stack(
    pad.lpf(2000).superimpose(x => x.add(12)).gain(0.8),
    bss.lpf(2000),
    lead.superimpose(x => x.add(12)),
    kick, cp, hats, perc
  )]
)
