from __future__ import annotations

import threading
import unittest

from runtime.agent.capabilities import (
    build_catalog,
    validate_profile_against_catalog,
)
from runtime.agent.cliproxy import (
    CLIProxyClient,
    normalize_base_url,
    response_output_text,
    response_tool_calls,
)
from runtime.agent.errors import ConfigurationError
from runtime.agent.models import AgentProfile


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []
        self.cancelled = []

    def request_json(self, **kwargs):
        self.requests.append(kwargs)
        return self.responses.pop(0)

    def cancel(self, request_token):
        self.cancelled.append(request_token)


class CatalogTests(unittest.TestCase):
    def test_live_exact_ids_are_enriched_but_never_invented(self):
        live = {
            "data": [
                {"id": "gpt-5.6-sol", "owned_by": "openai"},
                {"id": "unknown-new-model", "owned_by": "future"},
            ]
        }
        catalog = build_catalog(
            live, ultra_client_models={"gpt-5.6-sol", "gpt-5.6-terra"}
        )
        self.assertEqual(
            [entry.model_id for entry in catalog],
            ["gpt-5.6-sol", "unknown-new-model"],
        )
        sol, unknown = catalog
        self.assertEqual(sol.reasoning_efforts[-1], "max")
        self.assertTrue(sol.ultra_available)
        self.assertEqual(unknown.reasoning_efforts, ())
        self.assertFalse(unknown.ultra_available)
        self.assertNotIn("gpt-5.6-terra", [entry.model_id for entry in catalog])

    def test_unknown_capability_refuses_guessed_effort(self):
        catalog = build_catalog({"data": [{"id": "future-model"}]})
        profile = AgentProfile(
            model_id="future-model", reasoning_effort="high"
        )
        with self.assertRaisesRegex(ConfigurationError, "do not guess"):
            validate_profile_against_catalog(profile, catalog)

    def test_anthropic_policy_refuses_older_claude_id_even_if_live(self):
        catalog = build_catalog(
            {"data": [{"id": "claude-opus-4-8"}, {"id": "claude-opus-5"}]}
        )
        with self.assertRaisesRegex(ConfigurationError, "claude-opus-5"):
            validate_profile_against_catalog(
                AgentProfile(model_id="claude-opus-4-8"),
                catalog,
            )

    def test_ultra_requires_real_client_support_and_max(self):
        live = {"data": [{"id": "gpt-5.6-sol"}]}
        unavailable = build_catalog(live)
        with self.assertRaisesRegex(ConfigurationError, "no active Ultra"):
            validate_profile_against_catalog(
                AgentProfile(
                    model_id="gpt-5.6-sol",
                    reasoning_effort="max",
                    orchestration="ultra",
                ),
                unavailable,
            )
        available = build_catalog(
            live, ultra_client_models={"gpt-5.6-sol"}
        )
        entry = validate_profile_against_catalog(
            AgentProfile(
                model_id="gpt-5.6-sol",
                reasoning_effort="high",
                orchestration="ultra",
            ),
            available,
        )
        self.assertEqual(entry.model_id, "gpt-5.6-sol")
        self.assertEqual(
            AgentProfile(
                model_id="gpt-5.6-sol",
                reasoning_effort="high",
                orchestration="ultra",
            ).wire_reasoning_effort,
            "max",
        )


class ClientTests(unittest.TestCase):
    def test_base_url_only_accepts_native_direct_v1(self):
        self.assertEqual(
            normalize_base_url("http://127.0.0.1:8318/v1/"),
            "http://127.0.0.1:8318/v1",
        )
        with self.assertRaisesRegex(ConfigurationError, "retired"):
            normalize_base_url("http://127.0.0.1:8418/v1")
        with self.assertRaisesRegex(ConfigurationError, "native port"):
            normalize_base_url("http://127.0.0.1:9999/v1")
        with self.assertRaisesRegex(ConfigurationError, "/v1"):
            normalize_base_url("http://127.0.0.1:8318/chat/completions")

    def test_responses_request_uses_exact_model_and_separate_effort(self):
        transport = FakeTransport(
            [
                (
                    200,
                    {
                        "id": "resp-1",
                        "output": [
                            {
                                "type": "message",
                                "content": [
                                    {"type": "output_text", "text": "OK"}
                                ],
                            }
                        ],
                    },
                )
            ]
        )
        client = CLIProxyClient(
            "http://127.0.0.1:8318/v1",
            "native-test-key",
            transport=transport,
        )
        response = client.create_response(
            model_id="gpt-5.6-sol",
            input_value="probe",
            reasoning_effort="max",
        )
        request = transport.requests[0]
        self.assertEqual(request["url"], "http://127.0.0.1:8318/v1/responses")
        self.assertEqual(request["payload"]["model"], "gpt-5.6-sol")
        self.assertEqual(
            request["payload"]["reasoning"], {"effort": "max"}
        )
        self.assertNotIn("ultra", str(request["payload"]).lower())
        self.assertEqual(response_output_text(response), "OK")

    def test_client_refuses_wire_ultra(self):
        client = CLIProxyClient(
            "http://127.0.0.1:8318/v1",
            "key",
            transport=FakeTransport([]),
        )
        with self.assertRaisesRegex(ConfigurationError, "never sent"):
            client.create_response(
                model_id="gpt-5.6-sol",
                input_value="x",
                reasoning_effort="ultra",
            )

    def test_anthropic_string_input_uses_responses_message_shape(self):
        transport = FakeTransport(
            [(200, {"id": "resp-opus", "output": []})]
        )
        client = CLIProxyClient(
            "http://127.0.0.1:8318/v1",
            "native-test-key",
            transport=transport,
        )
        client.create_response(
            model_id="claude-opus-5",
            input_value="probe",
            reasoning_effort=None,
        )
        self.assertEqual(
            transport.requests[0]["payload"]["input"],
            [
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": "probe"}],
                }
            ],
        )

    def test_anthropic_tool_continuation_replays_matching_responses_context(self):
        function_call = {
            "type": "function_call",
            "call_id": "toolu-1",
            "name": "agent_probe",
            "arguments": '{"nonce":"n"}',
        }
        transport = FakeTransport(
            [
                (200, {"id": "resp-1", "output": [function_call]}),
                (
                    200,
                    {
                        "id": "resp-2",
                        "output": [
                            {
                                "type": "message",
                                "content": [{"type": "output_text", "text": "READY"}],
                            }
                        ],
                    },
                ),
            ]
        )
        client = CLIProxyClient(
            "http://127.0.0.1:8318/v1",
            "native-test-key",
            transport=transport,
        )
        client.create_response(
            model_id="claude-opus-5",
            input_value="use the probe",
            reasoning_effort=None,
        )
        client.create_response(
            model_id="claude-opus-5",
            input_value=[
                {
                    "type": "function_call_output",
                    "call_id": "toolu-1",
                    "output": '{"ok":true}',
                }
            ],
            reasoning_effort=None,
            previous_response_id="resp-1",
        )
        continuation = transport.requests[1]["payload"]
        self.assertNotIn("previous_response_id", continuation)
        self.assertEqual(continuation["input"][1], function_call)
        self.assertEqual(
            continuation["input"][-1]["type"], "function_call_output"
        )

    def test_function_calls_parse_openai_responses_shape(self):
        response = {
            "output": [
                {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "read_piece",
                    "arguments": '{"name":"A"}',
                }
            ]
        }
        self.assertEqual(
            response_tool_calls(response),
            [
                {
                    "call_id": "call-1",
                    "name": "read_piece",
                    "arguments": {"name": "A"},
                }
            ],
        )

    def test_cancel_closes_all_inflight_job_requests(self):
        started = threading.Event()
        release = threading.Event()

        class BlockingTransport(FakeTransport):
            def request_json(self, **kwargs):
                self.requests.append(kwargs)
                started.set()
                release.wait(2)
                return 200, {"data": [{"id": "claude-opus-5"}]}

            def cancel(self, request_token):
                super().cancel(request_token)
                release.set()

        transport = BlockingTransport([])
        client = CLIProxyClient(
            "http://127.0.0.1:8318/v1", "key", transport=transport
        )
        thread = threading.Thread(
            target=lambda: client.fetch_models(job_id="job-1")
        )
        thread.start()
        self.assertTrue(started.wait(1))
        client.cancel("job-1")
        thread.join(2)
        self.assertEqual(len(transport.cancelled), 1)


if __name__ == "__main__":
    unittest.main()
