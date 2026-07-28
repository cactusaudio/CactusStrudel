from __future__ import annotations

import json
import math
import shutil
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from runtime.v3 import (
    Database,
    IdempotencyConflict,
    ReceiptConflict,
    RuntimeTruth,
)
from runtime.v3.db import MIGRATION_1

RUNTIME_ROOT = Path(__file__).resolve().parents[2] / "runtime"
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))

from v3_api import Conflict, GenerationRepository  # noqa: E402


class RuntimeTruthTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.runtime = RuntimeTruth(
            repo_root=self.root,
            db_path=self.root / "runtime.sqlite3",
            assets_root=self.root / "assets",
            duration_probe=lambda _: 12.5,
        )
        self.audio = self.root / "render.mp3"
        self.audio.write_bytes(b"ID3" + b"\x00" * 1024)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_default_database_uses_canonical_state_root(self) -> None:
        state_root = self.root / "canonical-state"
        with mock.patch.dict(
            "os.environ", {"CACTUS_V3_STATE_ROOT": str(state_root)}, clear=False
        ):
            runtime = RuntimeTruth(repo_root=self.root)
        self.assertEqual(
            runtime.database.path, (state_root / "runtime.sqlite3").resolve()
        )

    def _running_job(self, key: str = "request-1") -> dict:
        job, created = self.runtime.create_job(
            kind="generation",
            payload={"prompt": "anything", "best_of_n": 1},
            idempotency_key=key,
        )
        self.assertTrue(created)
        return self.runtime.start_job(job["id"], worker_id="worker-a")

    def _stage(
        self,
        job: dict,
        *,
        piece_id: str = "piece_test",
        version_id: str = "version_test",
    ):
        return self.runtime.stage_render(
            job_id=job["id"],
            piece_id=piece_id,
            version_id=version_id,
            code='setcpm(120/4)\ns("bd sd")',
            audio_path=self.audio,
            prompt={"compiled_prompt": "exact"},
            features={"rms": -10.0},
        )

    @staticmethod
    def _provenance() -> dict:
        return {
            "provider_route": "cliproxy-responses",
            "model_id": "gpt-5.6-terra",
            "reasoning_effort": "medium",
            "orchestration": "standard",
            "kernel_hash": "kernel-1",
            "validator_mode": "deterministic",
        }

    def _model_run(self) -> dict:
        return {
            "provider_route": "cliproxy-responses",
            "model_id": "gpt-5.6-terra",
            "reasoning_effort": "medium",
            "orchestration": "standard",
            "kernel_hash": "kernel-1",
            "validator_mode": "deterministic",
            "request_receipt": {"request_id": "req-upstream-1"},
            "response_receipt": {"response_id": "resp-upstream-1"},
        }

    def test_schema_contains_all_operational_tables(self) -> None:
        expected = {
            "pieces",
            "piece_versions",
            "ratings",
            "model_runs",
            "jobs",
            "job_events",
            "brain_sessions",
            "brain_turns",
            "tool_calls",
            "settings_revisions",
            "settings_tests",
            "schema_migrations",
            "render_commit_intents",
        }
        with self.runtime.database.transaction(immediate=False) as conn:
            actual = {
                row["name"]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
        self.assertTrue(expected.issubset(actual))
        self.assertEqual(self.runtime.database.schema_version(), 3)

    def test_schema_migrates_an_existing_v1_database_to_v2(self) -> None:
        path = self.root / "legacy-v1.sqlite3"
        database = Database(path)
        connection = database.connect()
        connection.execute(
            """
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) STRICT
            """
        )
        connection.executescript(MIGRATION_1)
        connection.execute("INSERT INTO schema_migrations(version) VALUES (1)")
        connection.close()

        self.assertEqual(database.initialize(), 3)
        connection = database.connect()
        rating_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(ratings)")
        }
        connection.close()
        self.assertIn("source_key", rating_columns)

    def test_concurrent_initializers_serialize_nonrepeatable_migrations(self) -> None:
        path = self.root / "concurrent-init.sqlite3"

        def initialize(_: int) -> int:
            return Database(path).initialize()

        with ThreadPoolExecutor(max_workers=6) as pool:
            versions = list(pool.map(initialize, range(12)))
        self.assertEqual(versions, [3] * 12)
        connection = Database(path).connect()
        self.assertEqual(
            connection.execute(
                "SELECT COUNT(*) AS n FROM schema_migrations"
            ).fetchone()["n"],
            3,
        )
        connection.close()

    def test_job_create_is_idempotent_and_event_seq_is_monotonic(self) -> None:
        first, created = self.runtime.create_job(
            kind="generation",
            payload={"prompt": "a"},
            idempotency_key="same",
        )
        second, created_again = self.runtime.create_job(
            kind="generation",
            payload={"prompt": "a"},
            idempotency_key="same",
        )
        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(first["id"], second["id"])
        with self.assertRaises(IdempotencyConflict):
            self.runtime.create_job(
                kind="generation",
                payload={"prompt": "different"},
                idempotency_key="same",
            )

        self.runtime.start_job(first["id"], worker_id="worker")
        self.runtime.store.append_job_event(
            first["id"], "worker.progress", {"stage": "model"}
        )
        events = self.runtime.store.events_after()
        self.assertEqual(
            [event["seq"] for event in events],
            sorted(event["seq"] for event in events),
        )
        self.assertEqual(len({event["seq"] for event in events}), len(events))

    def test_concurrent_same_request_creates_one_job(self) -> None:
        def create_once(_: int) -> tuple[str, bool]:
            job, created = self.runtime.create_job(
                kind="generation",
                payload={"prompt": "same concurrent request"},
                idempotency_key="concurrent-request",
            )
            return job["id"], created

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(create_once, range(24)))
        self.assertEqual(len({job_id for job_id, _ in results}), 1)
        self.assertEqual(sum(int(created) for _, created in results), 1)
        events = self.runtime.store.events_after()
        created_events = [
            event
            for event in events
            if event["event_type"] == "job.created"
            and event["payload_json"]["request_sha256"]
        ]
        self.assertEqual(len(created_events), 1)

    def test_assets_promote_atomically_and_success_registers_once(self) -> None:
        job = self._running_job()
        staged = self._stage(job)
        self.assertTrue((staged.path / "staging.json").is_file())
        self.assertFalse(
            (self.root / "assets" / "piece_test" / "version_test").exists()
        )

        result = self.runtime.commit_rendered_version(
            staged=staged,
            display_name="TEST-001",
            provenance=self._provenance(),
            model_run=self._model_run(),
        )
        target = self.root / "assets" / "piece_test" / "version_test"
        self.assertFalse(staged.path.exists())
        self.assertTrue((target / "piece.js").is_file())
        self.assertTrue((target / "audio.mp3").is_file())
        self.assertTrue((target / "receipt.json").is_file())
        self.assertEqual(result["job"]["status"], "succeeded")
        self.assertEqual(result["version"]["duration_seconds"], 12.5)
        self.assertEqual(
            result["version"]["audio_sha256"],
            result["receipt"]["files"]["audio.mp3"]["sha256"],
        )
        self.runtime.assets.verify_receipt(result["receipt"])

        # Repeating terminal registration with the same receipt is a readback,
        # not a second piece/version/model-run insertion.
        repeated = self.runtime.store.register_render_success(
            job_id=job["id"],
            receipt=result["receipt"],
            piece={"id": "piece_test", "display_name": "TEST-001"},
            version={
                "id": "version_test",
                "provenance": self._provenance(),
            },
            model_run=self._model_run(),
        )
        self.assertEqual(repeated["id"], "version_test")
        with self.runtime.database.transaction(immediate=False) as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) AS n FROM piece_versions").fetchone()[
                    "n"
                ],
                1,
            )
            self.assertEqual(
                conn.execute("SELECT COUNT(*) AS n FROM model_runs").fetchone()["n"],
                1,
            )

        conflicting = dict(result["receipt"])
        conflicting["receipt_sha256"] = "f" * 64
        with self.assertRaises(ReceiptConflict):
            self.runtime.store.register_render_success(
                job_id=job["id"],
                receipt=conflicting,
                piece={"id": "piece_test", "display_name": "TEST-001"},
                version={
                    "id": "version_test",
                    "provenance": self._provenance(),
                },
                model_run=self._model_run(),
            )

    def test_reconcile_reports_registered_version_without_valid_receipt(self) -> None:
        job = self._running_job("registered-missing")
        result = self.runtime.commit_rendered_version(
            staged=self._stage(
                job,
                piece_id="piece_registered_missing",
                version_id="version_registered_missing",
            ),
            display_name="REGISTERED-MISSING-001",
            provenance=self._provenance(),
            model_run=self._model_run(),
        )
        asset_dir = (
            self.root
            / "assets"
            / "piece_registered_missing"
            / "version_registered_missing"
        )
        shutil.rmtree(asset_dir)

        reconciliation = self.runtime.reconcile_receipts()

        self.assertEqual(reconciliation["matched"], [])
        self.assertEqual(reconciliation["orphan_promoted"], [])
        self.assertEqual(reconciliation["invalid"], [])
        self.assertEqual(
            reconciliation["registered_without_valid_receipt"],
            [
                {
                    "classification": "registered_without_valid_receipt",
                    "human_decision_required": True,
                    "receipt_sha256": result["receipt"]["receipt_sha256"],
                    "version_id": "version_registered_missing",
                    "piece_id": "piece_registered_missing",
                    "asset_dir": result["receipt"]["asset_dir"],
                    "created_by_job_id": result["job"]["id"],
                }
            ],
        )

    def test_reconcile_rejects_sha_match_with_wrong_registered_asset_dir(
        self,
    ) -> None:
        job = self._running_job("registered-identity-mismatch")
        result = self.runtime.commit_rendered_version(
            staged=self._stage(
                job,
                piece_id="piece_registered_mismatch",
                version_id="version_registered_mismatch",
            ),
            display_name="REGISTERED-MISMATCH-001",
            provenance=self._provenance(),
            model_run=self._model_run(),
        )
        wrong_asset_dir = "producer-brain/assets/wrong/registered-path"
        with self.runtime.database.transaction() as conn:
            conn.execute(
                "UPDATE piece_versions SET asset_dir = ? WHERE id = ?",
                (wrong_asset_dir, "version_registered_mismatch"),
            )

        reconciliation = self.runtime.reconcile_receipts()

        self.assertEqual(reconciliation["matched"], [])
        self.assertEqual(reconciliation["orphan_promoted"], [])
        self.assertEqual(reconciliation["invalid"], [])
        self.assertEqual(
            reconciliation["registered_receipt_identity_mismatch"],
            [
                {
                    "classification": "registered_receipt_identity_mismatch",
                    "human_decision_required": True,
                    "receipt_sha256": result["receipt"]["receipt_sha256"],
                    "mismatched_fields": ["asset_dir"],
                    "registered_identity": {
                        "piece_id": "piece_registered_mismatch",
                        "version_id": "version_registered_mismatch",
                        "asset_dir": wrong_asset_dir,
                        "created_by_job_id": result["job"]["id"],
                    },
                    "receipt_identity": {
                        "piece_id": "piece_registered_mismatch",
                        "version_id": "version_registered_mismatch",
                        "asset_dir": result["receipt"]["asset_dir"],
                        "job_id": result["job"]["id"],
                    },
                }
            ],
        )
        self.assertEqual(
            reconciliation["registered_without_valid_receipt"],
            [
                {
                    "classification": "registered_without_valid_receipt",
                    "human_decision_required": True,
                    "receipt_sha256": result["receipt"]["receipt_sha256"],
                    "version_id": "version_registered_mismatch",
                    "piece_id": "piece_registered_mismatch",
                    "asset_dir": wrong_asset_dir,
                    "created_by_job_id": result["job"]["id"],
                }
            ],
        )

    def test_cancel_before_and_across_commit_barrier_are_truthful(self) -> None:
        before = self._running_job("cancel-before")
        staged_before = self._stage(
            before, piece_id="piece_before", version_id="version_before"
        )
        self.runtime.request_cancel(before["id"])
        result = self.runtime.commit_rendered_version(
            staged=staged_before,
            display_name="BEFORE-001",
            provenance=self._provenance(),
            model_run=self._model_run(),
        )
        self.assertEqual(result["job"]["status"], "cancelled")
        self.assertIsNone(result["version"])
        self.assertFalse(
            (self.root / "assets" / "piece_before" / "version_before").exists()
        )

        crossed = self._running_job("cancel-crossed")
        staged_crossed = self._stage(
            crossed, piece_id="piece_crossed", version_id="version_crossed"
        )
        receipt = self.runtime.assets.promote(
            staged_crossed, provenance=self._provenance()
        )
        self.runtime.request_cancel(crossed["id"])
        version = self.runtime.store.register_render_success(
            job_id=crossed["id"],
            receipt=receipt,
            piece={"id": "piece_crossed", "display_name": "CROSSED-001"},
            version={
                "id": "version_crossed",
                "provenance": self._provenance(),
            },
            model_run=self._model_run(),
        )
        self.assertEqual(version["id"], "version_crossed")
        self.assertEqual(
            self.runtime.store.get_job(crossed["id"])["status"],
            "cancelled_after_commit",
        )

    def test_restart_recovery_interrupts_only_inflight_jobs(self) -> None:
        running = self._running_job("running")
        queued, _ = self.runtime.create_job(
            kind="brain", payload={"text": "x"}, idempotency_key="queued"
        )
        recovered = self.runtime.recover_after_restart()
        self.assertEqual(recovered["interrupted_job_ids"], [running["id"]])
        self.assertEqual(
            self.runtime.store.get_job(running["id"])["status"], "interrupted"
        )
        self.assertEqual(self.runtime.store.get_job(queued["id"])["status"], "queued")

    def test_generation_finish_uses_durable_commit_and_cancelling_state(self) -> None:
        batches = GenerationRepository(self.root / "runtime.sqlite3")
        batch, _ = batches.create(
            count=2,
            prompt="finish from durable children",
            profile_id="fixture",
            idempotency_key="batch-finish",
        )
        committed, _ = self.runtime.create_job(
            kind="generation",
            payload={"batch_id": batch["id"], "shot_index": 0},
            idempotency_key="batch-finish-child-0",
        )
        self.runtime.start_job(committed["id"], worker_id="worker-0")
        result = self.runtime.commit_rendered_version(
            staged=self._stage(
                committed,
                piece_id="piece_batch_finish",
                version_id="version_batch_finish",
            ),
            display_name="BATCH-FINISH-001",
            provenance=self._provenance(),
            model_run=self._model_run(),
        )
        queued, _ = self.runtime.create_job(
            kind="generation",
            payload={"batch_id": batch["id"], "shot_index": 1},
            idempotency_key="batch-finish-child-1",
        )
        for child in (committed, queued):
            batches.record_child(batch["id"], child["id"])
        batches.set_running(batch["id"], [committed["id"], queued["id"]])
        batches.request_cancel(batch["id"])
        # GEN-TERM-001: the parent cannot terminalize around a live child.
        with self.assertRaises(Conflict):
            batches.finish(
                batch["id"], status="done", piece_ids=["caller-must-not-win"]
            )
        # The runtime cancel path terminalizes the never-started child first.
        self.runtime.request_cancel(queued["id"])

        finished = batches.finish(
            batch["id"],
            status="done",
            piece_ids=["caller-must-not-win"],
        )

        self.assertEqual(finished["status"], "cancelled_after_commit")
        self.assertEqual(
            finished["piece_ids"],
            [result["version"]["piece_id"]],
        )

    def test_queued_batch_cancel_terminalizes_recorded_children(self) -> None:
        batches = GenerationRepository(self.root / "runtime.sqlite3")
        batch, _ = batches.create(
            count=2,
            prompt="cancel while queued",
            profile_id="fixture",
            idempotency_key="batch-queued-cancel",
        )
        child, _ = self.runtime.create_job(
            kind="generation",
            payload={"batch_id": batch["id"], "shot_index": 0},
            idempotency_key="batch-queued-cancel-child-0",
        )
        batches.record_child(batch["id"], child["id"])

        cancelled = batches.request_cancel(batch["id"])
        self.assertEqual(cancelled["status"], "cancelled")
        # Same transaction: the recorded child cannot strand behind the
        # terminal parent even if the process dies right after this commit.
        self.assertEqual(self.runtime.get_job(child["id"])["status"], "cancelled")
        with self.assertRaises(Conflict):
            batches.record_child(batch["id"], "job_late_allocation")

    def test_recovery_sweeps_children_stranded_behind_terminal_parent(
        self,
    ) -> None:
        batches = GenerationRepository(self.root / "runtime.sqlite3")
        batch, _ = batches.create(
            count=1,
            prompt="stranded child",
            profile_id="fixture",
            idempotency_key="batch-stranded",
        )
        child, _ = self.runtime.create_job(
            kind="generation",
            payload={"batch_id": batch["id"], "shot_index": 0},
            idempotency_key="batch-stranded-child-0",
        )
        batches.record_child(batch["id"], child["id"])
        # Simulate the pre-fix crash artifact: parent terminal, child queued.
        with self.runtime.database.transaction() as conn:
            conn.execute(
                """
                UPDATE generation_batches
                   SET status='cancelled', finished_at=?
                 WHERE id=?
                """,
                ("2026-07-28T00:00:00Z", batch["id"]),
            )
        self.assertEqual(self.runtime.get_job(child["id"])["status"], "queued")

        batches.recover_interrupted()
        recovered = self.runtime.get_job(child["id"])
        self.assertEqual(recovered["status"], "interrupted")
        self.assertIn(
            "already terminal at restart",
            recovered["error_json"]["message"],
        )

    def test_generation_finish_abandons_live_children_only_explicitly(self) -> None:
        batches = GenerationRepository(self.root / "runtime.sqlite3")
        batch, _ = batches.create(
            count=1,
            prompt="abandon after bounded drain",
            profile_id="fixture",
            idempotency_key="batch-abandon",
        )
        child, _ = self.runtime.create_job(
            kind="generation",
            payload={"batch_id": batch["id"], "shot_index": 0},
            idempotency_key="batch-abandon-child-0",
        )
        self.runtime.start_job(child["id"], worker_id="worker-live")
        batches.record_child(batch["id"], child["id"])
        batches.set_running(batch["id"], [child["id"]])

        with self.assertRaises(Conflict):
            batches.finish(batch["id"], status="failed", piece_ids=[])

        finished = batches.finish(
            batch["id"],
            status="failed",
            piece_ids=[],
            error="render worker hung",
            abandon_running=True,
        )
        self.assertEqual(finished["status"], "failed")
        recovered_child = self.runtime.get_job(child["id"])
        self.assertEqual(recovered_child["status"], "interrupted")
        self.assertIn(
            "abandoned by generation batch finalization",
            recovered_child["error_json"]["message"],
        )

    def test_generation_recovery_reconciles_children_and_interrupts_dangling_jobs(
        self,
    ) -> None:
        batches = GenerationRepository(self.root / "runtime.sqlite3")
        batch, _ = batches.create(
            count=4,
            prompt="recover durable children",
            profile_id="fixture",
            idempotency_key="batch-recover",
        )
        children = []
        for index in range(4):
            child, _ = self.runtime.create_job(
                kind="generation",
                payload={"batch_id": batch["id"], "shot_index": index},
                idempotency_key=f"batch-recover-child-{index}",
            )
            children.append(child)
            batches.record_child(batch["id"], child["id"])
        committed = self.runtime.start_job(
            children[0]["id"], worker_id="worker-committed"
        )
        result = self.runtime.commit_rendered_version(
            staged=self._stage(
                committed,
                piece_id="piece_batch_recover",
                version_id="version_batch_recover",
            ),
            display_name="BATCH-RECOVER-001",
            provenance=self._provenance(),
            model_run=self._model_run(),
        )
        self.runtime.start_job(children[2]["id"], worker_id="worker-dangling")
        self.runtime.store.finish_job(
            children[3]["id"],
            status="failed",
            error={"message": "known child failure"},
        )
        batches.set_running(
            batch["id"], [child["id"] for child in children]
        )
        # Simulate the narrow crash window after child creation but before its
        # parent mapping was flushed. Recovery must discover those jobs by
        # their durable batch payload.
        with self.runtime.database.transaction() as conn:
            conn.execute(
                """
                UPDATE generation_batches SET child_job_ids_json=?
                 WHERE id=?
                """,
                (json.dumps([children[0]["id"], children[1]["id"]]), batch["id"]),
            )

        self.assertEqual(batches.recover_interrupted(), [batch["id"]])
        recovered = batches.get(batch["id"])

        self.assertEqual(recovered["status"], "interrupted")
        self.assertEqual(
            recovered["child_job_ids"],
            [child["id"] for child in children],
        )
        self.assertEqual(
            recovered["piece_ids"],
            [result["version"]["piece_id"]],
        )
        self.assertEqual(
            self.runtime.get_job(children[1]["id"])["status"], "interrupted"
        )
        self.assertEqual(
            self.runtime.get_job(children[2]["id"])["status"], "interrupted"
        )
        self.assertEqual(
            self.runtime.get_job(children[3]["id"])["status"], "failed"
        )

    def test_rating_is_bound_to_version_audio_hash_and_finite_range(self) -> None:
        job = self._running_job()
        staged = self._stage(job)
        result = self.runtime.commit_rendered_version(
            staged=staged,
            display_name="TEST-001",
            provenance=self._provenance(),
            model_run=self._model_run(),
        )
        version = result["version"]
        rating = self.runtime.rate(
            piece_version_id=version["id"],
            audio_sha256=version["audio_sha256"],
            score=7.5,
            note="human ear",
        )
        self.assertEqual(rating["score"], 7.5)
        with self.assertRaises(ReceiptConflict):
            self.runtime.rate(
                piece_version_id=version["id"],
                audio_sha256="0" * 64,
                score=7.0,
            )
        for invalid in (-0.1, 10.1, math.nan, math.inf):
            with self.assertRaises(ValueError):
                self.runtime.rate(
                    piece_version_id=version["id"],
                    audio_sha256=version["audio_sha256"],
                    score=invalid,
                )

    def test_preview_does_not_replace_current_until_promoted_and_archive_restores(
        self,
    ) -> None:
        original_job = self._running_job("original")
        self.runtime.commit_rendered_version(
            staged=self._stage(
                original_job, piece_id="piece_ab", version_id="version_a"
            ),
            display_name="AB-001",
            provenance=self._provenance(),
            model_run=self._model_run(),
        )
        self.assertEqual(
            self.runtime.store.get_piece("piece_ab")["current_version_id"],
            "version_a",
        )

        preview_job = self._running_job("preview")
        preview = self.runtime.commit_rendered_version(
            staged=self._stage(
                preview_job, piece_id="piece_ab", version_id="version_b"
            ),
            display_name="AB-001",
            provenance=self._provenance(),
            model_run=self._model_run(),
            version_fields={
                "kind": "preview",
                "parent_version_id": "version_a",
            },
        )
        self.assertEqual(preview["version"]["kind"], "preview")
        self.assertEqual(
            self.runtime.store.get_piece("piece_ab")["current_version_id"],
            "version_a",
        )

        promoted = self.runtime.promote_version(
            piece_id="piece_ab", version_id="version_b"
        )
        self.assertEqual(promoted["kind"], "revision")
        self.assertEqual(
            self.runtime.store.get_piece("piece_ab")["current_version_id"],
            "version_b",
        )
        self.assertEqual(
            self.runtime.store.get_version("version_a")["state"], "superseded"
        )

        self.runtime.archive_piece("piece_ab")
        self.assertEqual(self.runtime.list_pieces(), [])
        self.assertEqual(len(self.runtime.list_pieces(include_archived=True)), 1)
        self.runtime.restore_piece("piece_ab")
        self.assertEqual(len(self.runtime.list_pieces()), 1)
        domain_events = [
            event["event_type"]
            for event in self.runtime.events_after()
            if event["job_id"] is None
        ]
        self.assertIn("piece.version_promoted", domain_events)
        self.assertIn("piece.archived", domain_events)
        self.assertIn("piece.restored", domain_events)

    def test_settings_apply_requires_matching_passing_test(self) -> None:
        revision, _ = self.runtime.store.create_settings_revision(
            config={"model_id": "claude-opus-5", "effort": "max"},
            source="settings-ui",
        )
        failed = self.runtime.store.record_settings_test(
            settings_revision_id=revision["id"],
            fingerprint=revision["fingerprint"],
            model_id="claude-opus-5",
            effort="max",
            orchestration="standard",
            ok=False,
            response_receipt={"error": "probe failed"},
        )
        with self.assertRaises(ReceiptConflict):
            self.runtime.store.activate_settings_revision(
                settings_revision_id=revision["id"], test_id=failed["id"]
            )
        passed = self.runtime.store.record_settings_test(
            settings_revision_id=revision["id"],
            fingerprint=revision["fingerprint"],
            model_id="claude-opus-5",
            effort="max",
            orchestration="standard",
            ok=True,
            response_receipt={"response_id": "r-1"},
            latency_ms=12,
        )
        active = self.runtime.store.activate_settings_revision(
            settings_revision_id=revision["id"], test_id=passed["id"]
        )
        self.assertEqual(active["status"], "active")

    def test_brain_turn_order_and_tool_call_idempotency(self) -> None:
        session = self.runtime.store.create_brain_session(title="test")
        first = self.runtime.store.append_brain_turn(
            session_id=session["id"], role="user", content={"text": "hi"}
        )
        second = self.runtime.store.append_brain_turn(
            session_id=session["id"], role="assistant", content={"text": "hello"}
        )
        self.assertEqual((first["ordinal"], second["ordinal"]), (1, 2))
        call, created = self.runtime.store.create_tool_call(
            turn_id=second["id"],
            idempotency_key="tool-1",
            tool_name="read_piece",
            arguments={"piece_id": "p"},
        )
        repeat, created_again = self.runtime.store.create_tool_call(
            turn_id=second["id"],
            idempotency_key="tool-1",
            tool_name="read_piece",
            arguments={"piece_id": "p"},
        )
        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(call["id"], repeat["id"])
        done = self.runtime.store.complete_tool_call(
            call["id"], status="succeeded", result={"ok": True}
        )
        self.assertEqual(done["status"], "succeeded")


if __name__ == "__main__":
    unittest.main()
