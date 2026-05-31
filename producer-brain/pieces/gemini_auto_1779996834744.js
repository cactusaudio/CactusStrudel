setcpm(124/4);

const kick = s("bd bd bd bd")
  .bank("RolandTR808")
  .lpf(115)
  .decay(0.07)
  .gain(0.13)
  .duckorbit(1)
  .duckattack(0.02)
  .duckdepth(0.14);

const sub = note("<[a1 ~ ~ a1] [a1 ~ c2 ~] [f1 ~ ~ f1] [e1 ~ ~ e1]>")
  .s("sine")
  .attack(0.01)
  .decay(0.12)
  .sustain(0.12)
  .release(0.08)
  .lpf(95)
  .gain(0.22)
  .orbit(1);

const microDust = s("white")
  .struct("[x ~ ~ x] [~ x ~ ~] [x ~] ~")
  .attack(0.001)
  .decay(0.006)
  .sustain(0)
  .release(0.002)
  .hpf(7600)
  .gain(rand.range(0.008, 0.03).slow(2))
  .pan(rand.range(0.12, 0.88))
  .room(0.08)
  .orbit(1);

const rimPops = s("rim ~ [~ rim] [cp ~] ~")
  .bank("RolandTR707")
  .speed(3)
  .hpf(4200)
  .decay(0.012)
  .gain(0.035)
  .pan(perlin.range(0.25, 0.75).slow(3))
  .delay(0.12)
  .delaytime(0.125)
  .delayfeedback(0.28)
  .orbit(1);

const tomClicks = s("~ [lt ~] ~ [~ mt]")
  .bank("LinnDrum")
  .speed(4)
  .hpf(5200)
  .decay(0.01)
  .gain(0.026)
  .pan(rand.range(0.18, 0.82).slow(1))
  .room(0.06)
  .orbit(1);

const shaker = s("hh*16")
  .bank("RolandTR909")
  .hpf(6900)
  .decay(0.018)
  .gain(rand.range(0.007, 0.027))
  .pan(sine.range(0.46, 0.54).slow(4))
  .orbit(1);

const ghostHats = s("[~ hh]*4")
  .bank("RolandTR808")
  .hpf(6100)
  .decay(0.025)
  .gain(rand.range(0.004, 0.022).slow(1))
  .pan(rand.range(0.35, 0.65))
  .orbit(1);

const dub = chord("<Am7 Am7 Fmaj7 Em7>")
  .voicing()
  .struct("~ x ~ ~")
  .s("gm_pad_warm")
  .attack(0.01)
  .decay(0.2)
  .sustain(0.08)
  .release(0.65)
  .lpf(sine.range(720, 1250).slow(8))
  .lpq(0.18)
  .delay(0.72)
  .delaytime(0.75)
  .delayfeedback(0.72)
  .room(0.52)
  .roomsize(0.9)
  .gain(0.16)
  .pan(sine.range(0.34, 0.66).slow(16))
  .orbit(1);

const bell = note("<[a5 ~ c6 ~] [e6 ~ c6 ~] [g5 ~ e6 ~] [c6 ~ a5 ~]>")
  .s("sine")
  .fm(5)
  .attack(0.004)
  .decay(0.09)
  .sustain(0)
  .release(0.16)
  .lpf(3100)
  .delay(0.38)
  .delaytime(0.375)
  .delayfeedback(0.46)
  .room(0.34)
  .gain(0.075)
  .pan(perlin.range(0.25, 0.75).slow(4))
  .orbit(1);

const tailDub = chord("<Am7 Fmaj7 Em7 Am7>")
  .voicing()
  .struct("~ ~ ~ x")
  .s("gm_pad_warm")
  .attack(0.03)
  .decay(0.05)
  .sustain(0)
  .release(0.18)
  .lpf(820)
  .delay(0.9)
  .delaytime(0.75)
  .delayfeedback(0.86)
  .room(0.72)
  .roomsize(0.95)
  .gain(0.07)
  .pan(sine.range(0.3, 0.7).slow(8))
  .orbit(1);

const air = s("pink")
  .struct("x ~ ~ ~")
  .attack(0.02)
  .decay(0.04)
  .sustain(0)
  .release(0.08)
  .hpf(5800)
  .lpf(9200)
  .delay(0.45)
  .delaytime(0.5)
  .delayfeedback(0.62)
  .room(0.65)
  .gain(0.014)
  .pan(perlin.range(0.22, 0.78).slow(5))
  .orbit(1);

const extraPerc = stack(
  s("~ rim ~ [rim ~]")
    .bank("RolandTR707")
    .speed(5)
    .hpf(5600)
    .decay(0.008)
    .gain(0.022)
    .pan(rand.range(0.1, 0.9))
    .delay(0.16)
    .delaytime(0.1875)
    .delayfeedback(0.36)
    .orbit(1),
  s("[~ cp] ~ [~ rim] ~")
    .bank("AlesisHR16")
    .speed(3)
    .hpf(4800)
    .decay(0.011)
    .gain(0.02)
    .pan(perlin.range(0.2, 0.8).slow(2))
    .orbit(1)
);

const intro = stack(kick, sub, microDust, rimPops, tomClicks, shaker, ghostHats);
const breakdown = stack(tailDub, air);

arrange(
  [16, intro],
  [16, stack(intro, dub)],
  [16, stack(intro, dub, bell)],
  [8, breakdown],
  [16, stack(intro, dub, bell, extraPerc)]
)
