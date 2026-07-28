from __future__ import annotations

from pathlib import Path
import tempfile
import threading
import unittest

from runtime.agent.errors import (
    CancelledAfterCommit,
    JobCancelled,
    ToolRegistrationError,
)
from runtime.agent.job_store import BrainJobStore
from runtime.agent.models import AgentProfile
from runtime.agent.responses_runner import BrainRunnerService
from runtime.agent.tools import ToolRegistry, ToolSpec
from runtime.agent.ultra import BoundedUltraCoordinator


def message_response(response_id, text):
    return {"id": response_id, "output_text": text}


class FakeResponsesClient:
    def __init__(self, responses=None):
        self.responses = list(responses or [])
        self.calls = []
        self.cancelled = []
        self._lock = threading.Lock()

    def create_response(self, **kwargs):
        with self._lock:
            self.calls.append(kwargs)
            if kwargs.get("metadata", {}).get("role", "").startswith(
                "read-only-scout"
            ):
                role = kwargs["metadata"]["role"]
                return message_response(f"resp-{role}", f"notes from {role}")
            if not self.responses:
                return message_response("resp-lead", "done")
            response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response

    def cancel(self, job_id):
        self.cancelled.append(job_id)


class FakeSettings:
    def __init__(self, profile, client):
        self.profile = profile
        self.client = client
        self.revision = {
            "revision_id": "agentcfg-tested",
            "profile": profile.storage_dict(),
        }

    def load_active(self):
        return self.profile, self.revision

    def load_revision(self, revision_id):
        if revision_id != self.revision["revision_id"]:
            raise RuntimeError("missing revision")
        return self.profile, self.revision

    def client_for_revision(self, revision_id):
        profile, revision = self.load_revision(revision_id)
        return self.client, profile, revision


def read_registry(handler=None, *, mutating=False):
    registry = ToolRegistry("music")
    registry.register(
        ToolSpec(
            name="piece_action",
            description="Read or update a piece",
            parameters={
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
                "additionalProperties": False,
            },
            handler=handler or (lambda args, _ctx: {"name": args["name"]}),
            mutating=mutating,
        )
    )
    return registry


class RunnerTests(unittest.TestCase):
    def make_runner(self, td, client, profile, registry, ultra=None):
        store = BrainJobStore(Path(td) / "jobs.sqlite3")
        settings = FakeSettings(profile, client)
        runner = BrainRunnerService(
            store=store,
            settings=settings,
            toolsets={"music": registry},
            ultra=ultra,
            max_workers=1,
        )
        return runner, store

    def test_tool_call_is_idempotent_and_continuation_has_no_duplicate_user_input(self):
        count = {"value": 0}

        def handler(args, _ctx):
            count["value"] += 1
            return {"seen": args["name"]}

        first = {
            "id": "resp-1",
            "output": [
                {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "piece_action",
                    "arguments": '{"name":"A"}',
                },
                {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "piece_action",
                    "arguments": '{"name":"A"}',
                },
            ],
        }
        client = FakeResponsesClient([first, message_response("resp-2", "finished")])
        profile = AgentProfile(
            credential_ref="ref",
            model_id="claude-opus-5",
            reasoning_effort=None,
        )
        with tempfile.TemporaryDirectory() as td:
            runner, store = self.make_runner(
                td, client, profile, read_registry(handler)
            )
            job = runner.submit("user request once", start=False)
            finished = runner.run_job(job["job_id"])
            runner.close()

            self.assertEqual(finished["status"], "completed")
            self.assertEqual(count["value"], 1)
            self.assertEqual(client.calls[0]["input_value"], "user request once")
            continuation = client.calls[1]["input_value"]
            self.assertIsInstance(continuation, list)
            self.assertNotIn("user request once", str(continuation))
            self.assertEqual(finished["result"]["model_id"], "claude-opus-5")
            receipts = store.receipts(job["job_id"])
            self.assertEqual(
                [item["kind"] for item in receipts],
                ["model_response", "model_response", "final"],
            )

    def test_cancel_after_mutation_reports_cancelled_after_commit(self):
        def handler(args, context):
            context.cancel_event.set()
            return {"updated": args["name"]}

        first = {
            "id": "resp-1",
            "output": [
                {
                    "type": "function_call",
                    "call_id": "mut-1",
                    "name": "piece_action",
                    "arguments": '{"name":"A"}',
                }
            ],
        }
        client = FakeResponsesClient([first])
        profile = AgentProfile(
            credential_ref="ref",
            model_id="claude-opus-5",
        )
        with tempfile.TemporaryDirectory() as td:
            runner, store = self.make_runner(
                td,
                client,
                profile,
                read_registry(handler, mutating=True),
            )
            job = runner.submit("mutate", start=False)
            finished = runner.run_job(job["job_id"])
            runner.close()
            self.assertEqual(
                finished["status"], "cancelled_after_commit"
            )
            self.assertTrue(store.has_committed_mutation(job["job_id"]))

    def test_typed_tool_cancellation_is_not_relabelled_as_tool_failure(self):
        first = {
            "id": "resp-1",
            "output": [
                {
                    "type": "function_call",
                    "call_id": "cancel-1",
                    "name": "piece_action",
                    "arguments": '{"name":"A"}',
                }
            ],
        }
        profile = AgentProfile(
            credential_ref="ref",
            model_id="claude-opus-5",
        )
        cases = (
            (JobCancelled("preview cancelled"), False, "cancelled"),
            (
                CancelledAfterCommit("preview committed before cancellation"),
                True,
                "cancelled_after_commit",
            ),
        )
        for raised, mutating, expected in cases:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as td:
                def handler(_args, _context, error=raised):
                    raise error

                client = FakeResponsesClient([first])
                runner, _store = self.make_runner(
                    td,
                    client,
                    profile,
                    read_registry(handler, mutating=mutating),
                )
                job = runner.submit("cancel inside tool", start=False)
                finished = runner.run_job(job["job_id"])
                runner.close()
                self.assertEqual(finished["status"], expected)
                self.assertNotIn("ToolExecutionError", str(finished["error"]))

    def test_queued_cancel_prevents_request(self):
        client = FakeResponsesClient()
        profile = AgentProfile(
            credential_ref="ref",
            model_id="claude-opus-5",
        )
        with tempfile.TemporaryDirectory() as td:
            runner, _store = self.make_runner(
                td, client, profile, read_registry()
            )
            job = runner.submit("cancel me", start=False)
            cancelled = runner.cancel(job["job_id"])
            after = runner.run_job(job["job_id"])
            runner.close()
            self.assertEqual(cancelled["status"], "cancelled")
            self.assertEqual(after["status"], "cancelled")
            self.assertEqual(client.calls, [])

    def test_submit_idempotency_key_reuses_one_durable_job(self):
        client = FakeResponsesClient()
        profile = AgentProfile(
            credential_ref="ref",
            model_id="claude-opus-5",
        )
        with tempfile.TemporaryDirectory() as td:
            runner, store = self.make_runner(
                td, client, profile, read_registry()
            )
            first = runner.submit(
                "same request",
                idempotency_key="ui-request-1",
                start=False,
            )
            second = runner.submit(
                "same request",
                idempotency_key="ui-request-1",
                start=False,
            )
            runner.close()
            self.assertEqual(first["job_id"], second["job_id"])
            self.assertEqual(len(store.list_jobs()), 1)
            with self.assertRaisesRegex(Exception, "different job input"):
                runner.submit(
                    "different request",
                    idempotency_key="ui-request-1",
                    start=False,
                )

    def test_ultra_runs_two_tool_free_scouts_then_one_lead_at_wire_max(self):
        client = FakeResponsesClient()
        profile = AgentProfile(
            credential_ref="ref",
            model_id="gpt-5.6-sol",
            reasoning_effort="high",
            orchestration="ultra",
        )
        ultra = BoundedUltraCoordinator(scout_count=2)
        with tempfile.TemporaryDirectory() as td:
            runner, store = self.make_runner(
                td, client, profile, read_registry(), ultra=ultra
            )
            job = runner.submit("complex request", start=False)
            finished = runner.run_job(job["job_id"])
            runner.close()

            self.assertEqual(finished["status"], "completed")
            self.assertEqual(len(client.calls), 3)
            scout_calls = [
                call
                for call in client.calls
                if call["metadata"]["role"].startswith("read-only-scout")
            ]
            lead_calls = [
                call for call in client.calls if call["metadata"]["role"] == "lead"
            ]
            self.assertEqual(len(scout_calls), 2)
            self.assertTrue(all(call["tools"] is None for call in scout_calls))
            self.assertEqual(len(lead_calls), 1)
            self.assertTrue(lead_calls[0]["tools"])
            self.assertTrue(
                all(call["reasoning_effort"] == "max" for call in client.calls)
            )
            self.assertTrue(
                all(call["reasoning_effort"] != "ultra" for call in client.calls)
            )
            self.assertEqual(
                len(
                    [
                        item
                        for item in store.receipts(job["job_id"])
                        if item["kind"] == "ultra_scout"
                    ]
                ),
                2,
            )

    def test_music_workspace_rejects_settings_mutation(self):
        registry = ToolRegistry("music")
        with self.assertRaisesRegex(ToolRegistrationError, "cannot mutate"):
            registry.register(
                ToolSpec(
                    name="apply_agent_settings",
                    description="not allowed",
                    parameters={
                        "type": "object",
                        "properties": {},
                        "additionalProperties": False,
                    },
                    handler=lambda _args, _ctx: {"ok": True},
                    mutating=True,
                )
            )

    def test_recovery_never_replays_committed_mutation(self):
        with tempfile.TemporaryDirectory() as td:
            store = BrainJobStore(Path(td) / "jobs.sqlite3")
            job = store.create_job(
                config_revision_id="agentcfg-1",
                input_text="x",
                toolset_id="music",
            )
            self.assertTrue(store.mark_running(job["job_id"]))
            store.begin_tool_call(
                job_id=job["job_id"],
                call_id="call-1",
                tool_name="piece_action",
                arguments={"name": "A"},
                mutating=True,
            )
            store.complete_tool_call(
                job_id=job["job_id"],
                call_id="call-1",
                result={"ok": True},
                committed=True,
            )
            recovered = store.recover_interrupted()
            self.assertIn(job["job_id"], recovered["failed"])
            self.assertEqual(store.get_job(job["job_id"])["status"], "failed")

    def test_recovery_preserves_cancelled_after_commit_truth(self):
        with tempfile.TemporaryDirectory() as td:
            store = BrainJobStore(Path(td) / "jobs.sqlite3")
            job = store.create_job(
                config_revision_id="agentcfg-1",
                input_text="x",
                toolset_id="music",
            )
            self.assertTrue(store.mark_running(job["job_id"]))
            store.begin_tool_call(
                job_id=job["job_id"],
                call_id="call-1",
                tool_name="piece_action",
                arguments={"name": "A"},
                mutating=True,
            )
            store.complete_tool_call(
                job_id=job["job_id"],
                call_id="call-1",
                result={"ok": True},
                committed=True,
            )
            self.assertEqual(
                store.request_cancel(job["job_id"])["status"],
                "cancel_requested",
            )
            recovered = store.recover_interrupted()
            self.assertNotIn(job["job_id"], recovered["queued"])
            self.assertEqual(
                store.get_job(job["job_id"])["status"],
                "cancelled_after_commit",
            )


if __name__ == "__main__":
    unittest.main()
