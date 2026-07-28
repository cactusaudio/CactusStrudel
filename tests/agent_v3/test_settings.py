from __future__ import annotations

import json
from pathlib import Path
import tempfile
import threading
import unittest

from runtime.agent.errors import ApplyError, CLIProxyError
from runtime.agent.job_store import DEFAULT_JOBS_DB
from runtime.agent.keychain import MemoryCredentialStore
from runtime.agent.settings import (
    DEFAULT_SETTINGS_ROOT,
    AgentSettingsService,
    AgentSettingsStore,
)


class FakeClient:
    def __init__(self, base_url, key, calls):
        self.base_url = base_url
        self.key = key
        self.calls = calls

    def fetch_models(self, **_kwargs):
        self.calls.append(("models", self.base_url, self.key))
        if self.key == "wrong":
            raise CLIProxyError("CLIProxy HTTP 401: invalid API key", status=401)
        return {
            "data": [
                {"id": "claude-opus-5", "owned_by": "anthropic"},
                {"id": "gpt-5.6-sol", "owned_by": "openai"},
            ]
        }

    def create_response(self, **kwargs):
        self.calls.append(("response", kwargs))
        if not kwargs.get("previous_response_id"):
            return {
                "id": "resp-probe-tool",
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "probe-call-1",
                        "name": "agent_probe",
                        "arguments": '{"nonce":"cactusstrudel-v3"}',
                    }
                ],
            }
        return {"id": "resp-probe-final", "output_text": "READY"}


class SettingsTests(unittest.TestCase):
    def make_service(self, root, *, protected_credential_refs=None):
        calls = []
        credentials = MemoryCredentialStore()
        service = AgentSettingsService(
            store=AgentSettingsStore(root),
            credentials=credentials,
            client_factory=lambda base, key: FakeClient(base, key, calls),
            ultra_client_models={"gpt-5.6-sol"},
            protected_credential_refs=protected_credential_refs,
        )
        return service, credentials, calls

    def test_standalone_defaults_share_live_v3_truth_roots(self):
        expected_root = Path.home() / ".cactus-strudel" / "v3"
        self.assertEqual(DEFAULT_SETTINGS_ROOT, expected_root / "agent")
        self.assertEqual(DEFAULT_JOBS_DB, expected_root / "runtime.sqlite3")

    def test_candidate_key_a_to_b_to_reset_reclaims_both_refs(self):
        with tempfile.TemporaryDirectory() as td:
            service, credentials, _calls = self.make_service(td)
            service.update_draft({}, api_key="candidate-a")
            ref_a = next(iter(credentials.values))

            service.update_draft({}, api_key="candidate-b")
            self.assertNotIn(ref_a, credentials.values)
            self.assertEqual(list(credentials.values.values()), ["candidate-b"])
            ref_b = next(iter(credentials.values))

            reset = service.reset_draft()
            self.assertFalse(reset["draft"]["has_key"])
            self.assertNotIn(ref_b, credentials.values)
            self.assertEqual(credentials.values, {})

    def test_active_and_caller_refs_are_protected_while_candidates_are_reclaimed(
        self,
    ):
        with tempfile.TemporaryDirectory() as td:
            caller_protected: set[str] = set()
            service, credentials, _calls = self.make_service(
                td,
                protected_credential_refs=lambda: caller_protected,
            )
            service.update_draft(
                {
                    "model_id": "claude-opus-5",
                    "reasoning_effort": None,
                },
                api_key="active-key",
            )
            receipt = service.test_draft()
            service.apply_draft(receipt["test_id"])
            active_ref = next(iter(credentials.values))

            service.update_draft({}, api_key="generation-key")
            generation_ref = next(
                ref
                for ref, value in credentials.values.items()
                if value == "generation-key"
            )
            caller_protected.add(generation_ref)
            service.update_draft({}, api_key="candidate-key")
            candidate_ref = next(
                ref
                for ref, value in credentials.values.items()
                if value == "candidate-key"
            )
            service.clear_draft_key()

            self.assertEqual(
                credentials.values,
                {
                    active_ref: "active-key",
                    generation_ref: "generation-key",
                },
            )
            self.assertNotIn(candidate_ref, credentials.values)

    def test_every_applied_revision_keeps_its_pinned_credential(self):
        with tempfile.TemporaryDirectory() as td:
            service, credentials, _calls = self.make_service(td)
            service.update_draft(
                {
                    "model_id": "claude-opus-5",
                    "reasoning_effort": None,
                },
                api_key="revision-a",
            )
            test_a = service.test_draft()
            service.apply_draft(test_a["test_id"])
            ref_a = next(
                ref
                for ref, value in credentials.values.items()
                if value == "revision-a"
            )

            service.update_draft({}, api_key="revision-b")
            test_b = service.test_draft()
            service.apply_draft(test_b["test_id"])
            ref_b = next(
                ref
                for ref, value in credentials.values.items()
                if value == "revision-b"
            )
            service.clear_draft_key()

            self.assertFalse(service.reclaim_credential_if_unreferenced(ref_a))
            self.assertFalse(service.reclaim_credential_if_unreferenced(ref_b))
            self.assertEqual(
                credentials.values,
                {ref_a: "revision-a", ref_b: "revision-b"},
            )

    def test_new_key_is_removed_if_draft_save_fails(self):
        class FailingStore(AgentSettingsStore):
            def save_draft(self, profile):
                raise OSError("fixture draft write failure")

        with tempfile.TemporaryDirectory() as td:
            credentials = MemoryCredentialStore()
            service = AgentSettingsService(
                store=FailingStore(td),
                credentials=credentials,
            )
            with self.assertRaisesRegex(OSError, "fixture draft write failure"):
                service.update_draft({}, api_key="must-not-leak")
            self.assertEqual(credentials.values, {})

    def test_key_stays_out_of_json_and_apply_requires_matching_test(self):
        with tempfile.TemporaryDirectory() as td:
            service, credentials, calls = self.make_service(td)
            state = service.update_draft(
                {
                    "base_url": "http://127.0.0.1:8318/v1",
                    "model_id": "claude-opus-5",
                    "reasoning_effort": None,
                    "orchestration": "standard",
                },
                api_key="native-super-secret",
            )
            self.assertTrue(state["draft"]["has_key"])
            self.assertIsNone(state["last_test"])
            receipt = service.test_draft()
            self.assertTrue(receipt["ok"], receipt)
            applied = service.apply_draft(receipt["test_id"])
            self.assertTrue(applied["ok"])
            self.assertEqual(applied["active"]["model_id"], "claude-opus-5")
            self.assertEqual(
                [call[0] for call in calls],
                ["models", "response", "response"],
            )
            self.assertEqual(
                calls[1][1]["model_id"], "claude-opus-5"
            )
            self.assertEqual(
                calls[2][1]["previous_response_id"], "resp-probe-tool"
            )
            self.assertEqual(
                calls[1][1]["tools"][0]["name"], "agent_probe"
            )
            self.assertEqual(
                calls[2][1]["input_value"][0]["type"],
                "function_call_output",
            )
            self.assertEqual(
                [stage["stage"] for stage in receipt["stages"]],
                ["catalog", "response", "tool_loop"],
            )
            self.assertGreaterEqual(receipt["latency_ms"], 0)
            ui = service.ui_document()
            self.assertEqual(ui["active"]["model_id"], "claude-opus-5")
            self.assertEqual(ui["test"]["id"], receipt["test_id"])
            self.assertEqual(
                [model["id"] for model in ui["catalog"]],
                ["claude-opus-5", "gpt-5.6-sol"],
            )
            self.assertNotIn("credential_ref", ui["draft"])
            credential_ref = next(iter(credentials.values))
            self.assertEqual(
                credentials.values[credential_ref], "native-super-secret"
            )
            credentials.delete(credential_ref)
            unavailable = service.ui_document()
            self.assertFalse(unavailable["status"]["ready"])
            self.assertFalse(unavailable["active"]["key_present"])

            persisted = "\n".join(
                path.read_text(encoding="utf-8")
                for path in Path(td).rglob("*.json")
            )
            self.assertNotIn("native-super-secret", persisted)
            self.assertNotIn('"api_key"', persisted)
            self.assertIn("credential_ref", persisted)

    def test_draft_change_invalidates_successful_test(self):
        with tempfile.TemporaryDirectory() as td:
            service, _credentials, _calls = self.make_service(td)
            service.update_draft(
                {
                    "model_id": "gpt-5.6-sol",
                    "reasoning_effort": "high",
                    "orchestration": "standard",
                },
                api_key="right",
            )
            receipt = service.test_draft()
            self.assertTrue(receipt["ok"])
            state = service.update_draft({"reasoning_effort": "xhigh"})
            self.assertIsNone(state["last_test"])
            with self.assertRaisesRegex(ApplyError, "not the current"):
                service.apply_draft(receipt["test_id"])

    def test_wrong_key_fails_visibly_and_cannot_apply(self):
        with tempfile.TemporaryDirectory() as td:
            service, _credentials, _calls = self.make_service(td)
            service.update_draft(
                {
                    "model_id": "claude-opus-5",
                    "reasoning_effort": None,
                },
                api_key="wrong",
            )
            receipt = service.test_draft()
            self.assertFalse(receipt["ok"])
            self.assertIn("401", receipt["error"])
            with self.assertRaisesRegex(ApplyError, "successful"):
                service.apply_draft(receipt["test_id"])

    def test_ultra_is_separate_and_wire_effort_is_max(self):
        with tempfile.TemporaryDirectory() as td:
            service, _credentials, calls = self.make_service(td)
            service.update_draft(
                {
                    "model_id": "gpt-5.6-sol",
                    "reasoning_effort": "high",
                    "orchestration": "ultra",
                },
                api_key="right",
            )
            receipt = service.test_draft()
            self.assertTrue(receipt["ok"], receipt)
            response_request = calls[-1][1]
            self.assertEqual(response_request["reasoning_effort"], "max")
            self.assertEqual(receipt["reasoning_effort"], "high")
            self.assertEqual(receipt["orchestration"], "ultra")
            self.assertNotEqual(receipt["wire_reasoning_effort"], "ultra")

    def test_inflight_test_cannot_revalidate_a_changed_draft(self):
        with tempfile.TemporaryDirectory() as td:
            started = threading.Event()
            release = threading.Event()

            class BlockingClient(FakeClient):
                def fetch_models(self, **kwargs):
                    started.set()
                    release.wait(2)
                    return super().fetch_models(**kwargs)

            calls = []
            service = AgentSettingsService(
                store=AgentSettingsStore(td),
                credentials=MemoryCredentialStore(),
                client_factory=lambda base, key: BlockingClient(
                    base, key, calls
                ),
            )
            service.update_draft(
                {
                    "model_id": "claude-opus-5",
                    "reasoning_effort": None,
                },
                api_key="right",
            )
            result = {}

            def run_test():
                result.update(service.test_draft())

            worker = threading.Thread(target=run_test)
            worker.start()
            self.assertTrue(started.wait(1))
            service.update_draft(
                {
                    "model_id": "gpt-5.6-sol",
                    "reasoning_effort": "high",
                }
            )
            release.set()
            worker.join(2)
            self.assertTrue(result["ok"])
            self.assertTrue(result["stale"])
            self.assertIsNone(service.get_state()["last_test"])

    def test_catalog_survives_model_edit_but_not_connection_change(self):
        with tempfile.TemporaryDirectory() as td:
            service, _credentials, _calls = self.make_service(td)
            service.stage_ui_draft(
                {
                    "base_url": "http://127.0.0.1:8318/v1",
                    "api_key": "right",
                    "model_id": "claude-opus-5",
                    "reasoning_effort": None,
                    "orchestration": "standard",
                    "key_present": True,
                }
            )
            discovered = service.discover_catalog()
            self.assertFalse(discovered["stale"])
            self.assertEqual(len(service.ui_document()["catalog"]), 2)
            service.stage_ui_draft(
                {
                    "model_id": "gpt-5.6-sol",
                    "reasoning_effort": "high",
                }
            )
            self.assertEqual(len(service.ui_document()["catalog"]), 2)
            service.stage_ui_draft(
                {"base_url": "http://mac.local:8318/v1"}
            )
            self.assertEqual(service.ui_document()["catalog"], [])


if __name__ == "__main__":
    unittest.main()
