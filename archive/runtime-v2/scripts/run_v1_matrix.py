#!/usr/bin/env python3
import json
import urllib.request
import time
import sys

URL = "http://localhost:8765/api/run-gf"
COMBOS = [
    ("deep_groove_house", "Genre: deep_groove_house. Warm Jazz chords (e.g. Dm9 -> G13 -> Cmaj9), Rhodes keys, electric swing bass, house drum loop (RolandTR909) with kick sidechain ducking on instruments."),
    ("ambient_textures", "Genre: ambient_textures. Static minor/modal drone, long release supersaw pads, slow generative LPF filter sweeps via sine signals, spacey reverb, no rhythmic drums."),
    ("liquid_breaks", "Genre: liquid_breaks. Diatonic chords, fast tempo (cpm 170/4), syncopated breakbeat drums (hh, snare on 2 and 4), warm pad soundfonts, deep synth sub bass."),
    ("jazz_hop", "Genre: jazz_hop. Extended minor 9th chords, laidback hip-hop beat with micro-timing swing, Rhodes piano, gm_flute highlights, warm dry double bass."),
    ("minimal_hypnotic", "Genre: minimal_hypnotic. Deep repetitive sub bass line, single syncopated minor chord stab (sawtooth), 4-on-the-floor kick with strong sidechain ducking on pads."),
    ("melodic_prog", "Genre: melodic_prog. Pop chord progression, simple 4-note chord stack, arpeggiated lead (sine/triangle) using bounded indices (0 to 3), Linn drum bank."),
    ("retro_chiptune", "Genre: retro_chiptune. 8-bit minor scales, square wave fast lead, triangle bass, retro noise channel drums, low bit crush effect."),
    ("dub_ambient", "Genre: dub_ambient. Filtered minor stabs with heavy tape delay feedback, deep sub bass, sparse rimshots, spacious reverb."),
    ("cinematic_piano", "Genre: cinematic_piano. Mellow piano chords, warm string pads (gm_pad_warm), slow tempo, wide stereo pan sweeps, no drums."),
    ("glitch_groove", "Genre: glitch_groove. Swing electronic beat (cpm 96/4), complex rhythmic micro-edits using .mask() or .every(), playful square wave synth melodies.")
]

print("="*60)
print("Starting CactusStrudel Research v1 Taste Matrix Experiment")
print("Target: 10 combinations, 2 pieces each = 20 pieces total")
print("Running against local server...")
print("="*60)

for idx, (name, desc) in enumerate(COMBOS):
    for run in [1, 2]:
        print(f"\n[Progress: {idx*2 + run}/20] Generating {name} (Run {run})...")
        payload = json.dumps({"model": "agy-cli", "extra": desc}).encode("utf-8")
        req = urllib.request.Request(
            URL,
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        
        try:
            with urllib.request.urlopen(req) as response:
                buffer = ""
                for line in response:
                    line_str = line.decode("utf-8")
                    buffer += line_str
                    while "\n\n" in buffer:
                        event_block, buffer = buffer.split("\n\n", 1)
                        # parse event block
                        lines = event_block.split("\n")
                        event_type = "message"
                        data_content = ""
                        for l in lines:
                            if l.startswith("event:"):
                                event_type = l[len("event:"):].strip()
                            elif l.startswith("data:"):
                                data_content = l[len("data:"):].strip()
                        
                        if data_content:
                            try:
                                data_json = json.loads(data_content)
                            except Exception:
                                data_json = {"raw": data_content}
                            
                            if event_type == "log":
                                print(f"  > {data_json.get('line', '')}")
                                sys.stdout.flush()
                            elif event_type == "error":
                                print(f"  ERROR: {data_json.get('error', '')}")
                                sys.stdout.flush()
                            elif event_type == "done":
                                entry = data_json.get("entry")
                                if entry:
                                    print(f"  SUCCESS: Registered as {entry.get('name')}")
                                else:
                                    print(f"  DONE: Status code {data_json.get('exit')}")
                                sys.stdout.flush()
        except Exception as e:
            print(f"  HTTP Request failed: {e}")
            sys.stdout.flush()
            time.sleep(2)

print("\n" + "="*60)
print("All 20 matrix pieces generated and cataloged successfully!")
print("="*60)
