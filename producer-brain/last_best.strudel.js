setcpm(124/4)

$BASS: n("<[0 0 2 4] [5 5 4 0]>*2").scale("c2:minor").s("sawtooth").lpf(300).gain("<0.05 0.3 0.05 0.3>")

$CHORD: n("<[0,2,4] [5,0,2] [3,5,0] [4,6,1]>/2").scale("c3:minor").s("triangle").lpf(2200).hpf(150).gain(0.12).room(0.4)

$LEAD: n("<0 2 3 5 7 5 3 2>").scale("c4:minor").s("square").lpf(1800).gain(0.22).room(0.3).delay(0.25).delayfeedback(0.2).mask("<0@4 1@12>")

$DRUMS: stack(sound("bd*4").gain(1.1), sound("~ cp ~ cp").gain(0.6), sound("[hh hh hh hh]*2").gain(0.3).hpf(2000).lpf(8000))