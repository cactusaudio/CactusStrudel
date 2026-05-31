setcpm(122/4);

const prog = "<F#m9 Dmaj7 Amaj7 E9>";
const chords = chord(prog).voicing();

const crackle = note("c6")
  .s("pink")
  .struct("x*32")
  .attack(.001)
  .decay(.012)
  .sustain(0)
  .release(.018)
  .hpf(5200)
  .lpf(11800)
  .crush(9)
  .gain(rand.range(.008, .026).slow(9))
  .pan(rand.range(.28, .72).slow(11))
  .room(.18);

const kick = s("bd*4")
  .bank("RolandTR808")
  .gain(.72)
  .lpf(2600)
  .decay(.45)
  .shape(.08)
  .duckorbit(1)
  .duckattack(.035)
  .duckdepth(.58);

const snareClap = stack(
  s("~ cp ~ cp")
    .bank("RolandTR909")
    .gain(.30)
    .hpf(1200)
    .room(.58)
    .roomsize(.88)
    .delay(.10)
    .delaytime(.25)
    .delayfeedback(.18),
  s("~ sd ~ sd")
    .bank("LinnDrum")
    .gain(.15)
    .hpf(700)
    .lpf(5200)
    .room(.34)
    .roomsize(.64)
);

const hats = stack(
  s("~ oh ~ oh ~ oh ~ oh")
    .bank("RolandTR909")
    .gain(.18)
    .hpf(6200)
    .decay(.18)
    .pan(.58)
    .room(.22),
  s("hh*16")
    .bank("RolandTR707")
    .gain(rand.range(.035, .075).slow(2))
    .hpf(7000)
    .decay(.045)
    .pan(sine.range(.42, .58).slow(4))
    .room(.12)
);

const rhodes = chords
  .struct("~ x ~ [x x]")
  .s("gm_epiano1")
  .attack(.015)
  .decay(.45)
  .sustain(.38)
  .release(.95)
  .lpf(perlin.range(1300, 4200).slow(12))
  .lpq(.35)
  .room(.38)
  .roomsize(.75)
  .delay(.18)
  .delaytime(.375)
  .delayfeedback(.24)
  .shape(.08)
  .crush(16)
  .gain(.52)
  .pan(sine.range(.38, .62).slow(8))
  .orbit(1)
  .superimpose(x => x.detune(.06).gain(.32).pan(.72));

const rhodesIntro = rhodes
  .lpf(sine.range(420, 1250).slow(8))
  .gain(.34);

const rhodesBreak = rhodes
  .lpf(perlin.range(700, 2600).slow(6))
  .delayfeedback(.32)
  .gain(.42);

const pad = chords
  .s("gm_pad_warm")
  .attack(.7)
  .decay(.8)
  .sustain(.62)
  .release(3.5)
  .lpf(sine.range(900, 2500).slow(16))
  .room(.62)
  .roomsize(.92)
  .gain(.22)
  .pan(.46)
  .orbit(1)
  .off(.5, x => x.add(12).gain(.14).pan(.66));

const padIntro = pad
  .lpf(sine.range(300, 1100).slow(8))
  .gain(.16);

const padBreak = pad
  .lpf(perlin.range(600, 1800).slow(4))
  .room(.82)
  .gain(.28);

const bassNotes = "<[f#1 ~ f#1 ~ c#2 ~ f#1 c#2] [d1 ~ d1 ~ a1 ~ e1 a1] [a1 ~ a1 ~ e2 ~ c#2 a1] [e1 ~ e1 ~ b1 ~ d2 e2]>";

const subBass = note(bassNotes)
  .s("sine")
  .fm(1)
  .attack(.005)
  .decay(.28)
  .sustain(.5)
  .release(.14)
  .lpf(650)
  .gain(.58)
  .orbit(1);

const bassBody = note(bassNotes)
  .s("gm_synth_bass_1")
  .attack(.004)
  .decay(.2)
  .sustain(.18)
  .release(.08)
  .lpf(1100)
  .shape(.05)
  .gain(.24)
  .orbit(1);

const bass = stack(subBass, bassBody);

const arp = chords
  .arp("0 1 2 3 2 1")
  .fast(2)
  .s("supersaw")
  .attack(.01)
  .decay(.16)
  .sustain(.12)
  .release(.25)
  .hpf(260)
  .lpf(sine.range(900, 2600).slow(10))
  .delay(.28)
  .delaytime(.1875)
  .delayfeedback(.35)
  .room(.35)
  .roomsize(.7)
  .gain(.10)
  .pan(sine.range(.25, .75).slow(5))
  .orbit(1);

const vocalLine = "<[c#4 ~ e4 c#4] [d4 ~ c#4 a3] [a3 ~ c#4 e4] [f#4 ~ e4 c#4]>";

const vocalChop = stack(
  note(vocalLine)
    .s("gm_flute")
    .attack(.025)
    .decay(.16)
    .sustain(.08)
    .release(.42)
    .hpf(520)
    .lpf(perlin.range(1400, 3600).slow(8))
    .vib(.18)
    .room(.68)
    .roomsize(.9)
    .delay(.32)
    .delaytime(.25)
    .delayfeedback(.42)
    .gain(.18)
    .pan(sine.range(.22, .78).slow(6)),
  note(vocalLine)
    .s("sine")
    .fm(3)
    .attack(.018)
    .decay(.12)
    .sustain(.04)
    .release(.3)
    .hpf(650)
    .lpf(2100)
    .gain(.055)
    .pan(sine.range(.65, .35).slow(7))
)
  .mask("<1 1 1 0>")
  .orbit(1);

const extraPerc = stack(
  s("~ rim ~ [rim ~] ~ rim ~ [~ rim]")
    .bank("LinnDrum")
    .gain(.16)
    .hpf(1500)
    .room(.22)
    .pan(.24),
  s("~ ~ mt ~ ~ lt ~ ht")
    .bank("AlesisHR16")
    .gain(.12)
    .hpf(350)
    .lpf(3500)
    .room(.36)
    .pan(.78)
);

const groove = stack(kick, snareClap, hats);

const intro = stack(crackle, rhodesIntro, padIntro);

const drop = stack(groove, crackle, rhodes, pad, bass);

const full = stack(groove, crackle, rhodes, pad, bass, vocalChop, arp);

const breakdown = stack(crackle, rhodesBreak, padBreak, vocalChop.slow(2).gain(.12));

const reentry = stack(groove, crackle, rhodes, pad, bass, vocalChop, arp.gain(.13), extraPerc);

arrange(
  [8, intro],
  [8, drop],
  [32, full],
  [8, breakdown],
  [16, reentry]
)
