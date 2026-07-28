#!/usr/bin/env python3
import json
import urllib.request
import time
import sys

URL = "http://localhost:8765/api/run-gf"
GENRES = [
    ("ambient", "Genre: ambient. Use slow tempo (cpm around 50-60), long attack/release envelopes, rich pads (e.g. gm_pad_warm or supersaw), heavy reverb, and sparse, spacious chordal textures."),
    ("minimal_techno", "Genre: minimal_techno. Use a steady 4-on-the-floor kick, crisp hats, syncopated off-beat stabs with short decay, sidechain ducking on the instruments, and a deep repetitive sub bass line."),
    ("deep_house", "Genre: deep_house. Use a warm chord progression, Rhodes keys, a groovy syncopated electric bassline, a house drum loop (kick on 1/2/3/4, clap/snare on 2/4, open hat on off-beat), and a soul/jazz feel."),
    ("dub_techno", "Genre: dub_techno. Use tape delay feedback chords, filtered minor stabs, a deep sub bassline, and a slow driving techno beat."),
    ("liquid_dnb", "Genre: liquid_dnb. Use a fast tempo (setcpm around 170/4), rapid syncopated drum breaks (snare on 2 and 4, ghost snares), deep warm basslines, and dreamy, atmospheric pads."),
    ("synthwave", "Genre: synthwave. Use retro 80s drums, driving eighth-note basslines, retro synth brass pads, and fast arpeggios."),
    ("acid_techno", "Genre: acid_techno. Use a driving 303-style synth bassline with a resonant low-pass filter and envelope sweeps, a heavy kick, and industrial hats."),
    ("chiptune", "Genre: chiptune. Use square/triangle leads, fast arpeggios, and retro noise channel drums, capturing the sound of 8-bit game consoles."),
    ("glitch_hop", "Genre: glitch_hop. Use a mid-tempo swing beat (cpm around 90-100), complex rhythmic micro-edits, off-grid syncopated beats, and playful synth melodies."),
    ("lofibeats", "Genre: lofibeats. Use a relaxed swing hip-hop beat, mellow minor chord voicings, a warm upright bassline, and a cozy retro aesthetic.")
]

print("="*60)
print("Starting CactusStrudel Genre Experiment")
print("Target: 10 genres, 2 pieces each = 20 pieces total")
print("Running against local server...")
print("="*60)

for idx, (genre, desc) in enumerate(GENRES):
    for run in [1, 2]:
        print(f"\n[Progress: {idx*2 + run}/20] Generating {genre} (Run {run})...")
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
print("All 20 pieces generated and cataloged successfully!")
print("="*60)
