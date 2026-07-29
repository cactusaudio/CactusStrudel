from __future__ import annotations

from contextlib import contextmanager
import inspect
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from .helpers import (
    CapturedThread,
    REPO_ROOT,  # noqa: F401 - also installs runtime on sys.path
)

from agent.job_store import BrainJobStore
from agent.tools import ToolExecutionContext
from v3_api import Conflict, V3Application


class BrainMessageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = BrainJobStore(self.root / "brain.sqlite3")
        self.app = object.__new__(V3Application)
        self.app.db_path = self.root / "brain.sqlite3"
        self.app.brain_store = self.store

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_public_transcript_contains_one_user_message(self) -> None:
        job = self.store.create_job(
            config_revision_id="agentcfg-1",
            input_text=(
                "Make the bass more intentional.\n\nPINNED PRODUCT CONTEXT\n"
                '{"piece_id":"piece-1","revision_id":"version-1"}'
            ),
            toolset_id="music",
            metadata={
                "user_message": "Make the bass more intentional.",
                "piece_id": "piece-1",
                "revision_id": "version-1",
                "audio_sha256": "a" * 64,
                "score": 7.6,
            },
            idempotency_key="brain-request-1",
        )
        self.store.mark_running(job["job_id"])
        self.store.begin_tool_call(
            job_id=job["job_id"],
            call_id="call-1",
            tool_name="read_piece",
            arguments={"piece_id": "piece-1"},
            mutating=False,
        )
        self.store.complete_tool_call(
            job_id=job["job_id"],
            call_id="call-1",
            result={"id": "piece-1", "score": 7.6},
            committed=False,
        )
        self.store.finish(
            job["job_id"],
            status="completed",
            result={
                "output_text": "The bass loses direction in the second half.",
                "response_count": 2,
                "tool_call_count": 1,
                "model_id": "claude-opus-5",
                "reasoning_effort": None,
                "wire_reasoning_effort": None,
                "orchestration": "standard",
            },
        )

        first = self.app._brain_public(self.store.get_job(job["job_id"]))
        second = self.app._brain_public(self.store.get_job(job["job_id"]))

        for public in (first, second):
            users = [row for row in public["messages"] if row["role"] == "user"]
            self.assertEqual(len(users), 1)
            self.assertEqual(users[0]["text"], "Make the bass more intentional.")
            self.assertNotIn("PINNED PRODUCT CONTEXT", users[0]["text"])
            self.assertEqual(
                [row["role"] for row in public["messages"]],
                ["user", "tool", "assistant"],
            )
            self.assertEqual(
                len({row["id"] for row in public["messages"]}),
                len(public["messages"]),
            )
            self.assertEqual(public["audio_sha"], "a" * 64)
            self.assertEqual(public["score"], 7.6)

    def test_brain_submission_boundary_accepts_http_idempotency_key(self) -> None:
        """server_v3 always supplies this argument; the app must accept it."""

        parameters = inspect.signature(
            V3Application.create_brain_job
        ).parameters
        self.assertIn("idempotency_key", parameters)

    def test_music_brain_cannot_score_or_promote_human_owned_state(self) -> None:
        self.app.agent_settings = object()
        brain = self.app._build_brain()
        try:
            names = set(brain.toolsets["music"].names())
        finally:
            brain.close()
        self.assertNotIn("score_piece_revision", names)
        self.assertNotIn("promote_piece_revision", names)
        self.assertIn("render_piece_preview", names)
        self.assertIn("generate_first_shots", names)

    def test_pinned_audio_sha_must_match_selected_revision(self) -> None:
        class FakeTruthStore:
            @staticmethod
            def get_piece(piece_id):
                return {
                    "id": piece_id,
                    "display_name": "PIECE-1",
                    "current_version_id": "version-1",
                }

            @staticmethod
            def get_version(version_id):
                return {
                    "id": version_id,
                    "piece_id": "piece-1",
                    "audio_sha256": "a" * 64,
                }

        class FakeTruth:
            store = FakeTruthStore()

        class BrainMustNotRun:
            @staticmethod
            def submit(*_args, **_kwargs):
                raise AssertionError("mismatched pinned evidence reached the model")

        self.app.truth = FakeTruth()
        self.app.brain = BrainMustNotRun()

        with patch("v3_api.threading.Thread", CapturedThread):
            with self.assertRaises(Conflict):
                self.app.create_brain_job(
                    message="Compare what I heard with the exact revision.",
                    piece_id="piece-1",
                    revision_id="version-1",
                    audio_sha="b" * 64,
                    score=7.0,
                    idempotency_key="brain-stale-audio",
                )

    def test_pinned_score_must_match_latest_database_rating(self) -> None:
        class FakeTruthStore:
            @staticmethod
            def get_piece(piece_id):
                return {
                    "id": piece_id,
                    "display_name": "PIECE-1",
                    "current_version_id": "version-1",
                }

            @staticmethod
            def get_version(version_id):
                return {
                    "id": version_id,
                    "piece_id": "piece-1",
                    "audio_sha256": "a" * 64,
                }

        class RatingResult:
            @staticmethod
            def fetchone():
                return {"score": 7.5}

        class FakeConnection:
            @staticmethod
            def execute(*_args, **_kwargs):
                return RatingResult()

        class FakeDatabase:
            @contextmanager
            def transaction(self, *, immediate):
                self.immediate = immediate
                yield FakeConnection()

        class FakeTruth:
            store = FakeTruthStore()
            database = FakeDatabase()

            @staticmethod
            def revision_usability(_version, *, action):
                from types import SimpleNamespace

                return SimpleNamespace(usable=True, reason=None)

        class BrainMustNotRun:
            @staticmethod
            def submit(*_args, **_kwargs):
                raise AssertionError("stale score reached the model")

        self.app.truth = FakeTruth()
        self.app.brain = BrainMustNotRun()

        with self.assertRaises(Conflict):
            self.app.create_brain_job(
                message="Use the score attached to this exact playback.",
                piece_id="piece-1",
                revision_id="version-1",
                audio_sha="a" * 64,
                score=7.0,
                idempotency_key="brain-stale-score",
            )

    def test_preview_tool_forwards_the_brain_cancellation_event(self) -> None:
        captured = {}
        self.app.agent_settings = object()
        self.app.create_preview = lambda **kwargs: captured.update(kwargs) or {
            "id": "preview-1"
        }
        brain = self.app._build_brain()
        try:
            event = threading.Event()
            context = ToolExecutionContext(
                job_id="brain-1",
                call_id="call-1",
                cancel_event=event,
            )
            result = brain.toolsets["music"].get(
                "render_piece_preview"
            ).handler(
                {
                    "piece_id": "piece-1",
                    "source_revision_id": "version-1",
                    "code": 's("bd")',
                    "intent": "make a B preview",
                },
                context,
            )
        finally:
            brain.close()

        self.assertEqual(result["id"], "preview-1")
        self.assertIs(captured["cancel_event"], event)

    def test_monitor_installation_is_deduplicated_and_cleans_up(self) -> None:
        job = self.store.create_job(
            config_revision_id="agentcfg-1",
            input_text="resume me",
            toolset_id="music",
        )

        class FakeBrain:
            waited = []

            @classmethod
            def wait(cls, job_id):
                cls.waited.append(job_id)

        self.app.brain = FakeBrain()
        self.app._brain_monitors = {}
        self.app._lock = threading.RLock()
        self.app._publish = lambda *_args, **_kwargs: 1
        CapturedThread.reset()

        with patch("v3_api.threading.Thread", CapturedThread):
            self.assertTrue(self.app._ensure_brain_monitor(job["job_id"]))
            self.assertFalse(self.app._ensure_brain_monitor(job["job_id"]))
            self.assertEqual(len(CapturedThread.created), 1)
            CapturedThread.created[0].run_now()

        self.assertEqual(FakeBrain.waited, [job["job_id"]])
        self.assertNotIn(job["job_id"], self.app._brain_monitors)

    def test_application_recovery_attaches_monitor_to_requeued_brain_job(self) -> None:
        state_root = self.root / "v3"
        store = BrainJobStore(state_root / "runtime.sqlite3")
        job = store.create_job(
            config_revision_id="agentcfg-recovery",
            input_text="resume after restart",
            toolset_id="music",
        )

        class RecoveringBrain:
            @staticmethod
            def recover():
                return {"queued": [job["job_id"]], "failed": []}

            @staticmethod
            def wait(_job_id):
                return None

            @staticmethod
            def close():
                return None

        CapturedThread.reset()
        with (
            patch.object(
                V3Application,
                "_build_brain",
                return_value=RecoveringBrain(),
            ),
            patch("v3_api.threading.Thread", CapturedThread),
        ):
            app = V3Application(
                REPO_ROOT,
                state_root=state_root,
                max_generation_workers=1,
            )
        try:
            self.assertEqual(len(CapturedThread.created), 1)
            self.assertEqual(CapturedThread.created[0].args, (job["job_id"],))
            self.assertIn(job["job_id"], app._brain_monitors)
        finally:
            app._generation_pool.shutdown(wait=True, cancel_futures=False)


if __name__ == "__main__":
    unittest.main()


class BrainToolActionTests(unittest.TestCase):
    """A2: product-tool outcomes expose exact identities for the thread."""

    def test_preview_result_yields_audition_identity(self) -> None:
        action = V3Application._brain_tool_action(
            "render_piece_preview",
            {
                "id": "version_new",
                "piece_id": "piece_x",
                "audio_sha": "a" * 64,
                "code": "s('bd')",
            },
        )
        self.assertEqual(
            action,
            {
                "kind": "preview",
                "piece_id": "piece_x",
                "revision_id": "version_new",
                "audio_sha": "a" * 64,
            },
        )

    def test_generation_result_yields_batch_identity(self) -> None:
        action = V3Application._brain_tool_action(
            "generate_first_shots",
            {"id": "gen_abc", "state": "running", "count": 2},
        )
        self.assertEqual(
            action,
            {"kind": "generation", "job_id": "gen_abc", "state": "running"},
        )

    def test_reconciled_effect_uses_recorded_identity(self) -> None:
        action = V3Application._brain_tool_action(
            "generate_first_shots",
            {
                "reconciled": True,
                "identity": {"kind": "generation_batch", "batch_id": "gen_r"},
            },
        )
        self.assertEqual(
            action, {"kind": "generation_batch", "batch_id": "gen_r"}
        )

    def test_read_only_tools_and_scalars_have_no_action(self) -> None:
        self.assertIsNone(
            V3Application._brain_tool_action("list_recent_pieces", {"pieces": []})
        )
        self.assertIsNone(V3Application._brain_tool_action("read_piece", "text"))


class BrainToolSummaryTests(unittest.TestCase):
    """The one-line outcome is computed where the full object exists."""

    def test_summaries_describe_the_outcome_not_the_json(self) -> None:
        cases = [
            ("list_recent_pieces", {"pieces": [1, 2, 3]}, "3 piece(s) read"),
            (
                "generate_first_shots",
                {"id": "gen_abc", "state": "running"},
                "gen_abc · running",
            ),
            (
                "set_piece_archived",
                {"reconciled": True, "identity": {}},
                "effect reconciled",
            ),
            ("read_piece", {"name": "CS-001"}, "CS-001"),
        ]
        for tool, result, expected in cases:
            self.assertEqual(
                V3Application._brain_tool_summary(tool, result), expected, tool
            )

    def test_object_without_identity_lists_its_fields(self) -> None:
        summary = V3Application._brain_tool_summary(
            "read_runtime_status",
            {"agent": {}, "generation": {}, "system": {}},
        )
        self.assertEqual(summary, "3 field(s): agent, generation, system")

    def test_summary_survives_payloads_a_client_could_not_parse(self) -> None:
        # The transported preview is truncated; the summary must never be
        # derived from that truncated string.
        big = {"pieces": [{"id": f"piece_{index}"} for index in range(50)]}
        self.assertEqual(
            V3Application._brain_tool_summary("list_recent_pieces", big),
            "50 piece(s) read",
        )
