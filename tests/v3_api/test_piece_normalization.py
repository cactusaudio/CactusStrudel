from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from .helpers import REPO_ROOT  # noqa: F401 - also installs runtime on sys.path

from v3.service import RuntimeTruth
from v3_api import V3Application, V3Error


class PieceNormalizationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.truth = RuntimeTruth(
            repo_root=self.root,
            db_path=self.root / "runtime.sqlite3",
            assets_root=self.root / "producer-brain" / "assets",
            duration_probe=lambda _path: 17.25,
        )
        self.audio = self.root / "render.mp3"
        self.audio.write_bytes(b"ID3" + b"\0" * 256)
        self.app = object.__new__(V3Application)
        # Match V3Application.__init__: macOS resolves /var to /private/var.
        self.app.repo_root = self.root.resolve()
        self.app.truth = self.truth
        self.app.db_path = self.root / "runtime.sqlite3"
        self.app.assets_root = self.root / "producer-brain" / "assets"
        self.app.started_at = "2026-07-28T00:00:00.000Z"
        self.app._publish = lambda *_args, **_kwargs: 1

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _seed_piece(self) -> tuple[dict, dict]:
        job, _ = self.truth.create_job(
            kind="legacy-import",
            payload={"name": "UN-004"},
            idempotency_key="legacy-UN-004",
        )
        self.truth.start_job(job["id"], worker_id="fixture")
        staged = self.truth.stage_render(
            job_id=job["id"],
            piece_id="piece_un004",
            version_id="version_un004",
            code='setcpm(122/4)\nstack(s("bd sd"), note("c3"))\n',
            audio_path=self.audio,
            prompt={
                "mode": "legacy_import",
                "legacy_name": "UN-004",
                "compiled_prompt": "large prompt body must stay in the receipt",
            },
        )
        provenance = {
            "provider_route": "legacy_unknown",
            "model_id": "legacy_unknown",
            "reasoning_effort": None,
            "orchestration": "legacy_unknown",
            "kernel_hash": None,
            "validator_mode": "legacy_unknown",
        }
        committed = self.truth.commit_rendered_version(
            staged=staged,
            display_name="UN-004",
            provenance=provenance,
            model_run={
                "provider_route": "legacy_unknown",
                "model_id": "legacy_unknown",
                "reasoning_effort": None,
                "orchestration": "legacy_unknown",
                "kernel_hash": None,
                "validator_mode": "legacy_unknown",
                "request_receipt": {},
                "response_receipt": {},
            },
            piece_fields={
                "tags": ["duplicate-of:piece_un003", "legacy"],
                "provenance_class": "legacy_partial",
            },
            version_fields={"kind": "legacy", "state": "legacy_partial"},
        )
        return self.truth.store.get_piece("piece_un004"), committed["version"]

    def test_piece_and_revision_are_normalized_without_losing_evidence(self) -> None:
        piece, version = self._seed_piece()
        self.truth.rate(
            piece_version_id=version["id"],
            audio_sha256=version["audio_sha256"],
            score=7.4,
            note="human ear score",
        )

        public = self.app._piece_public(piece)

        self.assertEqual(public["id"], "piece_un004")
        self.assertEqual(public["name"], "UN-004")
        self.assertEqual(public["duplicate_of"], "piece_un003")
        self.assertEqual(public["active_revision_id"], "version_un004")
        self.assertEqual(len(public["revisions"]), 1)
        revision = public["active_revision"]
        self.assertEqual(revision["id"], "version_un004")
        self.assertEqual(revision["label"], "Legacy import")
        self.assertEqual(revision["score"], 7.4)
        self.assertEqual(revision["note"], "human ear score")
        self.assertEqual(revision["duration_seconds"], 17.25)
        self.assertEqual(revision["audio_sha"], version["audio_sha256"])
        self.assertTrue(revision["promoted"])
        self.assertFalse(revision["preview"])
        self.assertTrue(revision["provenance"]["legacy"])
        self.assertEqual(revision["provenance"]["route"], "legacy_unknown")
        self.assertEqual(
            revision["js_url"],
            "/producer-brain/assets/piece_un004/version_un004/piece.js",
        )
        self.assertEqual(
            revision["audio_url"],
            "/producer-brain/assets/piece_un004/version_un004/audio.mp3",
        )
        self.assertEqual(
            revision["prompt_url"],
            "/producer-brain/assets/piece_un004/version_un004/prompt.json",
        )
        self.assertEqual(
            revision["receipt_url"],
            "/producer-brain/assets/piece_un004/version_un004/receipt.json",
        )
        self.assertEqual(
            revision["prompt_summary"],
            {
                "mode": "legacy_import",
                "legacy_name": "UN-004",
                "kernel_hash": None,
                "model_id": "legacy_unknown",
            },
        )
        self.assertNotIn("compiled_prompt", revision["prompt_summary"])
        self.assertNotIn("large prompt body", repr(revision["prompt_summary"]))
        self.assertIn('stack(s("bd sd")', revision["code"])

    def test_latest_rating_wins_when_timestamps_are_equal(self) -> None:
        """The public score must follow insertion order, not random rating IDs."""

        piece, version = self._seed_piece()
        same_time = "2026-07-28T10:00:00.000Z"
        with self.truth.database.transaction() as conn:
            conn.execute(
                """
                INSERT INTO ratings(
                    id,piece_version_id,audio_sha256,score,note,created_at,
                    supersedes_id,source_key
                ) VALUES (?,?,?,?,?,?,NULL,?)
                """,
                (
                    "rating_z_older",
                    version["id"],
                    version["audio_sha256"],
                    2.0,
                    "older",
                    same_time,
                    "older",
                ),
            )
            conn.execute(
                """
                INSERT INTO ratings(
                    id,piece_version_id,audio_sha256,score,note,created_at,
                    supersedes_id,source_key
                ) VALUES (?,?,?,?,?,?,?,?)
                """,
                (
                    "rating_a_newer",
                    version["id"],
                    version["audio_sha256"],
                    9.0,
                    "newer",
                    same_time,
                    "rating_z_older",
                    "newer",
                ),
            )

        revision = self.app._piece_public(piece)["active_revision"]
        self.assertEqual(revision["score"], 9.0)
        self.assertEqual(revision["note"], "newer")

    def test_invalid_multi_field_patch_does_not_partially_archive_piece(self) -> None:
        piece, _version = self._seed_piece()

        with self.assertRaises(V3Error):
            self.app.patch_piece(
                piece["id"],
                {"archived": True, "name": ""},
            )

        readback = self.truth.store.get_piece(piece["id"])
        self.assertIsNone(readback["archived_at"])

    def test_system_settings_exposes_frozen_recovery_plan_without_importing(self) -> None:
        self.app.repo_root = REPO_ROOT

        document = self.app.system_settings_public()

        self.assertEqual(document["recovery_candidate_count"], 4)
        self.assertEqual(len(document["recovery_candidates"]), 4)
        self.assertEqual(
            set(document["recovery_candidates"][0]),
            {
                "task_id",
                "source_line",
                "js",
                "mp3",
                "code_sha",
                "audio_sha",
                "human_decision_required",
            },
        )
        self.assertTrue(
            all(
                row["human_decision_required"]
                for row in document["recovery_candidates"]
            )
        )
        self.assertEqual(self.truth.list_pieces(), [])

    def test_system_settings_has_no_recovery_candidates_without_plan(self) -> None:
        document = self.app.system_settings_public()

        self.assertEqual(document["recovery_candidate_count"], 0)
        self.assertEqual(document["recovery_candidates"], [])


if __name__ == "__main__":
    unittest.main()
