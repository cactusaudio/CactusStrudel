"""B4: repo-owned backup/restore with verify-before-adopt.

The archive must capture database + agent state + generation config +
immutable assets, verify every byte against its manifest at restore, refuse
to clobber live state without force, and produce a state root whose
receipts fully reconcile after adoption.
"""

from __future__ import annotations

import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

from runtime.v3 import RuntimeTruth
from runtime.v3.backup import (
    BackupError,
    create_backup,
    restore_backup,
)

RUNTIME_ROOT = Path(__file__).resolve().parents[2] / "runtime"
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))


class BackupRestoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = self.root / "state"
        self.assets = self.root / "assets"
        self.runtime = RuntimeTruth(
            repo_root=self.root,
            db_path=self.state / "runtime.sqlite3",
            assets_root=self.assets,
            duration_probe=lambda _: 6.5,
        )
        (self.state / "agent").mkdir(parents=True, exist_ok=True)
        (self.state / "agent" / "state.json").write_text(
            '{"schema_version": 3}', encoding="utf-8"
        )
        (self.state / "generation.json").write_text(
            '{"schema_version": 1}', encoding="utf-8"
        )
        audio = self.root / "render.mp3"
        audio.write_bytes(b"ID3" + b"\x07" * 2048)
        job, _ = self.runtime.create_job(
            kind="generation",
            payload={"prompt": "backup me"},
            idempotency_key="backup-fixture",
        )
        self.runtime.start_job(job["id"], worker_id="w")
        staged = self.runtime.stage_render(
            job_id=job["id"],
            piece_id="piece_backup",
            version_id="version_backup",
            code='s("bd sd")',
            audio_path=audio,
        )
        provenance = {"provider_route": "x", "model_id": "m"}
        self.runtime.commit_rendered_version(
            staged=staged,
            display_name="BACKUP-001",
            provenance=provenance,
            model_run={
                **provenance,
                "request_receipt": {},
                "response_receipt": {},
            },
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_round_trip_restores_identical_verified_truth(self) -> None:
        result = create_backup(
            state_root=self.state,
            assets_root=self.assets,
        )
        archive = Path(result["archive"])
        self.assertTrue(archive.is_file())
        self.assertGreater(result["files"], 3)

        # Restore contract: the new machine keeps the SAME repo-relative
        # layout (receipts record repo-relative asset paths), so the target
        # is a fresh root with assets at the same relative location.
        new_root = self.root / "machine-b"
        new_root.mkdir()
        restored_state = new_root / "state"
        restored_assets = new_root / "assets"
        outcome = restore_backup(
            archive=archive,
            state_root=restored_state,
            assets_root=restored_assets,
        )
        self.assertEqual(outcome["verified_files"], result["files"])
        self.assertTrue(outcome["restored_assets"])

        recovered = RuntimeTruth(
            repo_root=new_root,
            db_path=restored_state / "runtime.sqlite3",
            assets_root=restored_assets,
            duration_probe=lambda _: 6.5,
        )
        version = recovered.store.get_version("version_backup")
        self.assertEqual(version["piece_id"], "piece_backup")
        verdict = recovered.revision_usability("version_backup", action="play")
        self.assertTrue(verdict.usable, verdict.reason)
        reconciliation = recovered.reconcile_receipts()
        self.assertEqual(len(reconciliation["matched"]), 1)
        self.assertEqual(reconciliation["orphan_promoted"], [])
        self.assertEqual(
            (restored_state / "agent" / "state.json").read_text(
                encoding="utf-8"
            ),
            '{"schema_version": 3}',
        )

    def test_restore_refuses_live_state_without_force(self) -> None:
        result = create_backup(state_root=self.state, assets_root=self.assets)
        with self.assertRaises(BackupError):
            restore_backup(
                archive=result["archive"],
                state_root=self.state,
                assets_root=self.root / "elsewhere",
            )

    def test_restore_refuses_byte_drift(self) -> None:
        result = create_backup(
            state_root=self.state,
            assets_root=self.assets,
            output_dir=self.root / "out",
        )
        archive = Path(result["archive"])
        tampered = self.root / "tampered.tar.gz"
        with tempfile.TemporaryDirectory() as tmp:
            staging = Path(tmp)
            with tarfile.open(archive, "r:gz") as tar:
                tar.extractall(staging, filter="data")
            target = staging / "assets" / "piece_backup" / "version_backup" / "audio.mp3"
            target.write_bytes(target.read_bytes() + b"drift")
            with tarfile.open(tampered, "w:gz") as tar:
                for entry in sorted(staging.rglob("*")):
                    if entry.is_file():
                        tar.add(entry, arcname=entry.relative_to(staging).as_posix())
        with self.assertRaisesRegex(BackupError, "byte drift"):
            restore_backup(
                archive=tampered,
                state_root=self.root / "fresh-state",
                assets_root=self.root / "fresh-assets",
            )

    def test_backup_excludes_staging_and_lock_liveness(self) -> None:
        staging_dir = self.assets / ".staging" / "job--v"
        staging_dir.mkdir(parents=True)
        (staging_dir / "audio.mp3").write_bytes(b"partial")
        (self.state / "owner.lock").write_bytes(b"")
        result = create_backup(
            state_root=self.state,
            assets_root=self.assets,
            output_dir=self.root / "out2",
        )
        with tarfile.open(result["archive"], "r:gz") as tar:
            names = tar.getnames()
        self.assertFalse(any(".staging" in name for name in names))
        self.assertFalse(any("owner.lock" in name for name in names))


if __name__ == "__main__":
    unittest.main()
