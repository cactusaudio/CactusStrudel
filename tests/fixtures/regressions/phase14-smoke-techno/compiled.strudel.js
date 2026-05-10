// session ca77df1c-4712-4304-a1a1-81cadf4ba6a0
// brief: peak time techno 130 BPM, 10 seconds
setcps(0.542)

stack(
  // kick (kick) → orbit 0
  arrange(
    [8, silence],
    [4, s("[bd ~ ~ ~]*2")],
    [16, s("[bd ~ ~ ~]*2")],
    [8, silence],
    [4, s("bd ~ ~ ~ bd ~ ~ ~")],
    [16, s("bd ~ ~ ~ bd ~ ~ ~")],
    [8, silence]
  ).room(0.05).orbit(0),
  // hat (hat) → orbit 1
  arrange(
    [8, silence],
    [4, s("hh*8")],
    [16, s("[~ hh]*4")],
    [8, silence],
    [4, s("[~ hh]*4")],
    [16, s("hh*8")],
    [8, silence]
  ).hpf(6000).gain(0.6).pan(0.15).room(0.1).orbit(1),
  // bass (bass) → orbit 2
  arrange(
    [8, silence],
    [4, note("a1 ~ ~ a1 ~ ~ c2 ~").s("sawtooth")],
    [16, note("a1 ~ a1 ~").s("sawtooth")],
    [8, silence],
    [4, note("a1 ~ a1 ~").s("sawtooth")],
    [16, note("a1 ~ a1 ~").s("sawtooth")],
    [8, silence]
  ).lpf(250).gain(0.9).room(0.05).duck(0).duckdepth(0.5).duckattack(0.005).orbit(2),
  // stab (chord) → orbit 3
  arrange(
    [8, silence],
    [4, silence],
    [16, note("[~ hh]*4").s("sawtooth")],
    [8, note("bd ~ ~ ~ bd ~ ~ ~").s("sawtooth")],
    [4, silence],
    [16, note("[~ hh ~ hh hh ~ hh hh]").s("sawtooth")],
    [8, silence]
  ).lpf(1200).gain(0.7).pan(-0.1).room(0.3).delay(0.1).duck(0).duckdepth(0.3).duckattack(0.005).orbit(3)
)