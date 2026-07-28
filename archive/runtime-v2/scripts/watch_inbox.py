#!/usr/bin/env python3
import os
import subprocess
import time

ROOT = os.environ.get("CACTUS_ROOT") or os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
KICK_FILE = os.path.join(ROOT, "runtime", "cc-bridge", ".kick")
AGY_PATH = "/Users/bowei/.local/bin/agy"

print("Starting CactusStrudel AGY Inbox Watcher...")
print(f"Watching for kick file: {KICK_FILE}")
print("Press Ctrl+C to stop.")

try:
    while True:
        if os.path.exists(KICK_FILE):
            print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Kick file detected! Triggering AGY CLI...")
            try:
                # Run AGY CLI with dangerously-skip-permissions to allow non-interactive background runs
                res = subprocess.run(
                    [AGY_PATH, "-p", "check inbox strudel", "--dangerously-skip-permissions"],
                    capture_output=True,
                    text=True
                )
                print("--- AGY CLI Output ---")
                print(res.stdout)
                if res.stderr:
                    print("--- AGY CLI Error/Warnings ---")
                    print(res.stderr)
            except Exception as e:
                print(f"Error executing AGY CLI: {e}")
            
            # Safe cleanup in case the agent did not delete it
            if os.path.exists(KICK_FILE):
                try:
                    os.remove(KICK_FILE)
                    print("Removed kick file (safeguard).")
                except Exception as e:
                    print(f"Failed to remove kick file: {e}")
        time.sleep(1.5)
except KeyboardInterrupt:
    print("\nWatcher stopped.")
