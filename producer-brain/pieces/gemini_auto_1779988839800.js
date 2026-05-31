setcpm(70/4);

const rootLight = note("<[d2,a2,e3] [d2,a2,f#3] [b1,f#2,c#3] [a1,e2,c#3]>")
  .slow(8)
  .s("sine")
  .attack(8)
  .sustain(0.75)
  .release(16)
  .lpf(sine.range(160,380).slow(24))
  .lpq(0.15)
  .gain(0.2)
  .room(0.9)
  .roomsize(0.98)
  .pan(sine.range(0.42,0.58).slow(32))
  .orbit(1);

const glassPad = note("<[d3,a3,e4,f#4] [e3,b3,f#4,g#4] [a2,e3,c#4,g#4] [b2,f#3,a3,e4]>")
  .slow(4)
  .s("gm_pad_warm")
  .attack(5)
  .sustain(0.82)
  .release(14)
  .lpf(perlin.range(900,2800).slow(18))
  .lpq(0.18)
  .gain(0.16)
  .room(0.96)
  .roomsize(0.99)
  .delay(0.18)
  .delaytime(0.5)
  .delayfeedback(0.42)
  .pan(sine.range(0.22,0.78).slow(20))
  .superimpose(x => x.add(12).gain(0.045).delay(0.24).delaytime(0.75).pan(0.72))
  .orbit(2);

const harmonicMist = note("<[f#4,a4,c#5,e5] [g#4,b4,d5,f#5] [e4,a4,c#5,g#5] [d4,f#4,a4,e5]>")
  .slow(6)
  .s("supersaw")
  .detune(0.06)
  .attack(6)
  .sustain(0.7)
  .release(15)
  .hpf(140)
  .lpf(sine.range(650,1900).slow(16))
  .gain(0.075)
  .room(0.92)
  .roomsize(0.98)
  .delay(0.12)
  .delaytime(1)
  .delayfeedback(0.35)
  .pan(sine.range(0.7,0.3).slow(26))
  .orbit(3);

const distantBells = note("<~ d6 ~ [a5 e6] ~ g#5 ~ c#6 ~ f#6 ~ [e6 b5] ~>")
  .palindrome()
  .slow(2)
  .s("sine")
  .fm(9)
  .attack(0.01)
  .decay(5)
  .sustain(0)
  .release(7)
  .hpf(700)
  .lpf(perlin.range(2400,7600).slow(11))
  .gain(0.075)
  .room(0.98)
  .roomsize(1)
  .delay(0.58)
  .delaytime(0.75)
  .delayfeedback(0.68)
  .pan(rand.range(0.18,0.82))
  .orbit(4);

const airportMotif = note("<d5 ~ e5 ~ f#5 ~ g#5 ~ a5 ~ c#6 ~ b5 ~>")
  .slow(3)
  .s("gm_epiano1")
  .attack(0.04)
  .decay(6)
  .sustain(0.12)
  .release(8)
  .lpf(sine.range(1200,3600).slow(13))
  .gain(0.085)
  .room(0.94)
  .roomsize(0.99)
  .delay(0.34)
  .delaytime(0.5)
  .delayfeedback(0.55)
  .pan(sine.range(0.3,0.68).slow(17))
  .off(0.5, x => x.add(7).gain(0.05).delay(0.22).pan(0.8))
  .orbit(5);

const farFlute = note("<~ a4 ~ c#5 ~ e5 ~ g#4 ~ f#5 ~ e5 ~>")
  .slow(4)
  .s("gm_flute")
  .attack(2.5)
  .decay(4)
  .sustain(0.35)
  .release(9)
  .hpf(360)
  .lpf(perlin.range(1400,4300).slow(19))
  .gain(0.105)
  .room(0.96)
  .roomsize(0.99)
  .delay(0.22)
  .delaytime(1)
  .delayfeedback(0.48)
  .pan(sine.range(0.6,0.38).slow(23))
  .orbit(6);

const air = note("<d4 ~>")
  .slow(16)
  .s("pink")
  .attack(12)
  .sustain(0.65)
  .release(20)
  .hpf(520)
  .lpf(perlin.range(1200,5200).slow(14))
  .gain(perlin.range(0.025,0.07).slow(9))
  .room(1)
  .roomsize(1)
  .pan(sine.range(0.12,0.88).slow(40))
  .orbit(7);

const opening = stack(rootLight, glassPad, air);

const firstBloom = stack(rootLight, glassPad, harmonicMist, distantBells, air);

const suspended = stack(rootLight, glassPad, airportMotif, farFlute, air);

const fullBloom = stack(rootLight, glassPad, harmonicMist, distantBells, airportMotif, farFlute, air);

const coda = stack(rootLight, glassPad, distantBells, air);

arrange(
  [8, opening],
  [16, firstBloom],
  [12, suspended],
  [16, fullBloom],
  [8, coda]
)
