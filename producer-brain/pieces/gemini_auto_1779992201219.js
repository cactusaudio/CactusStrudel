setcpm(132/4);

const kick = s("bd*4")
  .bank("RolandTR909")
  .gain(.98)
  .lpf(1900)
  .shape(.32)
  .duckorbit(1)
  .duckattack(.035)
  .duckdepth(.72);

const snare = s("~ sd ~ sd")
  .bank("RolandTR909")
  .gain(.58)
  .hpf(900)
  .lpf(5200)
  .shape(.18)
  .room(.22)
  .roomsize(.28);

const hats = s("hh*8")
  .bank("RolandTR808")
  .gain(.34)
  .hpf(6200)
  .decay(.035)
  .pan(sine.range(-.12,.12).slow(4));

const openHat = s("~ oh ~ oh")
  .bank("RolandTR808")
  .gain(.16)
  .hpf(5200)
  .decay(.11)
  .pan(.18);

const rimGhost = s("~ ~ rim ~ ~ rim ~ ~")
  .bank("RolandTR707")
  .gain(.13)
  .hpf(1800)
  .delay(.12)
  .delaytime(.25)
  .delayfeedback(.18)
  .mask("<0 1 0 1 1 0 1 1>");

const drums = stack(kick, snare, hats, openHat, rimGhost);

const bass = note("<e2*8 e2*8 e2*8 [e2 e2 e2 e2 e2 e2 d2 e2]>")
  .s("sawtooth")
  .gain(.72)
  .attack(.003)
  .decay(.075)
  .sustain(.34)
  .release(.025)
  .lpf(perlin.range(520,980).slow(12))
  .lpq(5.5)
  .shape(.78)
  .crush(6)
  .clip(.82)
  .orbit(1);

const arp = chord("Em7")
  .voicing()
  .arp("0 1 2 3 2 1 0 1")
  .s("square")
  .fm(2)
  .gain(.27)
  .attack(.004)
  .decay(.06)
  .sustain(.22)
  .release(.06)
  .lpf(sine.range(1150,3600).slow(16))
  .lpq(4)
  .delay(.24)
  .delaytime(.375)
  .delayfeedback(.34)
  .pan(perlin.range(-.34,.34).slow(8))
  .orbit(1);

const pulseArpShadow = chord("Em7")
  .voicing()
  .arp("3 2 1 0 1 2 3 2")
  .s("sine")
  .fm(5)
  .gain(.105)
  .attack(.002)
  .decay(.045)
  .sustain(.12)
  .release(.08)
  .add(12)
  .lpf(2600)
  .delay(.18)
  .delaytime(.5)
  .delayfeedback(.28)
  .pan(sine.range(.22,-.22).slow(6))
  .mask("<0 0 1 0 1 0 1 1>")
  .orbit(1);

const drone = note("<[e3,b3,e4] [e3,g3,b3,e4] [e3,b3,e4,fs4] [e3,g3,b3,e4]>")
  .slow(8)
  .s("supersaw")
  .gain(.24)
  .attack(3.5)
  .decay(1.5)
  .sustain(.84)
  .release(5)
  .detune(sine.range(-.08,.08).slow(18))
  .lpf(perlin.range(430,2550).slow(24))
  .lpq(sine.range(1.2,6.8).slow(32))
  .room(.72)
  .roomsize(.9)
  .pan(sine.range(-.24,.24).slow(20))
  .orbit(1);

const highDrone = note("<e5 b4 e5 g5>")
  .slow(4)
  .s("triangle")
  .fm(3)
  .gain(.095)
  .attack(1.5)
  .decay(.6)
  .sustain(.65)
  .release(3.5)
  .vib(.12)
  .lpf(sine.range(1800,5200).slow(28))
  .delay(.35)
  .delaytime(.75)
  .delayfeedback(.42)
  .pan(perlin.range(-.45,.45).slow(14))
  .orbit(1);

const motorNoise = s("white*8")
  .gain(.028)
  .attack(.001)
  .decay(.025)
  .hpf(7600)
  .lpf(perlin.range(8500,12500).slow(10))
  .pan(rand.range(-.35,.35))
  .mask("<1 1 0 1 1 0 1 1>");

stack(
  drums,
  bass,
  arp,
  pulseArpShadow,
  drone,
  highDrone,
  motorNoise
)
