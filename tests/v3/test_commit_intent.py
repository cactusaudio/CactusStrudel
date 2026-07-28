"""DT-001: content-bound render commit intents and exact restart adoption.

Pre-fix fault: `commit_rendered_version` promoted the asset directory and
then registered the SQLite rows in a separate transaction, so a crash between
them left a complete promoted orphan whose job later read `interrupted`.
These tests pin the closure: the intent binds the exact receipt before the
rename, restart adoption completes only an exact intent/receipt match, and
everything else is abandoned as explicit evidence.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from runtime.v3 import ReceiptConflict, RuntimeTruth
from runtime.v3.store import TruthStore

RUNTIME_ROOT = Path(__file__).resolve().parents[2] / "runtime"
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))


class CommitIntentTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.runtime = self._runtime()
        self.audio = self.root / "render.mp3"
        self.audio.write_bytes(b"ID3" + b"\x00" * 2048)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _runtime(self) -> RuntimeTruth:
        return RuntimeTruth(
            repo_root=self.root,
            db_path=self.root / "runtime.sqlite3",
            assets_root=self.root / "assets",
            duration_probe=lambda _: 9.75,
        )

    def _running_job(self, key: str) -> dict:
        job, _ = self.runtime.create_job(
            kind="generation",
            payload={"prompt": "intent"},
            idempotency_key=key,
        )
        return self.runtime.start_job(job["id"], worker_id="worker-intent")

    def _commit_kwargs(self, staged) -> dict:
        provenance = {
            "provider_route": "cliproxy-responses",
            "model_id": "gpt-5.6-terra",
            "reasoning_effort": "medium",
            "orchestration": "standard",
            "kernel_hash": "kernel-intent",
            "validator_mode": "deterministic",
        }
        return {
            "staged": staged,
            "display_name": f"INTENT-{staged.version_id}",
            "provenance": provenance,
            "model_run": {
                **provenance,
                "request_receipt": {"request_id": "req-intent"},
                "response_receipt": {"response_id": "resp-intent"},
            },
        }

    def _stage(self, job: dict, *, version_id: str):
        return self.runtime.stage_render(
            job_id=job["id"],
            piece_id=f"piece_{version_id}",
            version_id=version_id,
            code='setcpm(120/4)\ns("bd sd")',
            audio_path=self.audio,
            prompt={"compiled_prompt": "intent"},
            features={"rms": -12.0},
        )

    def _intent_row(self, job_id: str) -> dict | None:
        with self.runtime.database.transaction(immediate=False) as conn:
            row = conn.execute(
                "SELECT * FROM render_commit_intents WHERE job_id = ?",
                (job_id,),
            ).fetchone()
            return dict(row) if row is not None else None

    def test_normal_commit_marks_intent_registered(self) -> None:
        job = self._running_job("intent-normal")
        staged = self._stage(job, version_id="version_normal")
        result = self.runtime.commit_rendered_version(**self._commit_kwargs(staged))
        self.assertEqual(result["job"]["status"], "succeeded")
        intent = self._intent_row(job["id"])
        assert intent is not None
        self.assertEqual(intent["status"], "registered")
        self.assertEqual(
            intent["receipt_sha256"], result["receipt"]["receipt_sha256"]
        )

    def test_crash_between_promote_and_register_is_adopted_exactly(self) -> None:
        job = self._running_job("intent-crash")
        staged = self._stage(job, version_id="version_crash")
        kwargs = self._commit_kwargs(staged)

        with mock.patch.object(
            TruthStore,
            "register_render_success",
            side_effect=RuntimeError("simulated crash after promote"),
        ):
            with self.assertRaises(RuntimeError):
                self.runtime.commit_rendered_version(**kwargs)

        # The DT-001 window: promoted directory exists, no database row.
        target = self.root / "assets" / staged.piece_id / staged.version_id
        self.assertTrue((target / "receipt.json").is_file())
        with self.runtime.database.transaction(immediate=False) as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT COUNT(*) AS n FROM piece_versions"
                ).fetchone()["n"],
                0,
            )
        intent = self._intent_row(job["id"])
        assert intent is not None
        self.assertEqual(intent["status"], "promoted")

        restarted = self._runtime()
        report = restarted.recover_after_restart()
        adoption = report["commit_intent_adoption"]
        self.assertEqual(len(adoption["adopted"]), 1)
        self.assertEqual(adoption["adopted"][0]["outcome"], "registered")
        self.assertEqual(adoption["abandoned"], [])

        recovered_job = restarted.get_job(job["id"])
        self.assertEqual(recovered_job["status"], "succeeded")
        self.assertEqual(
            recovered_job["result_version_id"], staged.version_id
        )
        version = restarted.store.get_version(staged.version_id)
        self.assertEqual(version["piece_id"], staged.piece_id)
        reconciliation = report["receipt_reconciliation"]
        self.assertEqual(reconciliation["orphan_promoted"], [])
        self.assertEqual(reconciliation["registered_without_valid_receipt"], [])
        self.assertEqual(self._intent_row(job["id"])["status"], "registered")
        verdict = restarted.revision_usability(staged.version_id, action="play")
        self.assertTrue(verdict.usable)

    def test_pending_intent_without_promote_is_abandoned_with_evidence(
        self,
    ) -> None:
        job = self._running_job("intent-pending")
        staged = self._stage(job, version_id="version_pending")
        kwargs = self._commit_kwargs(staged)

        with mock.patch.object(
            type(self.runtime.assets),
            "promote_with_receipt",
            side_effect=RuntimeError("simulated crash before promote"),
        ):
            with self.assertRaises(RuntimeError):
                self.runtime.commit_rendered_version(**kwargs)

        intent = self._intent_row(job["id"])
        assert intent is not None
        self.assertEqual(intent["status"], "pending")
        self.assertTrue(staged.path.is_dir(), "staging evidence must remain")

        restarted = self._runtime()
        report = restarted.recover_after_restart()
        adoption = report["commit_intent_adoption"]
        self.assertEqual(adoption["adopted"], [])
        self.assertEqual(len(adoption["abandoned"]), 1)
        self.assertIn(
            "no adoptable promoted receipt",
            adoption["abandoned"][0]["reason"],
        )
        self.assertEqual(self._intent_row(job["id"])["status"], "abandoned")
        self.assertIn(job["id"], report["interrupted_job_ids"])
        self.assertEqual(restarted.get_job(job["id"])["status"], "interrupted")
        self.assertTrue(staged.path.is_dir(), "staging evidence is retained")
        reconciliation = report["receipt_reconciliation"]
        self.assertEqual(
            [
                entry["job_id"]
                for entry in reconciliation["abandoned_commit_intents"]
            ],
            [job["id"]],
        )

    def test_adoption_refuses_receipt_that_mismatches_intent(self) -> None:
        job = self._running_job("intent-mismatch")
        staged = self._stage(job, version_id="version_mismatch")
        kwargs = self._commit_kwargs(staged)
        with mock.patch.object(
            TruthStore,
            "register_render_success",
            side_effect=RuntimeError("simulated crash after promote"),
        ):
            with self.assertRaises(RuntimeError):
                self.runtime.commit_rendered_version(**kwargs)

        with self.runtime.database.transaction() as conn:
            conn.execute(
                """
                UPDATE render_commit_intents
                   SET receipt_sha256 = ?
                 WHERE job_id = ?
                """,
                ("e" * 64, job["id"]),
            )

        restarted = self._runtime()
        report = restarted.recover_after_restart()
        adoption = report["commit_intent_adoption"]
        self.assertEqual(adoption["adopted"], [])
        self.assertEqual(len(adoption["abandoned"]), 1)
        self.assertIn(
            "does not match the recorded intent",
            adoption["abandoned"][0]["reason"],
        )
        # The promoted directory stays as explicit human-decision evidence.
        orphans = report["receipt_reconciliation"]["orphan_promoted"]
        self.assertEqual(len(orphans), 1)
        self.assertEqual(restarted.get_job(job["id"])["status"], "interrupted")

    def test_adoption_survives_registration_integrity_conflict(self) -> None:
        job_ok = self._running_job("intent-collide-ok")
        staged_ok = self._stage(job_ok, version_id="version_collide_ok")
        kwargs_ok = self._commit_kwargs(staged_ok)
        kwargs_ok["display_name"] = "COLLIDE"
        self.runtime.commit_rendered_version(**kwargs_ok)

        job_crash = self._running_job("intent-collide-crash")
        staged_crash = self._stage(job_crash, version_id="version_collide_crash")
        kwargs_crash = self._commit_kwargs(staged_crash)
        kwargs_crash["display_name"] = "COLLIDE"
        with mock.patch.object(
            TruthStore,
            "register_render_success",
            side_effect=RuntimeError("simulated crash after promote"),
        ):
            with self.assertRaises(RuntimeError):
                self.runtime.commit_rendered_version(**kwargs_crash)

        # Adoption hits the UNIQUE display_name constraint; startup must
        # survive, abandon this one intent, and keep the orphan as evidence.
        restarted = self._runtime()
        report = restarted.recover_after_restart()
        adoption = report["commit_intent_adoption"]
        self.assertEqual(adoption["adopted"], [])
        self.assertEqual(len(adoption["abandoned"]), 1)
        self.assertIn("IntegrityError", adoption["abandoned"][0]["reason"])
        self.assertEqual(
            restarted.get_job(job_crash["id"])["status"], "interrupted"
        )
        orphans = report["receipt_reconciliation"]["orphan_promoted"]
        self.assertEqual(len(orphans), 1)

    def test_registration_only_finalizes_matching_intent_sha(self) -> None:
        job = self._running_job("intent-ledger")
        staged = self._stage(job, version_id="version_ledger")
        result = self.runtime.commit_rendered_version(**self._commit_kwargs(staged))
        registered_sha = result["receipt"]["receipt_sha256"]

        # Simulate a divergent ledger: the intent claims a different receipt.
        with self.runtime.database.transaction() as conn:
            conn.execute(
                """
                UPDATE render_commit_intents
                   SET status = 'pending', receipt_sha256 = ?
                 WHERE job_id = ?
                """,
                ("a" * 64, job["id"]),
            )
        restarted = self._runtime()
        report = restarted.recover_after_restart()
        adoption = report["commit_intent_adoption"]
        self.assertEqual(adoption["adopted"], [])
        self.assertEqual(len(adoption["abandoned"]), 1)
        self.assertIn(
            "does not match the recorded intent",
            adoption["abandoned"][0]["reason"],
        )
        # The registered database/filesystem truth is untouched.
        version = restarted.store.get_version(staged.version_id)
        self.assertEqual(version["receipt_sha256"], registered_sha)
        self.assertEqual(restarted.get_job(job["id"])["status"], "succeeded")

    def test_staging_without_intent_is_reported_as_leftover(self) -> None:
        job = self._running_job("intent-staging-leftover")
        staged = self._stage(job, version_id="version_leftover")
        # Crash before create_commit_intent: staging exists, no intent row.
        report = self.runtime.reconcile_receipts()
        leftovers = report["staging_leftovers"]
        self.assertEqual(len(leftovers), 1)
        self.assertEqual(leftovers[0]["job_id"], job["id"])
        self.assertEqual(leftovers[0]["version_id"], "version_leftover")
        self.assertIsNone(leftovers[0]["intent_status"])
        self.assertTrue(staged.path.is_dir())

        # After a normal commit the staging directory is gone from the report.
        self.runtime.commit_rendered_version(**self._commit_kwargs(staged))
        after = self.runtime.reconcile_receipts()
        self.assertEqual(after["staging_leftovers"], [])

    def test_intent_conflicts_on_second_receipt_for_same_job(self) -> None:
        job = self._running_job("intent-conflict")
        staged = self._stage(job, version_id="version_conflict")
        receipt = self.runtime.assets.build_receipt(
            staged, provenance={"provider_route": "x"}
        )
        self.runtime.store.create_commit_intent(
            job_id=job["id"],
            receipt=receipt,
            registration={"receipt": receipt},
        )
        different = dict(receipt)
        different["receipt_sha256"] = "d" * 64
        with self.assertRaises(ReceiptConflict):
            self.runtime.store.create_commit_intent(
                job_id=job["id"],
                receipt=different,
                registration={"receipt": different},
            )


if __name__ == "__main__":
    unittest.main()
