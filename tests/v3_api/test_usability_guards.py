"""Application-boundary usability guards (DT-003 review hardening).

Pinned Brain context and preview lineage must consult the shared
RevisionUsability seam before any dispatch: a drifted revision is refused as
context or source instead of flowing into a model prompt or a new preview.
"""

from __future__ import annotations

import threading
import unittest
from types import SimpleNamespace
from typing import Any

from .helpers import REPO_ROOT  # noqa: F401 - installs runtime on sys.path

from v3.service import RevisionUsability
from v3_api import Conflict, V3Application


def _unusable(version_id: str) -> RevisionUsability:
    return RevisionUsability(
        version_id=version_id,
        action="brain",
        usable=False,
        reason="receipt file hash drift: audio.mp3",
        audio_sha256=None,
    )


class _FakeStore:
    def __init__(self, piece: dict[str, Any], version: dict[str, Any]):
        self._piece = piece
        self._version = version

    def get_piece(self, piece_id: str) -> dict[str, Any]:
        assert piece_id == self._piece["id"]
        return dict(self._piece)

    def get_version(self, version_id: str) -> dict[str, Any]:
        assert version_id == self._version["id"]
        return dict(self._version)


class UsabilityGuardTests(unittest.TestCase):
    def _fake_app(self) -> V3Application:
        piece = {
            "id": "piece_g",
            "display_name": "GUARD-001",
            "current_version_id": "version_g",
        }
        version = {
            "id": "version_g",
            "piece_id": "piece_g",
            "audio_sha256": "a" * 64,
            "code_sha256": "b" * 64,
        }
        app = object.__new__(V3Application)
        app.truth = SimpleNamespace(
            store=_FakeStore(piece, version),
            revision_usability=lambda _version, action: _unusable("version_g"),
        )
        return app

    def test_pinned_brain_context_refuses_unusable_revision(self) -> None:
        app = self._fake_app()
        app.brain = SimpleNamespace(
            submit=lambda *args, **kwargs: self.fail(
                "unusable context must never reach Brain dispatch"
            )
        )
        with self.assertRaises(Conflict) as caught:
            app.create_brain_job(
                message="what do you hear?",
                piece_id="piece_g",
                revision_id="version_g",
                audio_sha="a" * 64,
            )
        self.assertIn("not usable heard truth", str(caught.exception))

    def test_preview_refuses_unusable_source_revision(self) -> None:
        app = self._fake_app()
        app.truth.create_job = lambda **kwargs: self.fail(
            "unusable source must never reach preview job creation"
        )
        with self.assertRaises(Conflict) as caught:
            app.create_preview(
                piece_id="piece_g",
                source_revision_id="version_g",
                code='s("bd")',
                intent="edit",
                idempotency_key="guard-preview",
                cancel_event=threading.Event(),
            )
        self.assertIn("not usable", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
