"""BJ-EFFECT-001 probes: observed-effect lookups, never replays.

The mutating Brain tools create durable rows under the deterministic
idempotency key `brain:{job_id}:{call_id}`, so V3Application's effect
reconciler answers "did this effect commit?" with a read, and answers None
for anything it cannot decide.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from .helpers import REPO_ROOT  # noqa: F401 - installs runtime on sys.path

from v3.service import RuntimeTruth
from v3_api import GenerationRepository, V3Application


class EffectProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.app = object.__new__(V3Application)
        self.app.generation_repo = GenerationRepository(root / "runtime.sqlite3")
        self.app.truth = RuntimeTruth(
            repo_root=root,
            db_path=root / "runtime.sqlite3",
            assets_root=root / "assets",
            duration_probe=lambda _: 3.0,
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _probe(self, tool_name: str, arguments: dict) -> dict | None:
        return self.app._reconcile_brain_effect(
            {
                "job_id": "brain-p",
                "call_id": "call-p",
                "tool_name": tool_name,
                "arguments": arguments,
            }
        )

    def test_generation_batch_effect_is_observed_by_key(self) -> None:
        absent = self._probe(
            "generate_first_shots",
            {"count": 1, "producer_brief": "x", "profile_id": "p"},
        )
        assert absent is not None
        self.assertFalse(absent["observed"])

        batch, _ = self.app.generation_repo.create(
            count=1,
            prompt="x",
            profile_id="p",
            idempotency_key="brain:brain-p:call-p",
        )
        present = self._probe(
            "generate_first_shots",
            {"count": 1, "producer_brief": "x", "profile_id": "p"},
        )
        assert present is not None
        self.assertTrue(present["observed"])
        self.assertEqual(present["identity"]["batch_id"], batch["id"])

    def test_preview_job_effect_is_observed_by_key(self) -> None:
        absent = self._probe(
            "render_piece_preview",
            {"piece_id": "p", "source_revision_id": "v", "code": "s()"},
        )
        assert absent is not None
        self.assertFalse(absent["observed"])

        job, _ = self.app.truth.create_job(
            kind="render-preview",
            payload={"piece_id": "p"},
            idempotency_key="brain:brain-p:call-p",
        )
        present = self._probe(
            "render_piece_preview",
            {"piece_id": "p", "source_revision_id": "v", "code": "s()"},
        )
        assert present is not None
        self.assertTrue(present["observed"])
        self.assertEqual(present["identity"]["job_id"], job["id"])

    def test_unknown_tool_and_archive_return_none(self) -> None:
        self.assertIsNone(self._probe("score_revision", {}))
        # set_piece_archived deliberately has no probe: mutable current
        # state cannot prove the effect either way, so it always stays
        # reconciliation_required for a human.
        self.assertIsNone(
            self._probe(
                "set_piece_archived",
                {"piece_id": "piece-any", "archived": True},
            )
        )


if __name__ == "__main__":
    unittest.main()
