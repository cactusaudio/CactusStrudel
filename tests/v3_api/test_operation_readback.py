"""IDEM-001 server half: exact prior outcome by idempotency key.

A restored UI must be able to ask what one idempotency key already did —
generation batch, Brain job, preview job, or score — before creating any new
durable operation.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from .helpers import REPO_ROOT  # noqa: F401 - installs runtime on sys.path

from agent.job_store import BrainJobStore
from v3.service import RuntimeTruth
from v3_api import GenerationRepository, V3Application, V3Error


class OperationReadbackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.app = object.__new__(V3Application)
        self.app.generation_repo = GenerationRepository(root / "runtime.sqlite3")
        self.app.brain_store = BrainJobStore(root / "runtime.sqlite3")
        self.app.truth = RuntimeTruth(
            repo_root=root,
            db_path=root / "runtime.sqlite3",
            assets_root=root / "assets",
            duration_probe=lambda _: 4.0,
        )
        self.app._generation_public = lambda row: {
            "id": row["id"],
            "state": row["status"],
        }
        self.app._brain_public = lambda job: {
            "id": job["job_id"],
            "state": job["status"],
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_unknown_key_reports_not_found(self) -> None:
        result = self.app.operation_readback("producer-ui-never-used")
        self.assertEqual(
            result, {"found": False, "kind": None, "operation": None}
        )

    def test_invalid_key_is_rejected(self) -> None:
        with self.assertRaises(V3Error):
            self.app.operation_readback("")
        with self.assertRaises(V3Error):
            self.app.operation_readback("x" * 200)

    def test_generation_key_returns_batch_outcome(self) -> None:
        batch, _ = self.app.generation_repo.create(
            count=1,
            prompt="restored",
            profile_id="p",
            idempotency_key="producer-ui-gen-1",
        )
        result = self.app.operation_readback("producer-ui-gen-1")
        self.assertTrue(result["found"])
        self.assertEqual(result["kind"], "generation")
        self.assertEqual(result["operation"]["id"], batch["id"])

    def test_brain_key_returns_job_outcome(self) -> None:
        job = self.app.brain_store.create_job(
            config_revision_id="agentcfg-1",
            input_text="restored brain",
            toolset_id="music",
            idempotency_key="producer-ui-brain-1",
        )
        result = self.app.operation_readback("producer-ui-brain-1")
        self.assertTrue(result["found"])
        self.assertEqual(result["kind"], "brain")
        self.assertEqual(result["operation"]["id"], job["job_id"])

    def test_preview_key_returns_job_and_piece_identity(self) -> None:
        job, _ = self.app.truth.create_job(
            kind="render-preview",
            payload={"piece_id": "piece-r"},
            idempotency_key="producer-ui-preview-1",
        )
        result = self.app.operation_readback("producer-ui-preview-1")
        self.assertTrue(result["found"])
        self.assertEqual(result["kind"], "preview")
        self.assertEqual(result["operation"]["job_id"], job["id"])
        self.assertEqual(result["operation"]["status"], "queued")

    def test_score_key_returns_rating_outcome(self) -> None:
        audio = Path(self.temp.name) / "render.mp3"
        audio.write_bytes(b"ID3" + b"\x02" * 1024)
        job, _ = self.app.truth.create_job(
            kind="generation",
            payload={"prompt": "score me"},
            idempotency_key="score-fixture-job",
        )
        self.app.truth.start_job(job["id"], worker_id="w")
        staged = self.app.truth.stage_render(
            job_id=job["id"],
            piece_id="piece_score",
            version_id="version_score",
            code='s("bd")',
            audio_path=audio,
        )
        provenance = {"provider_route": "x", "model_id": "m"}
        self.app.truth.commit_rendered_version(
            staged=staged,
            display_name="SCORE-001",
            provenance=provenance,
            model_run={
                **provenance,
                "request_receipt": {},
                "response_receipt": {},
            },
        )
        version = self.app.truth.store.get_version("version_score")
        self.app.truth.rate(
            piece_version_id="version_score",
            audio_sha256=version["audio_sha256"],
            score=8.5,
            note="restored score",
            source_key="producer-ui-score-1",
        )
        result = self.app.operation_readback("producer-ui-score-1")
        self.assertTrue(result["found"])
        self.assertEqual(result["kind"], "score")
        self.assertEqual(result["operation"]["score"], 8.5)
        self.assertEqual(result["operation"]["revision_id"], "version_score")


if __name__ == "__main__":
    unittest.main()
