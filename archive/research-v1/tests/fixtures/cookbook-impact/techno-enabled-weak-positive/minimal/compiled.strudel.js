// session ceeb0386-5dda-4c68-aee9-48be1f886561
// brief: peak time techno 132 BPM, 16 bars, hypnotic
setcps(0.55)

stack(
  // kick (kick) → orbit 0
  arrange(
    [12, s("bd ~ ~ ~ bd ~ ~ ~")],
    [6, s("bd ~ ~ ~ bd ~ ~ ~")],
    [25, s("bd ~ ~ ~ bd ~ ~ ~")],
    [12, silence],
    [6, s("bd ~ ~ ~ bd ~ ~ ~")],
    [25, s("bd ~ ~ ~ bd ~ ~ ~")],
    [12, s("bd ~ ~ ~ bd ~ ~ ~")]
  ).gain(0.85).room(0.05).orbit(0),
  // hat (hat) → orbit 1
  arrange(
    [12, silence],
    [6, s("[~ hh]*4")],
    [25, s("[~ hh]*4")],
    [12, s("[~ hh]*4")],
    [6, s("[~ hh]*4")],
    [25, s("[~ hh]*4")],
    [12, silence]
  ).hpf(6000).gain(0.4).pan(0.15).room(0.1).orbit(1),
  // bass (bass) → orbit 2
  arrange(
    [12, silence],
    [6, note("a1 ~ ~ ~").s("sawtooth")],
    [25, note("a1 ~ ~ ~").s("sawtooth")],
    [12, silence],
    [6, note("a1 ~ ~ ~").s("sawtooth")],
    [25, note("a1 ~ ~ ~").s("sawtooth")],
    [12, silence]
  ).lpf(250).gain(0.65).room(0.05).duck(0).duckdepth(0.5).duckattack(0.005).orbit(2),
  // stab (chord) → orbit 3
  arrange(
    [12, silence],
    [6, silence],
    [25, note("<a3 c4 e4>").s("sawtooth")],
    [12, note("<a3 c4 e4>").s("sawtooth")],
    [6, silence],
    [25, note("<a3 c4 e4>").s("sawtooth")],
    [12, silence]
  ).hpf(400).lpf(1200).gain(0.25).pan(-0.1).room(0.3).delay(0.1).duck(0).duckdepth(0.3).duckattack(0.005).orbit(3)
)