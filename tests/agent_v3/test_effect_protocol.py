"""BJ-QUEUE-001 / BJ-EFFECT-001: dispatch and external-effect recovery.

Pre-fix faults: a durably queued Brain job created before runner submission
stranded forever (recovery only examined running/cancel-requested rows), and
a crash during a mutating tool call collapsed into a generic failure that
could tempt a blind, effect-duplicating replay. These tests pin the closure:
queued rows are redispatched, and an in-flight mutating call is reconciled
against its durable effect — observed effects become committed reconciled
receipts, proven-absent effects make the job safely requeueable, and unknown
outcomes stay explicitly reconciliation_required.
"""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from runtime.agent.job_store import BrainJobStore
from runtime.agent.models import AgentProfile
from runtime.agent.responses_runner import BrainRunnerService

try:
    from .test_runner import FakeResponsesClient, FakeSettings, read_registry
except ImportError:  # discover without a top-level package (verify-repo)
    from test_runner import FakeResponsesClient, FakeSettings, read_registry


def _profile() -> AgentProfile:
    return AgentProfile.from_dict(
        {
            "base_url": "http://127.0.0.1:8318/v1",
            "model_id": "gpt-5.6-terra",
            "reasoning_effort": "medium",
            "orchestration": "standard",
            "credential_ref": "ref-1",
        }
    )


class QueueRecoveryTests(unittest.TestCase):
    def test_stranded_queued_job_is_redispatched_and_completes(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = BrainJobStore(Path(td) / "jobs.sqlite3")
            # Durably queued before any runner existed: the BJ-QUEUE-001 gap.
            job = store.create_job(
                config_revision_id="agentcfg-tested",
                input_text="stranded dispatch",
                toolset_id="music",
            )
            self.assertEqual(store.get_job(job["job_id"])["status"], "queued")

            client = FakeResponsesClient()
            runner = BrainRunnerService(
                store=store,
                settings=FakeSettings(_profile(), client),
                toolsets={"music": read_registry()},
                max_workers=1,
            )
            recovered = runner.recover()
            self.assertIn(job["job_id"], recovered["queued"])
            final = runner.wait(job["job_id"], timeout=10)
            self.assertEqual(final["status"], "completed")
            events = [
                event["event_type"]
                for event in store.events(job_id=job["job_id"])
            ]
            self.assertIn("recovered_queued", events)


class EffectReconciliationTests(unittest.TestCase):
    def _crashed_mutating_job(
        self, store: BrainJobStore
    ) -> tuple[str, str]:
        job = store.create_job(
            config_revision_id="agentcfg-tested",
            input_text="mutate then crash",
            toolset_id="music",
        )
        job_id = job["job_id"]
        self.assertTrue(store.mark_running(job_id))
        store.begin_tool_call(
            job_id=job_id,
            call_id="call-crash",
            tool_name="generate_first_shots",
            arguments={"count": 1, "producer_brief": "x", "profile_id": "p"},
            mutating=True,
        )
        return job_id, "call-crash"

    def _call_row(self, store: BrainJobStore, job_id: str, call_id: str) -> dict:
        with closing(sqlite3.connect(store.path)) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT * FROM brain_tool_calls
                WHERE job_id = ? AND call_id = ?
                """,
                (job_id, call_id),
            ).fetchone()
        assert row is not None
        return dict(row)

    def test_observed_effect_is_reconciled_not_replayed(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = BrainJobStore(Path(td) / "jobs.sqlite3")
            job_id, call_id = self._crashed_mutating_job(store)
            probes: list[dict] = []

            def reconciler(call: dict) -> dict:
                probes.append(call)
                return {
                    "observed": True,
                    "identity": {"kind": "generation_batch", "batch_id": "gen_x"},
                }

            recovered = store.recover_interrupted(effect_reconciler=reconciler)
            self.assertIn(job_id, recovered["failed"])
            self.assertIn(job_id, recovered["reconciled"])
            self.assertEqual(len(probes), 1)
            self.assertEqual(probes[0]["call_id"], call_id)

            call = self._call_row(store, job_id, call_id)
            self.assertEqual(call["status"], "completed")
            self.assertEqual(call["committed"], 1)
            self.assertEqual(call["effect_state"], "effect_observed")
            final = store.get_job(job_id)
            self.assertEqual(final["status"], "failed")
            self.assertIn("not resumable", final["error"])
            events = [e["event_type"] for e in store.events(job_id=job_id)]
            self.assertIn("tool_reconciled", events)

    def test_proven_absent_effect_requeues_the_job(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = BrainJobStore(Path(td) / "jobs.sqlite3")
            job_id, call_id = self._crashed_mutating_job(store)
            recovered = store.recover_interrupted(
                effect_reconciler=lambda _call: {"observed": False, "identity": {}}
            )
            self.assertIn(job_id, recovered["queued"])
            self.assertNotIn(job_id, recovered["failed"])
            call = self._call_row(store, job_id, call_id)
            self.assertEqual(call["status"], "failed")
            self.assertEqual(call["effect_state"], "finalized")
            self.assertEqual(store.get_job(job_id)["status"], "queued")

    def test_unknown_effect_stays_reconciliation_required(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = BrainJobStore(Path(td) / "jobs.sqlite3")
            job_id, call_id = self._crashed_mutating_job(store)
            recovered = store.recover_interrupted(effect_reconciler=None)
            self.assertIn(job_id, recovered["failed"])
            self.assertNotIn(job_id, recovered["reconciled"])
            call = self._call_row(store, job_id, call_id)
            self.assertEqual(call["status"], "running")
            self.assertEqual(call["effect_state"], "reconciliation_required")
            final = store.get_job(job_id)
            self.assertEqual(final["status"], "failed")
            self.assertIn("manual reconciliation", final["error"])

    def test_cancel_requested_with_observed_effect_is_cancelled_after_commit(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = BrainJobStore(Path(td) / "jobs.sqlite3")
            job_id, _call_id = self._crashed_mutating_job(store)
            store.request_cancel(job_id)
            recovered = store.recover_interrupted(
                effect_reconciler=lambda _call: {"observed": True, "identity": {}}
            )
            self.assertNotIn(job_id, recovered["failed"])
            self.assertEqual(
                store.get_job(job_id)["status"], "cancelled_after_commit"
            )

    def test_mixed_unknown_and_committed_cancellation_stays_honest(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = BrainJobStore(Path(td) / "jobs.sqlite3")
            job = store.create_job(
                config_revision_id="agentcfg-tested",
                input_text="commit, then crash mid-second-call",
                toolset_id="music",
            )
            job_id = job["job_id"]
            self.assertTrue(store.mark_running(job_id))
            store.begin_tool_call(
                job_id=job_id,
                call_id="call-committed",
                tool_name="generate_first_shots",
                arguments={"count": 1, "producer_brief": "a", "profile_id": "p"},
                mutating=True,
            )
            store.complete_tool_call(
                job_id=job_id,
                call_id="call-committed",
                result={"ok": True},
                committed=True,
            )
            store.begin_tool_call(
                job_id=job_id,
                call_id="call-unknown",
                tool_name="set_piece_archived",
                arguments={"piece_id": "p", "archived": True},
                mutating=True,
            )
            store.request_cancel(job_id)

            recovered = store.recover_interrupted(effect_reconciler=None)
            self.assertNotIn(job_id, recovered["failed"])
            final = store.get_job(job_id)
            self.assertEqual(final["status"], "cancelled_after_commit")
            self.assertIn("manual reconciliation", final["error"])
            unknown = self._call_row(store, job_id, "call-unknown")
            self.assertEqual(
                unknown["effect_state"], "reconciliation_required"
            )

    def test_post_effect_failure_reconciles_in_process_not_replay(self) -> None:
        from runtime.agent.responses_runner import _ToolExecutor
        from runtime.agent.tools import ToolRegistry, ToolSpec
        import threading as _threading

        with tempfile.TemporaryDirectory() as td:
            store = BrainJobStore(Path(td) / "jobs.sqlite3")
            job = store.create_job(
                config_revision_id="agentcfg-tested",
                input_text="commit effect then fail post-work",
                toolset_id="music",
            )
            store.mark_running(job["job_id"])
            effect_committed = {"done": False}

            def handler(_args, _ctx):
                effect_committed["done"] = True
                raise RuntimeError("activity publish failed after commit")

            registry = ToolRegistry("music")
            registry.register(
                ToolSpec(
                    name="generate_first_shots",
                    description="mutating fixture",
                    parameters={
                        "type": "object",
                        "properties": {},
                        "additionalProperties": False,
                    },
                    handler=handler,
                    mutating=True,
                )
            )
            executor = _ToolExecutor(
                store=store,
                registry=registry,
                job_id=job["job_id"],
                cancel_event=_threading.Event(),
                effect_reconciler=lambda call: (
                    {"observed": True, "identity": {"batch_id": "gen_real"}}
                    if effect_committed["done"]
                    else {"observed": False, "identity": {}}
                ),
            )
            result = executor.execute(
                {"name": "generate_first_shots", "call_id": "call-pe", "arguments": {}}
            )
            self.assertTrue(result["reconciled"])
            self.assertIn("activity publish failed", result["post_effect_error"])
            call = self._call_row(store, job["job_id"], "call-pe")
            self.assertEqual(call["status"], "completed")
            self.assertEqual(call["committed"], 1)

    def test_effect_state_column_upgrades_existing_database(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "legacy.sqlite3"
            with closing(sqlite3.connect(path)) as conn:
                conn.executescript(
                    """
                    CREATE TABLE brain_jobs(
                        job_id TEXT PRIMARY KEY,
                        idempotency_key TEXT UNIQUE,
                        config_revision_id TEXT NOT NULL,
                        toolset_id TEXT NOT NULL,
                        status TEXT NOT NULL,
                        input_json TEXT NOT NULL,
                        metadata_json TEXT NOT NULL,
                        result_json TEXT,
                        error TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        started_at TEXT,
                        ended_at TEXT
                    );
                    CREATE TABLE brain_tool_calls(
                        job_id TEXT NOT NULL,
                        call_id TEXT NOT NULL,
                        tool_name TEXT NOT NULL,
                        args_hash TEXT NOT NULL,
                        arguments_json TEXT NOT NULL,
                        mutating INTEGER NOT NULL,
                        status TEXT NOT NULL,
                        result_json TEXT,
                        error TEXT,
                        committed INTEGER NOT NULL DEFAULT 0,
                        started_at TEXT NOT NULL,
                        ended_at TEXT,
                        PRIMARY KEY(job_id, call_id)
                    );
                    INSERT INTO brain_tool_calls VALUES (
                        'brain-old', 'call-old', 'piece_action', 'h', '{}',
                        1, 'completed', '{}', NULL, 1,
                        '2026-07-01T00:00:00Z', '2026-07-01T00:00:01Z'
                    );
                    """
                )
            store = BrainJobStore(path)
            row = self._call_row(store, "brain-old", "call-old")
            self.assertEqual(row["effect_state"], "finalized")


if __name__ == "__main__":
    unittest.main()
