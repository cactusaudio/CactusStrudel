"""RT-OWNER-001: one runtime owner per state root.

Reproduced fault (pre-fix): a second launch constructed `V3Application`,
whose recovery marked the live owner's running jobs/batches `interrupted`,
before discovering the occupied port. These tests pin the closure:

- a losing launch exits before `V3Application` construction and mutates
  nothing, even when its port is free;
- after quiesce/release, late dispatch and late finalization fail closed;
- SIGINT/SIGTERM reach closed/released within the bounded drain, and a
  normal restart acquires the next monotonic owner epoch.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

from .helpers import REPO_ROOT

from v3.owner import LIFECYCLE, OwnerLease, OwnershipLost, StateRootBusy
from v3.service import RuntimeTruth
from v3_api import GenerationRepository, V3Application

SERVE = REPO_ROOT / "runtime" / "serve.py"


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def _server_env(state_root: Path, port: int) -> dict[str, str]:
    return dict(
        os.environ,
        CACTUS_V3_STATE_ROOT=str(state_root),
        CACTUS_PORT=str(port),
        CACTUS_NO_BROWSER="1",
        CACTUS_ROOT=str(REPO_ROOT),
        CACTUS_SHUTDOWN_TIMEOUT="5",
    )


def _wait_health(port: int, timeout: float = 25.0) -> dict:
    deadline = time.monotonic() + timeout
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/v2/health", timeout=2
            ) as response:
                return json.loads(response.read())
        except Exception as exc:  # noqa: BLE001 - retry until deadline
            last = exc
            time.sleep(0.2)
    raise AssertionError(f"server on :{port} never became healthy: {last}")


class OwnerLeaseUnitTests(unittest.TestCase):
    def test_acquire_is_exclusive_and_epoch_is_monotonic(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "v3"
            first = OwnerLease.acquire(root)
            self.assertEqual(first.epoch, 1)
            self.assertEqual(first.stage, "owner_acquired")
            with self.assertRaises(StateRootBusy):
                OwnerLease.acquire(root)
            first.release()
            self.assertEqual(first.stage, "closed")
            second = OwnerLease.acquire(root)
            try:
                self.assertEqual(second.epoch, 2)
            finally:
                second.release()

    def test_lifecycle_moves_strictly_forward(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            lease = OwnerLease.acquire(Path(td) / "v3")
            try:
                lease.advance("migrated")
                lease.advance("recovering")
                lease.advance("accepting")
                with self.assertRaises(OwnershipLost):
                    lease.advance("recovering")
                with self.assertRaises(ValueError):
                    lease.advance("closed")
                lease.advance("quiescing")
                self.assertEqual(
                    [stage for stage in LIFECYCLE if stage != "closed"][-1],
                    "quiescing",
                )
            finally:
                lease.release()
            with self.assertRaises(OwnershipLost):
                lease.advance("quiescing")

    def test_losing_construction_never_creates_stores(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "v3"
            holder = OwnerLease.acquire(root)
            try:
                with self.assertRaises(StateRootBusy):
                    V3Application(
                        REPO_ROOT,
                        state_root=root,
                        max_generation_workers=1,
                    )
                self.assertFalse(
                    (root / "runtime.sqlite3").exists(),
                    "loser must fail before any store/schema work",
                )
            finally:
                holder.release()


class OwnerFencingTests(unittest.TestCase):
    def _build_app(self, root: Path) -> V3Application:
        return V3Application(
            REPO_ROOT,
            state_root=root,
            max_generation_workers=1,
        )

    def test_quiescing_refuses_new_dispatch_but_allows_finalize(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            app = self._build_app(Path(td) / "v3")
            try:
                job, _ = app.truth.create_job(
                    kind="generation",
                    payload={"probe": "quiesce"},
                    idempotency_key="owner-quiesce-probe",
                )
                app.truth.start_job(job["id"], worker_id="worker@e1")
                app.begin_quiesce()
                with self.assertRaises(OwnershipLost):
                    app.truth.create_job(
                        kind="generation",
                        payload={"probe": "late"},
                        idempotency_key="owner-late-dispatch",
                    )
                with self.assertRaises(OwnershipLost):
                    app.generation_repo.create(
                        count=1,
                        prompt="late",
                        profile_id="gemini-pro",
                        idempotency_key="owner-late-batch",
                    )
                finished = app.truth.store.finish_job(
                    job["id"],
                    status="failed",
                    error={"message": "quiesce drain finalization"},
                )
                self.assertEqual(finished["status"], "failed")
                terminal_events = [
                    event
                    for event in app.truth.events_after(0, job_id=job["id"])
                    if event["event_type"] == "job.failed"
                ]
                self.assertEqual(len(terminal_events), 1)
                self.assertEqual(
                    terminal_events[0]["payload_json"]["owner_epoch"],
                    app.owner.epoch,
                )
            finally:
                app.shutdown(drain_timeout=2)

    def test_finalization_fails_closed_after_release(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            app = self._build_app(Path(td) / "v3")
            job, _ = app.truth.create_job(
                kind="generation",
                payload={"probe": "late-finalize"},
                idempotency_key="owner-late-finalize",
            )
            app.truth.start_job(job["id"], worker_id="worker@e1")
            report = app.shutdown(drain_timeout=2)
            self.assertEqual(report["epoch"], 1)
            with self.assertRaises(OwnershipLost):
                app.truth.store.finish_job(job["id"], status="failed")
            with self.assertRaises(OwnershipLost):
                app.events.append("job.updated", {"id": job["id"]})
            with self.assertRaises(OwnershipLost):
                app.brain_store.create_job(
                    config_revision_id="settings_fake",
                    input_text="late",
                    toolset_id="music",
                )
            # The durable row keeps the pre-release state; the next owner's
            # recovery is the only party allowed to terminalize it.
            self.assertEqual(app.truth.get_job(job["id"])["status"], "running")

    def test_shutdown_escalates_when_drain_deadline_passes(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            app = self._build_app(Path(td) / "v3")
            release = threading.Event()
            stuck = threading.Thread(target=release.wait, daemon=True)
            stuck.start()
            with app._lock:
                app._batch_threads["gen_stuck"] = stuck
            try:
                started = time.monotonic()
                report = app.shutdown(drain_timeout=0.3)
                elapsed = time.monotonic() - started
                self.assertFalse(report["drained"])
                self.assertLess(elapsed, 5.0)
                self.assertFalse(app.owner.held)
            finally:
                release.set()
                stuck.join(timeout=2)


class OwnerProcessTests(unittest.TestCase):
    """Two-process faults against one isolated temporary state root."""

    def test_second_launch_exits_before_construction_state_untouched(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as td:
            state_root = Path(td) / "v3"
            port = _free_port()
            winner = subprocess.Popen(
                [sys.executable, str(SERVE)],
                env=_server_env(state_root, port),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            try:
                _wait_health(port)
                truth = RuntimeTruth(
                    repo_root=REPO_ROOT,
                    db_path=state_root / "runtime.sqlite3",
                )
                job, _ = truth.create_job(
                    kind="generation",
                    payload={"batch_id": "gen_live", "shot_index": 0},
                    idempotency_key="gen_live:shot:0",
                )
                truth.start_job(job["id"], worker_id="live-worker@e1")
                repo = GenerationRepository(state_root / "runtime.sqlite3")
                batch, _ = repo.create(
                    count=1,
                    prompt="live",
                    profile_id="gemini-pro",
                    idempotency_key="live-batch",
                )
                repo.record_child(batch["id"], job["id"])
                repo.set_running(batch["id"], [job["id"]])

                # The loser gets its own FREE port: only the owner lease may
                # reject it, proving the port is not the mutual exclusion.
                loser = subprocess.run(
                    [sys.executable, str(SERVE)],
                    env=_server_env(state_root, _free_port()),
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                self.assertEqual(loser.returncode, 3, loser.stdout)
                self.assertIn("refusing to start", loser.stdout)
                self.assertNotIn("Traceback", loser.stdout + loser.stderr)

                self.assertEqual(truth.get_job(job["id"])["status"], "running")
                self.assertEqual(repo.get(batch["id"])["status"], "running")
                self.assertIsNone(winner.poll(), "winner must stay alive")
                self.assertTrue(_wait_health(port, timeout=5)["ok"])
            finally:
                winner.send_signal(signal.SIGTERM)
                try:
                    winner.communicate(timeout=20)
                except subprocess.TimeoutExpired:
                    winner.kill()
                    winner.communicate(timeout=10)

    def test_sigterm_reaches_closed_release_and_restart_bumps_epoch(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as td:
            state_root = Path(td) / "v3"
            port = _free_port()
            env = _server_env(state_root, port)
            first = subprocess.Popen(
                [sys.executable, str(SERVE)],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            try:
                _wait_health(port)
                first.send_signal(signal.SIGTERM)
                output, _ = first.communicate(timeout=25)
            finally:
                if first.poll() is None:
                    first.kill()
                    first.communicate(timeout=10)
            self.assertEqual(first.returncode, 0, output)
            self.assertIn("quiesce → cancel → drain → close → release", output)
            meta = json.loads(
                (state_root / "owner.json").read_text(encoding="utf-8")
            )
            self.assertEqual(meta["stage"], "closed")
            self.assertEqual(meta["epoch"], 1)

            second = subprocess.Popen(
                [sys.executable, str(SERVE)],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            try:
                self.assertTrue(_wait_health(port)["ok"])
                meta = json.loads(
                    (state_root / "owner.json").read_text(encoding="utf-8")
                )
                self.assertEqual(meta["epoch"], 2)
                self.assertEqual(meta["stage"], "accepting")
            finally:
                second.send_signal(signal.SIGINT)
                try:
                    output, _ = second.communicate(timeout=25)
                except subprocess.TimeoutExpired:
                    second.kill()
                    output, _ = second.communicate(timeout=10)
            self.assertEqual(second.returncode, 0, output)


if __name__ == "__main__":
    unittest.main()
