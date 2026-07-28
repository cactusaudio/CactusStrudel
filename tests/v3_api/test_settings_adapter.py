from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from .helpers import REPO_ROOT  # noqa: F401 - also installs runtime on sys.path

from agent.keychain import MemoryCredentialStore
from agent.settings import AgentSettingsService, AgentSettingsStore
from v3_api import (
    GenerationConfigStore,
    GenerationProfile,
    V3Application,
    V3Error,
)


class FakeCLIProxyClient:
    def __init__(self, base_url: str, key: str, calls: list):
        self.base_url = base_url
        self.key = key
        self.calls = calls

    def fetch_models(self):
        self.calls.append(("models", self.base_url, self.key))
        return {
            "data": [
                {"id": "claude-opus-5", "owned_by": "anthropic"},
                {"id": "gpt-5.6-sol", "owned_by": "openai"},
                {"id": "unmapped-live-model", "owned_by": "other"},
            ]
        }

    def create_response(self, **kwargs):
        self.calls.append(("response", kwargs))
        if kwargs.get("previous_response_id"):
            return {"id": "probe-final", "output_text": "READY"}
        return {
            "id": "probe-call",
            "output": [
                {
                    "type": "function_call",
                    "call_id": "call-probe",
                    "name": "agent_probe",
                    "arguments": '{"nonce":"cactusstrudel-v3"}',
                }
            ],
        }


class SettingsAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.calls: list = []
        self.credentials = MemoryCredentialStore()
        self.service = AgentSettingsService(
            store=AgentSettingsStore(self.root / "agent"),
            credentials=self.credentials,
            client_factory=lambda base, key: FakeCLIProxyClient(
                base, key, self.calls
            ),
            ultra_client_models={"gpt-5.6-sol"},
        )
        self.app = object.__new__(V3Application)
        self.app.agent_settings = self.service
        self.app._catalog_cache = None
        self.app.generation_config = GenerationConfigStore(
            self.root / "generation.json"
        )
        self.app.system_settings_public = lambda: {"api_version": "v2"}
        self.published: list[tuple[str, dict]] = []
        self.activities: list[tuple] = []
        self.app._publish = (
            lambda event_type, data: self.published.append((event_type, data)) or 1
        )
        self.app._activity = (
            lambda *args, **kwargs: self.activities.append((args, kwargs))
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_discover_test_apply_is_server_fingerprinted_and_read_back(self) -> None:
        initial = {
            "base_url": "http://127.0.0.1:8318/v1",
            "api_key": "fixture-key",
            "model_id": "claude-opus-5",
            "reasoning_effort": None,
            "orchestration": "standard",
            "key_present": True,
        }
        discovered = self.app.discover_agent_catalog(initial)
        self.assertEqual(
            [row["id"] for row in discovered["catalog"]],
            ["claude-opus-5", "gpt-5.6-sol", "unmapped-live-model"],
        )
        self.assertEqual(
            discovered["fingerprint"],
            self.service.ui_document()["draft_fingerprint"],
        )
        self.assertNotIn("fixture-key", repr(discovered))

        persisted_draft = self.service.ui_document()["draft"]
        tested = self.app.test_agent_settings(persisted_draft)
        self.assertTrue(tested["test"]["ok"], tested["test"])
        self.assertEqual(
            tested["test"]["fingerprint"], tested["draft_fingerprint"]
        )
        self.assertEqual(
            [stage["stage"] for stage in tested["test"]["stages"]],
            ["catalog", "response", "tool_loop"],
        )
        self.assertEqual(
            [call[0] for call in self.calls],
            ["models", "models", "response", "response"],
        )

        applied = self.app.apply_agent_settings(
            draft=tested["draft"],
            test_id=tested["test"]["id"],
        )
        self.assertTrue(applied["status"]["ready"])
        self.assertEqual(applied["active"]["model_id"], "claude-opus-5")
        self.assertEqual(applied["revision_id"], self.service.ui_document()["revision_id"])
        self.assertEqual(
            [event for event, _data in self.published],
            ["settings.updated", "settings.updated", "settings.updated"],
        )
        self.assertTrue(
            all(
                set(data) == {"agent", "generation", "system"}
                for _event, data in self.published
            )
        )

    def test_unknown_live_model_does_not_gain_a_guessed_effort(self) -> None:
        self.app.discover_agent_catalog(
            {
                "base_url": "http://127.0.0.1:8318/v1",
                "api_key": "fixture-key",
                "model_id": "unmapped-live-model",
                "reasoning_effort": None,
                "orchestration": "standard",
            }
        )
        model = next(
            row
            for row in self.service.ui_document()["catalog"]
            if row["id"] == "unmapped-live-model"
        )
        self.assertEqual(model["reasoning_efforts"], [])
        self.assertIsNone(model["default_reasoning_effort"])
        self.assertFalse(model["supports_ultra"])

    def test_historical_agent_environment_names_do_not_override_panel(self) -> None:
        with patch.dict(
            os.environ,
            {
                "CLIPROXY_BASE_URL": "http://retired.invalid/v1",
                "CLIPROXY_API_KEY": "ignored",
                "CACTUS_AGENT_MODEL": "retired-model",
                "CACTUS_AGENT_REASONING_EFFORT": "ultra",
            },
        ):
            document = self.app.agent_settings_public()

        self.assertEqual(document["managed_overrides"], [])
        self.assertNotEqual(document["draft"]["base_url"], "http://retired.invalid/v1")
        self.assertNotEqual(document["draft"]["model_id"], "retired-model")

    def test_reset_discards_candidate_key_but_preserves_active_key(self) -> None:
        initial = {
            "base_url": "http://127.0.0.1:8318/v1",
            "api_key": "active-key",
            "model_id": "claude-opus-5",
            "reasoning_effort": None,
            "orchestration": "standard",
        }
        self.app.discover_agent_catalog(initial)
        tested = self.app.test_agent_settings(self.service.ui_document()["draft"])
        applied = self.app.apply_agent_settings(
            draft=tested["draft"],
            test_id=tested["test"]["id"],
        )
        self.assertTrue(applied["status"]["ready"])
        active_ref = next(iter(self.credentials.values))

        self.service.stage_ui_draft(
            {
                "api_key": "candidate-key",
                "model_id": "gpt-5.6-sol",
                "reasoning_effort": "high",
                "orchestration": "standard",
            }
        )
        candidate_ref = next(
            ref for ref in self.credentials.values if ref != active_ref
        )
        reset = self.app.reset_agent_draft()

        self.assertEqual(reset["draft"], reset["active"])
        self.assertTrue(reset["status"]["ready"])
        self.assertIn(active_ref, self.credentials.values)
        self.assertNotIn(candidate_ref, self.credentials.values)
        self.assertEqual(self.credentials.values[active_ref], "active-key")

    def test_application_protects_generation_config_credential(self) -> None:
        app = V3Application(
            REPO_ROOT,
            state_root=self.root / "live-v3",
            max_generation_workers=1,
        )
        credentials = MemoryCredentialStore()
        app.credentials = credentials
        app.agent_settings.credentials = credentials
        try:
            app.agent_settings.update_draft({}, api_key="generation-key")
            generation_ref = next(iter(credentials.values))
            app.generation_config.write(
                base_url="http://127.0.0.1:8318/v1",
                credential_ref=generation_ref,
                profiles=[
                    GenerationProfile(
                        "fixture-profile",
                        "Fixture Profile",
                        "claude-opus-5",
                        None,
                    )
                ],
                default_profile_id="fixture-profile",
                catalog_fetched_at=None,
            )

            app.agent_settings.update_draft({}, api_key="candidate-key")
            candidate_ref = next(
                ref
                for ref, value in credentials.values.items()
                if value == "candidate-key"
            )
            app.reset_agent_draft()

            self.assertEqual(
                credentials.values[generation_ref], "generation-key"
            )
            self.assertNotIn(candidate_ref, credentials.values)
        finally:
            app.brain.close()
            app._generation_pool.shutdown(wait=True, cancel_futures=False)

    def test_generation_sync_and_default_are_explicit_durable_controls(self) -> None:
        self.app.discover_agent_catalog(
            {
                "base_url": "http://127.0.0.1:8318/v1",
                "api_key": "shared-key",
                "model_id": "claude-opus-5",
                "reasoning_effort": None,
                "orchestration": "standard",
            }
        )
        tested = self.app.test_agent_settings(self.service.ui_document()["draft"])
        test_id = tested["test"]["id"]

        synced = self.app.sync_generation_from_agent_test(test_id)

        self.assertTrue(synced["configured"])
        self.assertEqual(
            [profile["id"] for profile in synced["profiles"]],
            ["sol-max", "opus-producer"],
        )
        self.assertEqual(synced["default_profile_id"], "sol-max")
        self.assertEqual(synced["base_url"], "http://127.0.0.1:8318/v1")
        self.assertNotIn("credential_ref", synced)
        self.assertNotIn("shared-key", repr(synced))
        self.assertIsNone(self.service.store.read_state()["active_revision_id"])
        self.assertFalse(self.service.ui_document()["status"]["ready"])
        self.assertEqual(set(self.published[-1][1]), {"generation"})

        first_revision = synced["revision_id"]
        event_count = len(self.published)
        activity_count = len(self.activities)
        synced_again = self.app.sync_generation_from_agent_test(test_id)
        self.assertEqual(synced_again["revision_id"], first_revision)
        self.assertEqual(len(self.published), event_count)
        self.assertEqual(len(self.activities), activity_count)

        changed = self.app.set_generation_default("opus-producer")

        self.assertNotEqual(changed["revision_id"], first_revision)
        self.assertEqual(changed["default_profile_id"], "opus-producer")
        self.assertTrue(
            next(
                profile
                for profile in changed["profiles"]
                if profile["id"] == "opus-producer"
            )["active"]
        )
        persisted = self.app.generation_config.read()
        self.assertEqual(persisted["revision_id"], changed["revision_id"])
        self.assertEqual(persisted["default_profile_id"], "opus-producer")
        self.assertEqual(set(self.published[-1][1]), {"generation"})

        event_count = len(self.published)
        activity_count = len(self.activities)
        idempotent = self.app.set_generation_default("opus-producer")
        self.assertEqual(idempotent["revision_id"], changed["revision_id"])
        self.assertEqual(len(self.published), event_count)
        self.assertEqual(len(self.activities), activity_count)

        before_invalid = self.app.generation_config.read()
        with self.assertRaisesRegex(V3Error, "profile not found"):
            self.app.set_generation_default("Opus-Producer")
        self.assertEqual(self.app.generation_config.read(), before_invalid)

    def test_generation_sync_rejects_a_test_for_a_changed_draft(self) -> None:
        self.app.discover_agent_catalog(
            {
                "base_url": "http://127.0.0.1:8318/v1",
                "api_key": "shared-key",
                "model_id": "claude-opus-5",
                "reasoning_effort": None,
                "orchestration": "standard",
            }
        )
        tested = self.app.test_agent_settings(self.service.ui_document()["draft"])
        self.service.stage_ui_draft(
            {
                "model_id": "gpt-5.6-sol",
                "reasoning_effort": "high",
                "orchestration": "standard",
            }
        )

        with self.assertRaisesRegex(V3Error, "current Agent draft"):
            self.app.sync_generation_from_agent_test(tested["test"]["id"])

        self.assertIsNone(self.app.generation_config.read())

    def test_generation_config_revisions_are_immutable_and_keep_credential_refs(self) -> None:
        store = self.app.generation_config
        first = store.write(
            base_url="http://127.0.0.1:8318/v1",
            credential_ref="credential-a",
            profiles=[
                GenerationProfile(
                    "fixture-a",
                    "Fixture A",
                    "claude-opus-5",
                    None,
                )
            ],
            default_profile_id="fixture-a",
            catalog_fetched_at=None,
        )
        second = store.write(
            base_url="http://127.0.0.1:8318/v1",
            credential_ref="credential-b",
            profiles=[
                GenerationProfile(
                    "fixture-b",
                    "Fixture B",
                    "gpt-5.6-sol",
                    "max",
                )
            ],
            default_profile_id="fixture-b",
            catalog_fetched_at=None,
        )

        self.assertEqual(store.read()["revision_id"], second["revision_id"])
        self.assertEqual(
            store.read_revision(first["revision_id"])["credential_ref"],
            "credential-a",
        )
        self.assertEqual(
            store.read_revision(second["revision_id"])["credential_ref"],
            "credential-b",
        )
        self.assertEqual(
            store.credential_refs(),
            ("credential-a", "credential-b"),
        )


if __name__ == "__main__":
    unittest.main()
