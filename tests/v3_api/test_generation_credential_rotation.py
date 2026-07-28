from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from .helpers import REPO_ROOT  # noqa: F401 - installs runtime on sys.path

from agent.keychain import MemoryCredentialStore
from v3_api import V3Application


class _ProbeClient:
    def __init__(self, base_url: str, key: str):
        self.base_url = base_url
        self.key = key

    def fetch_models(self):
        return {
            "data": [
                {"id": "claude-opus-5", "owned_by": "anthropic"},
            ]
        }

    def create_response(self, **kwargs):
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


class GenerationCredentialRotationTests(unittest.TestCase):
    def test_sync_a_to_b_preserves_prior_generation_revision_credential(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            app = V3Application(
                REPO_ROOT,
                state_root=Path(td) / "v3",
                max_generation_workers=1,
            )
            credentials = MemoryCredentialStore()
            app.credentials = credentials
            app.agent_settings.credentials = credentials
            app.agent_settings.client_factory = _ProbeClient
            try:
                test_a = self._stage_and_test(app, api_key="generation-a")
                app.sync_generation_from_agent_test(test_a["test_id"])
                ref_a = self._ref_for(credentials, "generation-a")

                test_b = self._stage_and_test(app, api_key="generation-b")
                ref_b = self._ref_for(credentials, "generation-b")
                self.assertIn(
                    ref_a,
                    credentials.values,
                    "A stays protected until generation config commits B",
                )

                synced = app.sync_generation_from_agent_test(test_b["test_id"])

                self.assertEqual(credentials.values[ref_a], "generation-a")
                self.assertEqual(credentials.values[ref_b], "generation-b")
                self.assertEqual(
                    app.generation_config.read()["credential_ref"], ref_b
                )
                self.assertEqual(
                    synced["revision_id"],
                    app.generation_config.read()["revision_id"],
                )
            finally:
                app.brain.close()
                app._generation_pool.shutdown(
                    wait=True,
                    cancel_futures=False,
                )

    def _stage_and_test(
        self, app: V3Application, *, api_key: str
    ) -> dict:
        app.agent_settings.update_draft(
            {
                "base_url": "http://127.0.0.1:8318/v1",
                "model_id": "claude-opus-5",
                "reasoning_effort": None,
                "orchestration": "standard",
            },
            api_key=api_key,
        )
        receipt = app.agent_settings.test_draft()
        self.assertTrue(receipt["ok"], receipt)
        return receipt

    @staticmethod
    def _ref_for(
        credentials: MemoryCredentialStore, value: str
    ) -> str:
        return next(
            ref
            for ref, stored in credentials.values.items()
            if stored == value
        )


if __name__ == "__main__":
    unittest.main()
