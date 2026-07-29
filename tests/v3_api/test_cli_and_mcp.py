"""C1/C2: the CLI and MCP server are thin adapters over /api/v2.

Both are tested offline against a fake transport: correct routes, correct
idempotency-key behavior, guarded ear-truth mutation, and MCP protocol
shape (initialize / tools/list / tools/call / errors).
"""

from __future__ import annotations

import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any

RUNTIME_ROOT = Path(__file__).resolve().parents[2] / "runtime"
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))

import strudel_cli  # noqa: E402
from mcp_server import TOOLS, McpServer  # noqa: E402


class FakeClient:
    base_url = "http://fake"

    def __init__(self, responses: dict[str, Any]):
        self.responses = responses
        self.calls: list[dict[str, Any]] = []

    def request(self, method, path, *, body=None, idempotency_key=None, timeout=None):
        self.calls.append(
            {
                "method": method,
                "path": path,
                "body": body,
                "idempotency_key": idempotency_key,
            }
        )
        key = f"{method} {path.split('?')[0]}"
        if key not in self.responses:
            raise strudel_cli.CliError(f"unexpected request: {key}")
        return self.responses[key]


PIECE = {
    "id": "piece_x",
    "name": "X-001",
    "active_revision_id": "version_a",
    "active_revision": {
        "id": "version_a",
        "audio_sha": "a" * 64,
        "audio_url": "/producer-brain/assets/piece_x/version_a/audio.mp3",
        "duration_seconds": 60.0,
        "score": None,
        "usable": True,
        "provenance": {"model_id": "claude-opus-5"},
    },
    "revisions": [
        {
            "id": "version_a",
            "label": "Original",
            "audio_sha": "a" * 64,
            "audio_url": "/producer-brain/assets/piece_x/version_a/audio.mp3",
            "promoted": True,
            "usable": True,
            "score": None,
        }
    ],
}


class CliTests(unittest.TestCase):
    def _run(self, argv: list[str], client: FakeClient) -> tuple[int, str]:
        parser = strudel_cli.build_parser()
        args = parser.parse_args(argv)
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = int(args.func(client, args))
        return code, buffer.getvalue()

    def test_gen_sends_idempotency_key_and_profile(self) -> None:
        client = FakeClient(
            {
                "POST /api/v2/generation-jobs": {
                    "job": {
                        "id": "gen_1",
                        "state": "running",
                        "profile_id": "opus-producer",
                        "count": 2,
                    }
                }
            }
        )
        code, output = self._run(
            ["gen", "2", "warm dusk groove", "--profile", "opus-producer"],
            client,
        )
        self.assertEqual(code, 0)
        self.assertIn("gen_1", output)
        call = client.calls[0]
        self.assertEqual(call["body"]["count"], 2)
        self.assertEqual(call["body"]["profile_id"], "opus-producer")
        self.assertTrue(call["idempotency_key"].startswith("cactus-cli-"))

    def test_score_binds_the_exact_audio_sha_from_the_revision(self) -> None:
        client = FakeClient(
            {
                "GET /api/v2/pieces/piece_x": {"piece": PIECE},
                "PUT /api/v2/pieces/piece_x/revisions/version_a/score": {
                    "piece": PIECE
                },
            }
        )
        code, _ = self._run(["score", "piece_x", "8.5", "solid"], client)
        self.assertEqual(code, 0)
        put = client.calls[-1]
        self.assertEqual(put["body"]["audio_sha"], "a" * 64)
        self.assertEqual(put["body"]["score"], 8.5)

    def test_doctor_exit_code_reflects_verdict(self) -> None:
        client = FakeClient(
            {
                "GET /api/v2/doctor": {
                    "ok": False,
                    "checks": [
                        {
                            "id": "disk",
                            "ok": False,
                            "detail": "0.1 GB",
                            "fix": "free space",
                        }
                    ],
                }
            }
        )
        code, output = self._run(["doctor"], client)
        self.assertEqual(code, 1)
        self.assertIn("fix: free space", output)


class McpTests(unittest.TestCase):
    def test_initialize_and_tools_list_shape(self) -> None:
        server = McpServer(client=FakeClient({}))
        init = server.handle(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {"protocolVersion": "2025-06-18"},
            }
        )
        self.assertEqual(init["result"]["protocolVersion"], "2025-06-18")
        self.assertIn("tools", init["result"]["capabilities"])
        listing = server.handle(
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}
        )
        names = {tool["name"] for tool in listing["result"]["tools"]}
        self.assertEqual(names, {tool["name"] for tool in TOOLS})
        for tool in listing["result"]["tools"]:
            self.assertIn("inputSchema", tool)
            self.assertEqual(tool["inputSchema"]["type"], "object")

    def test_notifications_produce_no_response(self) -> None:
        server = McpServer(client=FakeClient({}))
        self.assertIsNone(
            server.handle(
                {"jsonrpc": "2.0", "method": "notifications/initialized"}
            )
        )

    def test_tool_call_wraps_api_and_returns_text_content(self) -> None:
        client = FakeClient({"GET /api/v2/health": {"ok": True, "pieces": 52}})
        server = McpServer(client=client)
        response = server.handle(
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "strudel_status", "arguments": {}},
            }
        )
        content = response["result"]["content"][0]
        self.assertEqual(content["type"], "text")
        self.assertEqual(json.loads(content["text"])["pieces"], 52)

    def test_score_refuses_without_acting_for_bowei(self) -> None:
        client = FakeClient({"GET /api/v2/pieces/piece_x": {"piece": PIECE}})
        server = McpServer(client=client)
        for arguments in (
            {"piece_id": "piece_x", "score": 9},
            {"piece_id": "piece_x", "score": 9, "acting_for_bowei": False},
            {"piece_id": "piece_x", "score": 9, "acting_for_bowei": "yes"},
        ):
            response = server.handle(
                {
                    "jsonrpc": "2.0",
                    "id": 4,
                    "method": "tools/call",
                    "params": {"name": "strudel_score", "arguments": arguments},
                }
            )
            self.assertTrue(response["result"].get("isError"), arguments)
        # No API mutation ever happened.
        self.assertTrue(
            all(call["method"] == "GET" for call in client.calls)
        )

    def test_score_with_explicit_authority_hits_the_exact_route(self) -> None:
        client = FakeClient(
            {
                "GET /api/v2/pieces/piece_x": {"piece": PIECE},
                "PUT /api/v2/pieces/piece_x/revisions/version_a/score": {
                    "piece": PIECE
                },
            }
        )
        server = McpServer(client=client)
        response = server.handle(
            {
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": {
                    "name": "strudel_score",
                    "arguments": {
                        "piece_id": "piece_x",
                        "score": 8.0,
                        "acting_for_bowei": True,
                    },
                },
            }
        )
        self.assertNotIn("isError", response["result"])
        put = client.calls[-1]
        self.assertEqual(put["method"], "PUT")
        self.assertEqual(put["body"]["audio_sha"], "a" * 64)

    def test_unknown_method_and_unknown_tool(self) -> None:
        server = McpServer(client=FakeClient({}))
        bad_method = server.handle(
            {"jsonrpc": "2.0", "id": 6, "method": "resources/list"}
        )
        self.assertEqual(bad_method["error"]["code"], -32601)
        bad_tool = server.handle(
            {
                "jsonrpc": "2.0",
                "id": 7,
                "method": "tools/call",
                "params": {"name": "strudel_nonexistent", "arguments": {}},
            }
        )
        self.assertTrue(bad_tool["result"].get("isError"))


if __name__ == "__main__":
    unittest.main()


class ReviewHardeningTests(unittest.TestCase):
    def test_generate_rejects_schema_violating_count(self) -> None:
        server = McpServer(client=FakeClient({}))
        for bad in (True, 2.9, "2", 3):
            response = server.handle(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": "strudel_generate",
                        "arguments": {"count": bad},
                    },
                }
            )
            self.assertTrue(response["result"].get("isError"), bad)

    def test_missing_required_argument_is_tool_error_not_internal(self) -> None:
        server = McpServer(client=FakeClient({}))
        response = server.handle(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "strudel_get_piece", "arguments": {}},
            }
        )
        self.assertNotIn("error", response)
        self.assertTrue(response["result"].get("isError"))

    def test_unsupported_protocol_version_returns_ours(self) -> None:
        server = McpServer(client=FakeClient({}))
        init = server.handle(
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "initialize",
                "params": {"protocolVersion": "2031-01-01"},
            }
        )
        self.assertEqual(init["result"]["protocolVersion"], "2025-06-18")

    def test_play_url_refuses_unknown_revision(self) -> None:
        client = FakeClient({"GET /api/v2/pieces/piece_x": {"piece": PIECE}})
        server = McpServer(client=client)
        response = server.handle(
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {
                    "name": "strudel_play_url",
                    "arguments": {
                        "piece_id": "piece_x",
                        "revision_id": "version_typo",
                    },
                },
            }
        )
        self.assertTrue(response["result"].get("isError"))

    def test_path_interpolation_escapes_slashes(self) -> None:
        client = FakeClient(
            {"GET /api/v2/pieces/evil%2F..%2Fpath": {"piece": PIECE}}
        )
        server = McpServer(client=client)
        server.handle(
            {
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": {
                    "name": "strudel_get_piece",
                    "arguments": {"piece_id": "evil/../path"},
                },
            }
        )
        self.assertEqual(
            client.calls[0]["path"], "/api/v2/pieces/evil%2F..%2Fpath"
        )
