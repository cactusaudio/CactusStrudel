from __future__ import annotations

from types import SimpleNamespace
import tempfile
import threading
import unittest
from pathlib import Path

from .helpers import REPO_ROOT  # noqa: F401 - installs runtime on sys.path

from agent.errors import JobCancelled
from v3_api import V3Application


class _PreviewTruth:
    def __init__(self, root: Path):
        self.root = root
        self.store = self
        self.status = "queued"

    @staticmethod
    def get_piece(piece_id: str):
        return {
            "id": piece_id,
            "display_name": "PIECE-1",
            "current_version_id": "version-1",
        }

    @staticmethod
    def get_version(version_id: str):
        return {
            "id": version_id,
            "piece_id": "piece-1",
            "code_sha256": "a" * 64,
        }

    @staticmethod
    def revision_usability(_version, *, action):
        from types import SimpleNamespace

        return SimpleNamespace(usable=True, reason=None)

    def create_job(self, **_kwargs):
        return {
            "id": "preview-job",
            "status": self.status,
            "result_version_id": None,
        }, True

    def start_job(self, _job_id: str, *, worker_id: str):
        self.status = "running"
        return {"id": "preview-job", "status": self.status, "worker_id": worker_id}

    def get_job(self, _job_id: str):
        return {"id": "preview-job", "status": self.status}

    def request_cancel(self, _job_id: str):
        self.status = "cancel_requested"
        return {"id": "preview-job", "status": self.status}

    def finish_cancel(self, _job_id: str):
        self.status = "cancelled"
        return {"id": "preview-job", "status": self.status}

    def finish_job(self, _job_id: str, *, status: str, error):
        self.status = status
        return {"id": "preview-job", "status": status, "error": error}

    @staticmethod
    def allocate_render_identity(*, piece_id: str):
        return {"piece_id": piece_id, "version_id": "preview-version"}

    def stage_render(self, **_kwargs):
        path = self.root / "staged-preview"
        path.mkdir()
        return SimpleNamespace(path=path)

    def commit_rendered_version(self, **_kwargs):
        self.status = "succeeded"
        return {
            "version": {
                "id": "preview-version",
                "piece_id": "piece-1",
            }
        }


class PreviewConsistencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = object.__new__(V3Application)
        self.app.truth = _PreviewTruth(self.root)
        self.app._validate_code = lambda _code: {"ok": True}
        self.app._revision_public = lambda version, _piece: {
            "id": version["id"],
            "audio_sha": "b" * 64,
        }
        self.app.get_piece = lambda piece_id: {"id": piece_id}
        self.app._activity = lambda *_args, **_kwargs: None
        self.events = []
        self.app._publish = lambda name, payload: self.events.append(
            (name, payload)
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_preview_uses_brain_cancel_event_and_finishes_child_cancelled(self):
        event = threading.Event()

        def cancelled_render(_code, *, job_id, cancel_event):
            self.assertEqual(job_id, "preview-job")
            self.assertIs(cancel_event, event)
            cancel_event.set()
            raise JobCancelled("fixture preview cancellation")

        self.app._render_code = cancelled_render

        with self.assertRaises(JobCancelled):
            self.app.create_preview(
                piece_id="piece-1",
                source_revision_id="version-1",
                code='s("bd")',
                intent="cancel this preview",
                idempotency_key="preview-cancel",
                cancel_event=event,
            )

        self.assertEqual(self.app.truth.status, "cancelled")
        self.assertEqual(self.events, [])

    def test_successful_preview_publishes_piece_update(self):
        work_dir = self.root / "render-work"
        work_dir.mkdir()
        audio = work_dir / "audio.mp3"
        audio.write_bytes(b"ID3")
        self.app._render_code = lambda *_args, **_kwargs: (
            work_dir,
            audio,
            {"duration_seconds": 1.0},
        )

        revision = self.app.create_preview(
            piece_id="piece-1",
            source_revision_id="version-1",
            code='s("bd")',
            intent="preview update",
            idempotency_key="preview-success",
        )

        self.assertEqual(revision["id"], "preview-version")
        self.assertIn(("piece.updated", {"id": "piece-1"}), self.events)


if __name__ == "__main__":
    unittest.main()
