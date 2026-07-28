from __future__ import annotations

import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from .helpers import REPO_ROOT  # noqa: F401 - also installs runtime on sys.path

from agent.errors import JobCancelled
from v3_api import V3Application, V3Error


class RenderProcessLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = object.__new__(V3Application)
        self.app.repo_root = REPO_ROOT
        self.app.state_root = self.root / "state"
        self.children: list[subprocess.Popen[bytes]] = []

    def tearDown(self) -> None:
        for child in self.children:
            if child.poll() is not None:
                continue
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
        self.temp.cleanup()

    def test_large_stdout_and_stderr_cannot_deadlock_render(self) -> None:
        script = r"""
import json
import os
from pathlib import Path
import sys

work_dir = Path(sys.argv[1]).parent
os.write(1, b"O" * (1024 * 1024) + b"\nstdout-tail\n")
os.write(2, b"E" * (1024 * 1024) + b"\nstderr-tail\n")
(work_dir / "piece.mp3").write_bytes(b"ID3-render-fixture")
(work_dir / "piece.features.json").write_text(
    json.dumps({"fixture": "final-mp3"}),
    encoding="utf-8",
)
"""
        cancel_event = threading.Event()
        result: dict[str, object] = {}

        def call_render() -> None:
            try:
                result["value"] = self.app._render_code(
                    'setcps(1)\ns("bd")\n',
                    job_id="job_large_output",
                    cancel_event=cancel_event,
                )
            except BaseException as exc:  # surfaced in the assertion thread
                result["error"] = exc

        with self._patched_worker(script):
            worker = threading.Thread(target=call_render)
            worker.start()
            worker.join(timeout=5)
            if worker.is_alive():
                cancel_event.set()
                worker.join(timeout=2)

        self.assertFalse(worker.is_alive(), "render hung while worker logs were large")
        self.assertNotIn("error", result)
        work_dir, audio_path, features = result["value"]  # type: ignore[misc]
        try:
            self.assertEqual(audio_path.read_bytes(), b"ID3-render-fixture")
            self.assertEqual(features, {"fixture": "final-mp3"})
            self.assertFalse((work_dir / ".render.stdout.log").exists())
            self.assertFalse((work_dir / ".render.stderr.log").exists())
            self._assert_reaped(self.children[0])
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    def test_cancellation_terminates_kills_reaps_and_cleans_staging(self) -> None:
        ready_path = self.root / "cancel-ready"
        script = r"""
import os
from pathlib import Path
import signal
import sys
import time

signal.signal(signal.SIGTERM, signal.SIG_IGN)
os.write(1, b"cancel-stdout\n")
os.write(2, b"cancel-stderr\n")
Path(sys.argv[2]).write_text("ready", encoding="utf-8")
while True:
    time.sleep(1)
"""
        cancel_event = threading.Event()
        result: dict[str, object] = {}

        def call_render() -> None:
            try:
                self.app._render_code(
                    'setcps(1)\ns("bd")\n',
                    job_id="job_cancel",
                    cancel_event=cancel_event,
                )
            except BaseException as exc:
                result["error"] = exc

        with (
            self._patched_worker(
                script,
                str(ready_path),
                wait_until=ready_path,
            ),
            patch("v3_api._RENDER_POLL_SECONDS", 0.01),
            patch("v3_api._RENDER_TERM_GRACE_SECONDS", 0.05),
        ):
            worker = threading.Thread(target=call_render)
            worker.start()
            self._wait_for_path(ready_path)
            cancel_event.set()
            worker.join(timeout=3)

        self.assertFalse(worker.is_alive())
        self.assertIsInstance(result.get("error"), JobCancelled)
        self.assertEqual(self.children[0].returncode, -signal.SIGKILL)
        self._assert_reaped(self.children[0])
        self._assert_work_root_empty()

    def test_configured_wall_timeout_kills_reaps_and_cleans_staging(self) -> None:
        ready_path = self.root / "timeout-ready"
        script = r"""
import os
from pathlib import Path
import signal
import sys
import time

signal.signal(signal.SIGTERM, signal.SIG_IGN)
os.write(1, b"timeout-stdout\n")
os.write(2, b"timeout-stderr\n")
Path(sys.argv[2]).write_text("ready", encoding="utf-8")
while True:
    time.sleep(1)
        """
        with (
            self._patched_worker(
                script,
                str(ready_path),
                wait_until=ready_path,
            ),
            patch.dict(
                os.environ,
                {"CACTUS_RENDER_WALL_TIMEOUT_SECONDS": "0.12"},
            ),
            patch("v3_api._RENDER_POLL_SECONDS", 0.01),
            patch("v3_api._RENDER_TERM_GRACE_SECONDS", 0.05),
        ):
            with self.assertRaisesRegex(V3Error, r"0\.12s wall deadline"):
                self.app._render_code(
                    'setcps(1)\ns("bd")\n',
                    job_id="job_timeout",
                    cancel_event=threading.Event(),
                )

        self.assertTrue(ready_path.is_file())
        self.assertEqual(self.children[0].returncode, -signal.SIGKILL)
        self._assert_reaped(self.children[0])
        self._assert_work_root_empty()

    def _patched_worker(
        self,
        script: str,
        *extra_args: str,
        wait_until: Path | None = None,
    ):
        real_popen = subprocess.Popen

        def launch(command, **kwargs):
            child = real_popen(
                [
                    sys.executable,
                    "-c",
                    script,
                    str(command[-1]),
                    *extra_args,
                ],
                cwd=kwargs["cwd"],
                stdout=kwargs["stdout"],
                stderr=kwargs["stderr"],
                start_new_session=kwargs["start_new_session"],
            )
            self.children.append(child)
            if wait_until is not None:
                self._wait_for_path(wait_until)
            return child

        return patch("v3_api.subprocess.Popen", side_effect=launch)

    def _wait_for_path(self, target: Path) -> None:
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if target.is_file():
                return
            if self.children and self.children[0].poll() is not None:
                break
            time.sleep(0.01)
        self.fail(f"fixture child did not become ready: {target}")

    def _assert_reaped(self, child: subprocess.Popen[bytes]) -> None:
        self.assertIsNotNone(child.returncode)
        with self.assertRaises(ChildProcessError):
            os.waitpid(child.pid, os.WNOHANG)

    def _assert_work_root_empty(self) -> None:
        work_root = self.app.state_root / "work"
        self.assertTrue(work_root.is_dir())
        self.assertEqual(list(work_root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
