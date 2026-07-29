"""B5 chaos drill: kill -9 a live runtime, restart, verify honest recovery.

SIGKILL gives the process no cleanup — the flock releases via the OS, the
WAL recovers via SQLite, and the next owner must (a) adopt the promoted
render whose registration was lost, (b) interrupt the genuinely in-flight
work, and (c) come up accepting with the next epoch. This drills the REAL
startup path end-to-end, beyond the module-level fault tests.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

from .helpers import REPO_ROOT

from v3.service import RuntimeTruth
from v3_api import GenerationRepository

SERVE = REPO_ROOT / "runtime" / "serve.py"


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def _wait_health(port: int, timeout: float = 25.0) -> dict:
    deadline = time.monotonic() + timeout
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/v2/health", timeout=2
            ) as response:
                return json.loads(response.read())
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.2)
    raise AssertionError(f"server on :{port} never became healthy: {last}")


class ChaosDrillTest(unittest.TestCase):
    def test_sigkill_then_restart_recovers_honestly(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            state_root = Path(td) / "v3"
            # The server derives its assets root from CACTUS_ROOT; the drill
            # uses an isolated repo root so adoption sees the same layout the
            # fixture promoted into (and the real library is never touched).
            fake_repo = Path(td) / "repo"
            (fake_repo / "producer-brain" / "assets").mkdir(parents=True)
            port = _free_port()
            env = dict(
                os.environ,
                CACTUS_V3_STATE_ROOT=str(state_root),
                CACTUS_PORT=str(port),
                CACTUS_NO_BROWSER="1",
                CACTUS_ROOT=str(fake_repo),
                CACTUS_SHUTDOWN_TIMEOUT="5",
            )
            first = subprocess.Popen(
                [sys.executable, str(SERVE)],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            second = None
            try:
                _wait_health(port)

                truth = RuntimeTruth(
                    repo_root=fake_repo,
                    db_path=state_root / "runtime.sqlite3",
                    assets_root=fake_repo / "producer-brain" / "assets",
                    duration_probe=lambda _: 5.0,
                )
                repo = GenerationRepository(state_root / "runtime.sqlite3")

                # (a) The DT-001 crash-window artifact: promoted, unregistered.
                audio = state_root / "chaos-render.mp3"
                audio.write_bytes(b"ID3" + b"\x09" * 1024)
                adopted_job, _ = truth.create_job(
                    kind="generation",
                    payload={"prompt": "chaos adopt"},
                    idempotency_key="chaos-adopt",
                )
                truth.start_job(adopted_job["id"], worker_id="chaos@e1")
                staged = truth.stage_render(
                    job_id=adopted_job["id"],
                    piece_id="piece_chaos",
                    version_id="version_chaos",
                    code='s("bd")',
                    audio_path=audio,
                )
                provenance = {"provider_route": "x", "model_id": "m"}
                receipt = truth.assets.build_receipt(
                    staged, provenance=provenance
                )
                registration = {
                    "receipt": receipt,
                    "piece": {"id": "piece_chaos", "display_name": "CHAOS-001"},
                    "version": {"id": "version_chaos", "provenance": provenance},
                    "model_run": {
                        **provenance,
                        "request_receipt": {},
                        "response_receipt": {},
                    },
                }
                truth.store.create_commit_intent(
                    job_id=adopted_job["id"],
                    receipt=receipt,
                    registration=registration,
                )
                truth.assets.promote_with_receipt(staged, receipt=receipt)
                truth.store.mark_commit_intent(
                    adopted_job["id"], status="promoted"
                )

                # (b) Genuinely in-flight work that must become interrupted.
                live_job, _ = truth.create_job(
                    kind="generation",
                    payload={"batch_id": "gen_chaos", "shot_index": 0},
                    idempotency_key="chaos-live",
                )
                truth.start_job(live_job["id"], worker_id="chaos@e1")
                batch, _ = repo.create(
                    count=1,
                    prompt="chaos live",
                    profile_id="p",
                    idempotency_key="chaos-live-batch",
                )
                repo.record_child(batch["id"], live_job["id"])
                repo.set_running(batch["id"], [live_job["id"]])

                first.send_signal(signal.SIGKILL)
                first.wait(timeout=10)

                second = subprocess.Popen(
                    [sys.executable, str(SERVE)],
                    env=env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                )
                _wait_health(port)

                # (a) adopted exactly:
                recovered = truth.get_job(adopted_job["id"])
                self.assertEqual(recovered["status"], "succeeded")
                self.assertEqual(
                    recovered["result_version_id"], "version_chaos"
                )
                # (b) interrupted honestly (job AND parent batch):
                self.assertEqual(
                    truth.get_job(live_job["id"])["status"], "interrupted"
                )
                self.assertEqual(repo.get(batch["id"])["status"], "interrupted")
                # (c) next epoch, accepting, zero orphans:
                meta = json.loads(
                    (state_root / "owner.json").read_text(encoding="utf-8")
                )
                self.assertEqual(meta["epoch"], 2)
                self.assertEqual(meta["stage"], "accepting")
                reconciliation = truth.reconcile_receipts()
                self.assertEqual(reconciliation["orphan_promoted"], [])
                self.assertEqual(
                    reconciliation["registered_without_valid_receipt"], []
                )
            finally:
                for process in (first, second):
                    if process is not None and process.poll() is None:
                        process.send_signal(signal.SIGTERM)
                        try:
                            process.communicate(timeout=20)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.communicate(timeout=10)


if __name__ == "__main__":
    unittest.main()
