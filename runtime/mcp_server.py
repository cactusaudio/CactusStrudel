"""CactusStrudel MCP server (C2): stdio JSON-RPC over the /api/v2 chokepoint.

A deliberately minimal, dependency-free implementation of the MCP stdio
transport (newline-delimited JSON-RPC 2.0): initialize, tools/list,
tools/call, ping. Every tool is a thin wrapper over the same HTTP API the
GUI and CLI use — identical invariants, idempotency and receipts.

Ear-truth posture: `strudel_score` writes Bowei's 0-10 ground-truth channel,
so it requires `acting_for_bowei: true`, which a calling agent may only set
when relaying an explicit human scoring instruction. Agent Settings Apply is
NOT exposed here at all.
"""

from __future__ import annotations

import json
import sys
import urllib.parse
from typing import Any
from uuid import uuid4

from strudel_cli import ApiClient, CliError

PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_PROTOCOL_VERSIONS = {"2024-11-05", "2025-03-26", "2025-06-18"}
SERVER_INFO = {"name": "strudel", "version": "1.0.0"}


def _schema(
    properties: dict[str, Any], required: list[str] | None = None
) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


TOOLS: list[dict[str, Any]] = [
    {
        "name": "strudel_status",
        "description": "Compact runtime readback: pieces, jobs, agent readiness.",
        "inputSchema": _schema({}),
    },
    {
        "name": "strudel_doctor",
        "description": "Full diagnostic pass; every failing check names its fix.",
        "inputSchema": _schema({}),
    },
    {
        "name": "strudel_list_pieces",
        "description": "List the library (immutable pieces with active revisions).",
        "inputSchema": _schema(
            {
                "include_archived": {"type": "boolean", "default": False},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            }
        ),
    },
    {
        "name": "strudel_get_piece",
        "description": "One piece with all immutable revisions and receipts.",
        "inputSchema": _schema({"piece_id": {"type": "string"}}, ["piece_id"]),
    },
    {
        "name": "strudel_play_url",
        "description": (
            "Absolute audio URL for the exact rendered bytes of a revision "
            "(defaults to the active revision)."
        ),
        "inputSchema": _schema(
            {
                "piece_id": {"type": "string"},
                "revision_id": {"type": "string"},
            },
            ["piece_id"],
        ),
    },
    {
        "name": "strudel_operation_readback",
        "description": "Exact prior outcome of one idempotency key (IDEM-001).",
        "inputSchema": _schema(
            {"idempotency_key": {"type": "string"}}, ["idempotency_key"]
        ),
    },
    {
        "name": "strudel_agent_settings",
        "description": "Masked Agent settings readback (no credentials).",
        "inputSchema": _schema({}),
    },
    {
        "name": "strudel_generate",
        "description": (
            "MUTATING: queue 1/2/4 independent first-shot generations "
            "(durable server-owned jobs; costs real model calls)."
        ),
        "inputSchema": _schema(
            {
                "count": {"type": "integer", "enum": [1, 2, 4]},
                "prompt": {"type": "string"},
                "profile_id": {"type": "string"},
                "idempotency_key": {"type": "string"},
            },
            ["count"],
        ),
    },
    {
        "name": "strudel_preview",
        "description": (
            "MUTATING: validate and render complete Strudel code as an "
            "immutable B preview of a piece (does not change the active "
            "revision). Long-running (a real render)."
        ),
        "inputSchema": _schema(
            {
                "piece_id": {"type": "string"},
                "source_revision_id": {"type": "string"},
                "code": {"type": "string"},
                "intent": {"type": "string"},
                "idempotency_key": {"type": "string"},
            },
            ["piece_id", "source_revision_id", "code"],
        ),
    },
    {
        "name": "strudel_promote",
        "description": (
            "MUTATING: make an immutable revision the piece's current "
            "version (old bytes never overwritten; reversible)."
        ),
        "inputSchema": _schema(
            {
                "piece_id": {"type": "string"},
                "revision_id": {"type": "string"},
            },
            ["piece_id", "revision_id"],
        ),
    },
    {
        "name": "strudel_brain",
        "description": (
            "MUTATING: send one durable Brain message (optionally pinned to "
            "a piece). The Brain model can itself archive/restore pieces, "
            "render previews, and launch PAID generations through its own "
            "tools. wait=true polls toward the terminal state; the result "
            "carries timed_out=true if the deadline passed first."
        ),
        "inputSchema": _schema(
            {
                "message": {"type": "string"},
                "piece_id": {"type": "string"},
                "wait": {"type": "boolean", "default": True},
                "idempotency_key": {"type": "string"},
            },
            ["message"],
        ),
    },
    {
        "name": "strudel_score",
        "description": (
            "GUARDED MUTATION: bind a 0-10 score to a revision's exact "
            "audio bytes. This is Bowei's ear-truth channel: set "
            "acting_for_bowei=true ONLY when relaying his explicit scoring "
            "instruction — never from your own judgment."
        ),
        "inputSchema": _schema(
            {
                "piece_id": {"type": "string"},
                "revision_id": {"type": "string"},
                "score": {"type": "number", "minimum": 0, "maximum": 10},
                "note": {"type": "string"},
                "acting_for_bowei": {"type": "boolean"},
                "idempotency_key": {"type": "string"},
            },
            ["piece_id", "score", "acting_for_bowei"],
        ),
    },
]


class McpServer:
    def __init__(self, client: ApiClient | None = None):
        self.client = client or ApiClient()

    # ------------------------------------------------------------------
    # JSON-RPC surface

    def handle(self, message: dict[str, Any]) -> dict[str, Any] | None:
        method = str(message.get("method") or "")
        message_id = message.get("id")
        if method.startswith("notifications/"):
            return None
        try:
            if method == "initialize":
                requested = (message.get("params") or {}).get("protocolVersion")
                result: Any = {
                    "protocolVersion": (
                        requested
                        if requested in SUPPORTED_PROTOCOL_VERSIONS
                        else PROTOCOL_VERSION
                    ),
                    "capabilities": {"tools": {}},
                    "serverInfo": SERVER_INFO,
                }
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": TOOLS}
            elif method == "tools/call":
                params = message.get("params") or {}
                result = self._call_tool(
                    str(params.get("name") or ""),
                    dict(params.get("arguments") or {}),
                )
            else:
                return self._error(message_id, -32601, f"unknown method: {method}")
        except CliError as exc:
            return self._tool_error(message_id, str(exc))
        except (KeyError, TypeError, ValueError) as exc:
            # Bad/missing tool arguments are a tool-level failure the model
            # can correct, not an internal server error.
            return self._tool_error(
                message_id, f"invalid arguments: {type(exc).__name__}: {exc}"
            )
        except Exception as exc:  # noqa: BLE001 - protocol boundary
            return self._error(
                message_id, -32603, f"{type(exc).__name__}: {exc}"
            )
        return {"jsonrpc": "2.0", "id": message_id, "result": result}

    @staticmethod
    def _error(message_id: Any, code: int, text: str) -> dict[str, Any]:
        return {
            "jsonrpc": "2.0",
            "id": message_id,
            "error": {"code": code, "message": text},
        }

    @staticmethod
    def _tool_error(message_id: Any, text: str) -> dict[str, Any]:
        return {
            "jsonrpc": "2.0",
            "id": message_id,
            "result": {
                "content": [{"type": "text", "text": text}],
                "isError": True,
            },
        }

    # ------------------------------------------------------------------
    # Tools

    def _call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        handler = getattr(self, f"_tool_{name}", None)
        if handler is None:
            raise CliError(f"unknown tool: {name}")
        payload = handler(arguments)
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        payload, ensure_ascii=False, indent=2, sort_keys=True
                    ),
                }
            ]
        }

    def _tool_strudel_status(self, _arguments: dict[str, Any]) -> Any:
        return self.client.request("GET", "/api/v2/health")

    def _tool_strudel_doctor(self, _arguments: dict[str, Any]) -> Any:
        return self.client.request("GET", "/api/v2/doctor", timeout=60)

    def _tool_strudel_list_pieces(self, arguments: dict[str, Any]) -> Any:
        payload = self.client.request(
            "GET",
            "/api/v2/pieces"
            + ("?archived=all" if arguments.get("include_archived") else ""),
        )
        limit = int(arguments.get("limit") or 30)
        pieces = payload.get("pieces", [])[:limit]
        return {
            "pieces": [
                {
                    "id": piece.get("id"),
                    "name": piece.get("name"),
                    "active_revision_id": piece.get("active_revision_id"),
                    "duration_seconds": (piece.get("active_revision") or {}).get(
                        "duration_seconds"
                    ),
                    "score": (piece.get("active_revision") or {}).get("score"),
                    "usable": (piece.get("active_revision") or {}).get(
                        "usable", True
                    ),
                    "model_id": (
                        (piece.get("active_revision") or {}).get("provenance")
                        or {}
                    ).get("model_id"),
                }
                for piece in pieces
            ],
            "total": len(payload.get("pieces", [])),
        }

    def _tool_strudel_get_piece(self, arguments: dict[str, Any]) -> Any:
        return self.client.request(
            "GET",
            "/api/v2/pieces/"
            + urllib.parse.quote(str(arguments["piece_id"]), safe=""),
        )["piece"]

    def _tool_strudel_play_url(self, arguments: dict[str, Any]) -> Any:
        piece = self._tool_strudel_get_piece(arguments)
        revision = piece.get("active_revision") or {}
        wanted = arguments.get("revision_id")
        if wanted:
            match = next(
                (
                    row
                    for row in piece.get("revisions", [])
                    if row.get("id") == wanted
                ),
                None,
            )
            if match is None:
                raise CliError(f"revision not found on piece: {wanted}")
            revision = match
        return {
            "revision_id": revision.get("id"),
            "audio_sha": revision.get("audio_sha"),
            "usable": revision.get("usable", True),
            "audio_url": f"{self.client.base_url}{revision.get('audio_url')}",
        }

    def _tool_strudel_operation_readback(self, arguments: dict[str, Any]) -> Any:
        return self.client.request(
            "GET",
            "/api/v2/operations/"
            + urllib.parse.quote(str(arguments["idempotency_key"]), safe=""),
        )

    def _tool_strudel_agent_settings(self, _arguments: dict[str, Any]) -> Any:
        return self.client.request("GET", "/api/v2/settings/agent")

    def _tool_strudel_generate(self, arguments: dict[str, Any]) -> Any:
        count = arguments.get("count")
        if isinstance(count, bool) or not isinstance(count, int) or count not in (1, 2, 4):
            raise CliError("count must be exactly the integer 1, 2, or 4")
        return self.client.request(
            "POST",
            "/api/v2/generation-jobs",
            body={
                "count": count,
                "prompt": str(arguments.get("prompt") or ""),
                "profile_id": arguments.get("profile_id"),
            },
            idempotency_key=str(
                arguments.get("idempotency_key") or f"mcp-{uuid4().hex}"
            ),
        )["job"]

    def _tool_strudel_preview(self, arguments: dict[str, Any]) -> Any:
        return self.client.request(
            "POST",
            "/api/v2/pieces/"
            + urllib.parse.quote(str(arguments["piece_id"]), safe="")
            + "/previews",
            body={
                "code": str(arguments["code"]),
                "source_revision_id": str(arguments["source_revision_id"]),
                "intent": str(arguments.get("intent") or "mcp preview"),
            },
            idempotency_key=str(
                arguments.get("idempotency_key") or f"mcp-{uuid4().hex}"
            ),
            timeout=1200,
        )

    def _tool_strudel_promote(self, arguments: dict[str, Any]) -> Any:
        return self.client.request(
            "POST",
            "/api/v2/pieces/"
            + urllib.parse.quote(str(arguments["piece_id"]), safe="")
            + "/revisions",
            body={
                "action": "promote",
                "revision_id": str(arguments["revision_id"]),
            },
        )

    def _tool_strudel_brain(self, arguments: dict[str, Any]) -> Any:
        body: dict[str, Any] = {"message": str(arguments["message"])}
        if arguments.get("piece_id"):
            body["piece_id"] = str(arguments["piece_id"])
        job = self.client.request(
            "POST",
            "/api/v2/brain/jobs",
            body=body,
            idempotency_key=str(
                arguments.get("idempotency_key") or f"mcp-{uuid4().hex}"
            ),
        )["job"]
        if arguments.get("wait") is False:
            return job
        import time as _time

        deadline = _time.monotonic() + 300
        while _time.monotonic() < deadline:
            job = self.client.request(
                "GET",
                f"/api/v2/brain/jobs/{urllib.parse.quote(str(job["id"]), safe="")}",
            )["job"]
            if job.get("state") not in {
                "queued",
                "running",
                "waiting_for_tool",
                "cancelling",
            }:
                break
            _time.sleep(2)
        answer = next(
            (
                message["text"]
                for message in reversed(job.get("messages", []))
                if message.get("role") == "assistant"
            ),
            None,
        )
        terminal = job.get("state") not in {
            "queued",
            "running",
            "waiting_for_tool",
            "cancelling",
        }
        return {
            "job_id": job.get("id"),
            "state": job.get("state"),
            "timed_out": not terminal,
            "answer": answer,
            "error": job.get("error"),
            "receipt": job.get("receipt"),
        }

    def _tool_strudel_score(self, arguments: dict[str, Any]) -> Any:
        if arguments.get("acting_for_bowei") is not True:
            raise CliError(
                "strudel_score binds Bowei's ear-truth channel: refuse unless "
                "you are relaying his explicit scoring instruction "
                "(acting_for_bowei=true)"
            )
        score_value = arguments.get("score")
        if isinstance(score_value, bool) or not isinstance(
            score_value, (int, float)
        ) or not 0 <= float(score_value) <= 10:
            raise CliError("score must be a number from 0 to 10")
        piece = self._tool_strudel_get_piece(arguments)
        revision_id = str(
            arguments.get("revision_id") or piece.get("active_revision_id")
        )
        revision = next(
            (
                row
                for row in piece.get("revisions", [])
                if row.get("id") == revision_id
            ),
            None,
        )
        if revision is None:
            raise CliError(f"revision not found: {revision_id}")
        return self.client.request(
            "PUT",
            "/api/v2/pieces/"
            + urllib.parse.quote(str(piece["id"]), safe="")
            + "/revisions/"
            + urllib.parse.quote(revision_id, safe="")
            + "/score",
            body={
                "score": float(arguments["score"]),
                "note": str(arguments.get("note") or ""),
                "audio_sha": revision["audio_sha"],
            },
            idempotency_key=str(
                arguments.get("idempotency_key") or f"mcp-{uuid4().hex}"
            ),
        )


def _write(response: dict[str, Any]) -> None:
    sys.stdout.write(
        json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n"
    )
    sys.stdout.flush()


def main() -> int:
    server = McpServer()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            _write(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32700, "message": "parse error"},
                }
            )
            continue
        if not isinstance(message, dict):
            _write(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32600, "message": "invalid request"},
                }
            )
            continue
        response = server.handle(message)
        if response is not None:
            _write(response)
    return 0


if __name__ == "__main__":
    sys.exit(main())
