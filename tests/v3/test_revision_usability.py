"""DT-003/DT-004: one RevisionUsability seam for list/play/score/promote.

Pre-fix fault: after mutating a committed MP3, receipt verification reported
drift but the static route still served the changed bytes and scoring still
bound a rating to the old database SHA. These tests pin the closure: every
product action consumes the same receipt/identity/byte verdict, the asset
gate refuses drifted or unregistered bytes, and restoring the exact bytes
restores usability.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from runtime.v3 import ReceiptConflict, RuntimeTruth
from runtime.v3.assets import AssetStore

RUNTIME_ROOT = Path(__file__).resolve().parents[2] / "runtime"
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))


class RevisionUsabilityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.runtime = RuntimeTruth(
            repo_root=self.root,
            db_path=self.root / "runtime.sqlite3",
            assets_root=self.root / "assets",
            duration_probe=lambda _: 8.5,
        )
        self.audio = self.root / "render.mp3"
        self.audio.write_bytes(b"ID3" + b"\x01" * 4096)
        self.version = self._commit_revision("version_usable")
        self.asset_dir = self.root / "assets" / "piece_usable" / "version_usable"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _commit_revision(self, version_id: str) -> dict:
        job, _ = self.runtime.create_job(
            kind="generation",
            payload={"prompt": "usability"},
            idempotency_key=f"usability-{version_id}",
        )
        self.runtime.start_job(job["id"], worker_id="worker-usability")
        staged = self.runtime.stage_render(
            job_id=job["id"],
            piece_id="piece_usable",
            version_id=version_id,
            code='setcpm(118/4)\ns("bd hh sd hh")',
            audio_path=self.audio,
            prompt={"compiled_prompt": "usability"},
            features={"rms": -11.0},
        )
        provenance = {
            "provider_route": "cliproxy-responses",
            "model_id": "gpt-5.6-terra",
            "reasoning_effort": "medium",
            "orchestration": "standard",
            "kernel_hash": "kernel-u",
            "validator_mode": "deterministic",
        }
        result = self.runtime.commit_rendered_version(
            staged=staged,
            display_name=f"USABLE-{version_id}",
            provenance=provenance,
            model_run={
                **provenance,
                "request_receipt": {},
                "response_receipt": {},
            },
        )
        return result["version"]

    def test_intact_revision_is_usable_for_every_action(self) -> None:
        for action in ("list", "play", "score", "promote", "brain"):
            verdict = self.runtime.revision_usability(
                self.version["id"], action=action
            )
            self.assertTrue(verdict.usable, action)
            self.assertIsNone(verdict.reason)
            self.assertEqual(verdict.audio_sha256, self.version["audio_sha256"])

    def test_mutated_audio_blocks_score_promote_and_playback(self) -> None:
        audio_path = self.asset_dir / "audio.mp3"
        original = audio_path.read_bytes()
        audio_path.write_bytes(original + b"drifted")

        verdict = self.runtime.revision_usability(self.version["id"], action="list")
        self.assertFalse(verdict.usable)
        self.assertIn("drift", str(verdict.reason))

        with self.assertRaises(ReceiptConflict):
            self.runtime.rate(
                piece_version_id=self.version["id"],
                audio_sha256=self.version["audio_sha256"],
                score=8.0,
                note="must not bind to drifted bytes",
            )
        with self.assertRaises(ReceiptConflict):
            self.runtime.promote_version(
                piece_id="piece_usable", version_id=self.version["id"]
            )
        refusal = self.runtime.asset_request_gate(audio_path)
        assert refusal is not None
        self.assertEqual(refusal[0], 409)
        self.assertIn("not usable for playback", refusal[1]["error"])

        # Restoring the exact bytes restores usability (stat-keyed cache).
        audio_path.write_bytes(original)
        self.assertTrue(
            self.runtime.revision_usability(
                self.version["id"], action="score"
            ).usable
        )
        self.assertIsNone(self.runtime.asset_request_gate(audio_path))
        self.runtime.rate(
            piece_version_id=self.version["id"],
            audio_sha256=self.version["audio_sha256"],
            score=8.0,
            note="restored exact bytes",
        )

    def test_missing_asset_directory_blocks_promotion(self) -> None:
        import shutil

        shutil.rmtree(self.asset_dir)
        verdict = self.runtime.revision_usability(self.version["id"], action="promote")
        self.assertFalse(verdict.usable)
        with self.assertRaises(ReceiptConflict):
            self.runtime.promote_version(
                piece_id="piece_usable", version_id=self.version["id"]
            )

    def test_gate_never_serves_staging_or_unregistered_paths(self) -> None:
        staging_probe = (
            self.root / "assets" / ".staging" / "job--version" / "audio.mp3"
        )
        refusal = self.runtime.asset_request_gate(staging_probe)
        assert refusal is not None
        self.assertEqual(refusal[0], 404)

        foreign_dir = self.root / "assets" / "piece_foreign" / "version_foreign"
        foreign_dir.mkdir(parents=True)
        (foreign_dir / "audio.mp3").write_bytes(b"ID3ghost")
        refusal = self.runtime.asset_request_gate(foreign_dir / "audio.mp3")
        assert refusal is not None
        self.assertEqual(refusal[0], 404)
        self.assertIn("not a registered revision", refusal[1]["error"])

        # receipt.json stays readable as drift evidence.
        self.assertIsNone(
            self.runtime.asset_request_gate(self.asset_dir / "receipt.json")
        )
        # Paths outside the assets root are not this gate's concern.
        self.assertIsNone(
            self.runtime.asset_request_gate(self.root / "package.json")
        )

    def test_receipt_identity_mismatch_is_unusable(self) -> None:
        with self.runtime.database.transaction() as conn:
            conn.execute(
                "UPDATE piece_versions SET audio_sha256 = ? WHERE id = ?",
                ("c" * 64, self.version["id"]),
            )
        self.runtime.invalidate_usability(self.version["id"])
        verdict = self.runtime.revision_usability(self.version["id"], action="play")
        self.assertFalse(verdict.usable)
        self.assertIn("audio_sha256", str(verdict.reason))

    def test_verification_is_cached_until_bytes_change(self) -> None:
        calls = {"n": 0}
        real_load = AssetStore.load_receipt

        def counting_load(store, piece_id, version_id):
            calls["n"] += 1
            return real_load(store, piece_id, version_id)

        with mock.patch.object(AssetStore, "load_receipt", counting_load):
            self.runtime.invalidate_usability()
            first = self.runtime.revision_usability(
                self.version["id"], action="list"
            )
            second = self.runtime.revision_usability(
                self.version["id"], action="play"
            )
        self.assertTrue(first.usable and second.usable)
        self.assertEqual(calls["n"], 1, "steady bytes must not re-verify")

        audio_path = self.asset_dir / "audio.mp3"
        audio_path.write_bytes(audio_path.read_bytes() + b"x")
        with mock.patch.object(AssetStore, "load_receipt", counting_load):
            third = self.runtime.revision_usability(
                self.version["id"], action="list"
            )
        self.assertFalse(third.usable)
        self.assertEqual(calls["n"], 2, "changed bytes must re-verify")

    def test_same_size_replacement_with_preserved_mtime_reverifies(self) -> None:
        import os

        audio_path = self.asset_dir / "audio.mp3"
        self.assertTrue(
            self.runtime.revision_usability(self.version["id"], action="play").usable
        )
        stat = audio_path.stat()
        original = audio_path.read_bytes()
        corrupted = b"X" + original[1:]
        self.assertEqual(len(corrupted), len(original))
        audio_path.write_bytes(corrupted)
        os.utime(audio_path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        after = audio_path.stat()
        self.assertEqual(after.st_mtime_ns, stat.st_mtime_ns)
        self.assertEqual(after.st_size, stat.st_size)
        # ctime moved even though mtime/size were preserved, so the cache key
        # changes and the drifted bytes are re-verified, not trusted.
        verdict = self.runtime.revision_usability(self.version["id"], action="play")
        self.assertFalse(verdict.usable)

    def test_legacy_partial_with_verified_bytes_stays_usable(self) -> None:
        with self.runtime.database.transaction() as conn:
            conn.execute(
                "UPDATE piece_versions SET state = 'legacy_partial' WHERE id = ?",
                (self.version["id"],),
            )
        verdict = self.runtime.revision_usability(self.version["id"], action="score")
        self.assertTrue(
            verdict.usable,
            "exact rendered identity is available, so state alone must not gate",
        )


if __name__ == "__main__":
    unittest.main()
