// session 932d6764-d5e3-45d4-8df2-6f5969987be1
// brief: dnb 174 BPM, 16 bars, rolling reese sub
setcps(0.725)

stack(
  // kick (kick) → orbit 0
  arrange(
    [19, silence],
    [37, s("bd ~ ~ ~ bd ~ ~ ~")],
    [19, silence],
    [37, s("bd ~ ~ ~ bd ~ ~ ~")],
    [19, silence]
  ).gain(0.95).room(0.05).orbit(0),
  // hat (hat) → orbit 1
  arrange(
    [19, s("[~ hh]*4")],
    [37, s("[~ hh]*4")],
    [19, silence],
    [37, s("[~ hh]*4")],
    [19, s("[~ hh]*4")]
  ).hpf(6000).gain(0.45).pan(0.15).room(0.1).orbit(1),
  // snare (snare) → orbit 2
  arrange(
    [19, silence],
    [37, s("~ ~ sd ~ ~ ~ ~ ~")],
    [19, silence],
    [37, s("~ ~ sd ~ ~ ~ ~ ~")],
    [19, silence]
  ).hpf(200).gain(0.85).room(0.18).orbit(2),
  // bass (bass) → orbit 3
  arrange(
    [19, silence],
    [37, note("a1 ~ ~ ~").s("sawtooth")],
    [19, silence],
    [37, note("a1 ~ ~ ~").s("sawtooth")],
    [19, silence]
  ).lpf(250).gain(0.85).room(0.05).duck(0).duckdepth(0.5).duckattack(0.005).orbit(3),
  // pad (pad) → orbit 4
  arrange(
    [19, note("a3").s("fm")],
    [37, note("a3").s("fm")],
    [19, note("a3").s("fm")],
    [37, note("a3").s("fm")],
    [19, note("a3").s("fm")]
  ).hpf(350).lpf(1200).gain(0.4).pan(0.2).room(0.5).delay(0.3).duck(0).duckdepth(0.3).duckattack(0.005).orbit(4)
)