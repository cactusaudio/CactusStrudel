from __future__ import annotations

from copy import deepcopy
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from .helpers import (
    CapturedThread,
    FakeCancelableClient,
    FakeGenerationTruth,
    REPO_ROOT,  # noqa: F401 - also installs runtime on sys.path
    StaticGenerationConfig,
)

from v3.owner import OwnerLease
from v3_api import (
    Conflict,
    GenerationProfile,
    GenerationRepository,
    V3Application,
)


CONFIG = {
    "schema_version": 1,
    "revision_id": "gencfg-test",
    "base_url": "http://127.0.0.1:8318/v1",
    "credential_ref": "fixture-key",
    "default_profile_id": "composer",
    "catalog_fetched_at": "2026-07-28T00:00:00Z",
    "profiles": [
        {
            "id": "composer",
            "label": "Composer",
            "model_id": "gemini-pro-agent",
            "reasoning_effort": None,
            "orchestration": "standard",
            "description": "fixture",
        }
    ],
}

KERNEL = {
    "text": "PINNED TECHNICAL ENVELOPE",
    "hash": "kernel-pinned",
    "fragments_used": ["00-identity.md", "30-output-contract.md"],
    "mode": "responses",
}


class GenerationJobTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = object.__new__(V3Application)
        self.app.owner = OwnerLease.acquire(self.root)
        self.app.generation_config = StaticGenerationConfig(CONFIG)
        self.app.generation_repo = GenerationRepository(
            self.root / "runtime.sqlite3", owner=self.app.owner
        )
        self.app.truth = FakeGenerationTruth()
        self.app._batch_cancel = {}
        self.app._batch_threads = {}
        self.app._generation_clients = {}
        self.app._lock = threading.RLock()
        self.app._publish = lambda *_args, **_kwargs: 1
        self.app._activity = lambda *_args, **_kwargs: None
        CapturedThread.reset()

    def tearDown(self) -> None:
        self.app.owner.release()
        self.temp.cleanup()

    def test_same_idempotency_key_schedules_exactly_one_batch(self) -> None:
        with patch("v3_api.threading.Thread", CapturedThread):
            first = self.app.create_generation_job(
                count=2,
                prompt="two independent first shots",
                profile_id="composer",
                idempotency_key="request-1",
            )
            second = self.app.create_generation_job(
                count=2,
                prompt="two independent first shots",
                profile_id="composer",
                idempotency_key="request-1",
            )

        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["state"], "queued")
        self.assertEqual(len(CapturedThread.created), 1)
        self.assertTrue(CapturedThread.created[0].started)
        self.assertEqual(len(self.app.generation_repo.list()), 1)

        with self.assertRaises(Conflict):
            self.app.create_generation_job(
                count=2,
                prompt="different request",
                profile_id="composer",
                idempotency_key="request-1",
            )

    def test_cancel_running_batch_reaches_children_and_live_clients(self) -> None:
        batch, _ = self.app.generation_repo.create(
            count=2,
            prompt="cancel me",
            profile_id="composer",
            idempotency_key="request-cancel",
        )
        child_ids = ["job_child_a", "job_child_b"]
        self.app.generation_repo.set_running(batch["id"], child_ids)
        cancel_event = threading.Event()
        clients = {
            child_id: FakeCancelableClient() for child_id in child_ids
        }
        self.app._batch_cancel[batch["id"]] = cancel_event
        self.app._generation_clients.update(clients)

        public = self.app.cancel_generation(batch["id"])

        self.assertEqual(public["state"], "cancelling")
        self.assertTrue(cancel_event.is_set())
        self.assertEqual(self.app.truth.cancelled, child_ids)
        for child_id in child_ids:
            self.assertEqual(clients[child_id].cancelled, [child_id])

    def test_queued_cancel_is_terminal_without_starting_children(self) -> None:
        batch, _ = self.app.generation_repo.create(
            count=4,
            prompt="cancel before dispatch",
            profile_id="composer",
            idempotency_key="request-queued-cancel",
        )
        cancel_event = threading.Event()
        self.app._batch_cancel[batch["id"]] = cancel_event

        public = self.app.cancel_generation(batch["id"])

        self.assertEqual(public["state"], "cancelled")
        self.assertEqual(public["completed_count"], 0)
        self.assertTrue(cancel_event.is_set())
        self.assertEqual(self.app.truth.cancelled, [])

    def test_cancelled_before_worker_entry_releases_runtime_cancel_handle(self) -> None:
        with patch("v3_api.threading.Thread", CapturedThread):
            public = self.app.create_generation_job(
                count=1,
                prompt="cancel at the queue boundary",
                profile_id="composer",
                idempotency_key="request-cancel-before-worker",
            )
        self.app.cancel_generation(public["id"])

        CapturedThread.created[0].run_now()

        self.assertNotIn(public["id"], self.app._batch_cancel)

    def test_cancel_during_child_allocation_does_not_orphan_queued_children(self) -> None:
        batch, _ = self.app.generation_repo.create(
            count=2,
            prompt="race at child allocation",
            profile_id="composer",
            idempotency_key="request-child-race",
        )
        cancel_event = threading.Event()
        self.app._batch_cancel[batch["id"]] = cancel_event

        app = self.app

        class RaceTruth(FakeGenerationTruth):
            def create_job(self, **kwargs):
                child_id = f"child-{len(self.jobs)}"
                child = {
                    "id": child_id,
                    "status": "queued",
                    "result_version_id": None,
                }
                self.jobs[child_id] = child
                if len(self.jobs) == 1:
                    app.cancel_generation(batch["id"])
                return dict(child), True

            def request_cancel(self, child_id: str):
                child = self.jobs[child_id]
                child["status"] = "cancelled"
                self.cancelled.append(child_id)
                return dict(child)

        race_truth = RaceTruth()
        self.app.truth = race_truth

        self.app._run_generation_batch(
            batch["id"], deepcopy(CONFIG), deepcopy(KERNEL), cancel_event
        )

        self.assertEqual(
            {row["status"] for row in race_truth.jobs.values()},
            {"cancelled"},
        )
        self.assertEqual(
            set(race_truth.cancelled),
            set(race_truth.jobs),
        )
        durable = self.app.generation_repo.get(batch["id"])
        self.assertEqual(durable["child_job_ids"], list(race_truth.jobs))
        self.assertEqual(durable["status"], "cancelled")

    def test_child_allocation_is_persisted_incrementally_and_idempotently(self) -> None:
        batch, _ = self.app.generation_repo.create(
            count=2,
            prompt="persist each child",
            profile_id="composer",
            idempotency_key="request-record-child",
        )

        first = self.app.generation_repo.record_child(batch["id"], "child-a")
        replay = self.app.generation_repo.record_child(batch["id"], "child-a")
        second = self.app.generation_repo.record_child(batch["id"], "child-b")

        self.assertEqual(first["child_job_ids"], ["child-a"])
        self.assertEqual(replay["child_job_ids"], ["child-a"])
        self.assertEqual(second["child_job_ids"], ["child-a", "child-b"])

    def test_restart_classifies_inflight_batch_and_preserves_committed_ids(self) -> None:
        batch, _ = self.app.generation_repo.create(
            count=2,
            prompt="restart boundary",
            profile_id="composer",
            idempotency_key="request-restart",
        )
        self.app.generation_repo.set_running(batch["id"], ["child-a", "child-b"])
        self.app.generation_repo.finish(
            batch["id"],
            status="cancelled_after_commit",
            piece_ids=["piece-a"],
        )

        recovered = GenerationRepository(self.root / "runtime.sqlite3")
        self.assertEqual(recovered.recover_interrupted(), [])
        row = recovered.get(batch["id"])
        self.assertEqual(row["status"], "cancelled_after_commit")
        self.assertEqual(row["piece_ids"], ["piece-a"])

    def test_repository_closes_short_lived_sqlite_connections(self) -> None:
        """Context-manager commit is not the same thing as Connection.close()."""

        real_connect = self.app.generation_repo._connect
        opened = []

        class TrackingConnection:
            def __init__(self, connection: sqlite3.Connection):
                self.connection = connection
                self.closed = False

            def __getattr__(self, name):
                return getattr(self.connection, name)

            def __enter__(self):
                self.connection.__enter__()
                return self

            def __exit__(self, exc_type, exc, traceback):
                return self.connection.__exit__(exc_type, exc, traceback)

            def close(self):
                self.closed = True
                self.connection.close()

        def tracked_connect():
            wrapped = TrackingConnection(real_connect())
            opened.append(wrapped)
            return wrapped

        self.app.generation_repo._connect = tracked_connect
        try:
            self.app.generation_repo.list()
            self.assertTrue(opened)
            self.assertTrue(all(connection.closed for connection in opened))
        finally:
            for connection in opened:
                if not connection.closed:
                    connection.close()

    def test_credential_lookup_failure_finishes_child_instead_of_leaving_running(self) -> None:
        class ShotTruth:
            def __init__(self):
                self.status = "queued"
                self.store = self

            def start_job(self, _job_id, *, worker_id):
                self.status = "running"
                return {"id": "child", "status": self.status, "worker_id": worker_id}

            def get_job(self, _job_id):
                return {"id": "child", "status": self.status}

            def finish_job(self, _job_id, *, status, error):
                self.status = status
                self.error = error
                return {"id": "child", "status": status}

        class MissingCredential:
            @staticmethod
            def get(_credential_ref):
                raise RuntimeError("fixture credential unavailable")

        truth = ShotTruth()
        self.app.truth = truth
        self.app.credentials = MissingCredential()

        with self.assertRaisesRegex(RuntimeError, "credential unavailable"):
            self.app._run_generation_shot(
                batch_id="batch",
                child_job_id="child",
                shot_index=0,
                prompt="",
                profile=GenerationProfile(
                    profile_id="composer",
                    label="Composer",
                    model_id="gemini-pro-agent",
                    reasoning_effort=None,
                ),
                config=CONFIG,
                kernel=KERNEL,
                cancel_event=threading.Event(),
            )

        self.assertEqual(truth.status, "failed")

    def test_batch_persists_exact_config_and_kernel_snapshots(self) -> None:
        with (
            patch("v3_api.threading.Thread", CapturedThread),
            patch(
                "v3_api.prompt_kernel.compile",
                return_value=deepcopy(KERNEL),
            ),
        ):
            public = self.app.create_generation_job(
                count=1,
                prompt="pin this run",
                profile_id="composer",
                idempotency_key="request-pinned-inputs",
            )

        durable = self.app.generation_repo.get(public["id"])
        self.assertEqual(durable["generation_config"], CONFIG)
        self.assertEqual(durable["kernel_snapshot"], KERNEL)
        self.assertEqual(
            CapturedThread.created[0].args[1:3],
            (CONFIG, KERNEL),
        )

        reopened = GenerationRepository(self.root / "runtime.sqlite3")
        readback = reopened.get(public["id"])
        self.assertEqual(readback["generation_config"], CONFIG)
        self.assertEqual(readback["kernel_snapshot"], KERNEL)


if __name__ == "__main__":
    unittest.main()
