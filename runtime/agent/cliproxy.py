"""Direct native CLIProxyAPI client using the Responses wire API."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
import http.client
import json
import socket
import threading
from typing import Any, Protocol
from urllib.parse import urlsplit
from uuid import uuid4

from .errors import CLIProxyError, ConfigurationError, JobCancelled


ALLOWED_NATIVE_PORTS = frozenset({8317, 8318, 8319, 8320})
RETIRED_PORTS = frozenset({8417, 8418, 8419, 8420})


def normalize_base_url(value: str) -> str:
    text = str(value or "").strip().rstrip("/")
    parsed = urlsplit(text)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ConfigurationError(
            "API Base URL must be a direct http(s) CLIProxy endpoint"
        )
    try:
        port = parsed.port
    except ValueError as exc:
        raise ConfigurationError("API Base URL has an invalid port") from exc
    if port in RETIRED_PORTS:
        raise ConfigurationError(
            f"retired Cactus shim port {port} is not a supported Agent path"
        )
    if port not in ALLOWED_NATIVE_PORTS:
        allowed = ", ".join(str(item) for item in sorted(ALLOWED_NATIVE_PORTS))
        raise ConfigurationError(
            f"CLIProxy must use a native port ({allowed})"
        )
    if parsed.path.rstrip("/") != "/v1" or parsed.query or parsed.fragment:
        raise ConfigurationError(
            "API Base URL must end at the direct CLIProxy /v1 root"
        )
    host = parsed.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    return f"{parsed.scheme}://{host}:{port}/v1"


class JSONTransport(Protocol):
    def request_json(
        self,
        *,
        method: str,
        url: str,
        headers: Mapping[str, str],
        payload: Any | None,
        timeout: float,
        request_token: str,
        cancel_event: threading.Event | None,
    ) -> tuple[int, Any]: ...

    def cancel(self, request_token: str) -> None: ...


@dataclass(slots=True)
class HTTPJSONTransport:
    """Small direct HTTP transport whose connections can be closed on cancel."""

    _active: dict[str, http.client.HTTPConnection] = field(default_factory=dict)
    _lock: threading.RLock = field(default_factory=threading.RLock)

    def request_json(
        self,
        *,
        method: str,
        url: str,
        headers: Mapping[str, str],
        payload: Any | None,
        timeout: float,
        request_token: str,
        cancel_event: threading.Event | None,
    ) -> tuple[int, Any]:
        if cancel_event and cancel_event.is_set():
            raise JobCancelled("request cancelled before dispatch")
        parsed = urlsplit(url)
        if parsed.scheme == "https":
            conn: http.client.HTTPConnection = http.client.HTTPSConnection(
                parsed.hostname, parsed.port, timeout=timeout
            )
        elif parsed.scheme == "http":
            conn = http.client.HTTPConnection(
                parsed.hostname, parsed.port, timeout=timeout
            )
        else:
            raise CLIProxyError("unsupported CLIProxy URL scheme")

        body = None
        if payload is not None:
            body = json.dumps(
                payload, ensure_ascii=False, separators=(",", ":")
            ).encode("utf-8")
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"
        with self._lock:
            self._active[request_token] = conn
        try:
            conn.request(method, path, body=body, headers=dict(headers))
            response = conn.getresponse()
            raw = response.read()
            if cancel_event and cancel_event.is_set():
                raise JobCancelled("request cancelled")
            if not raw:
                decoded: Any = {}
            else:
                try:
                    decoded = json.loads(raw.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise CLIProxyError(
                        f"CLIProxy returned non-JSON HTTP {response.status}",
                        status=response.status,
                    ) from exc
            return response.status, decoded
        except JobCancelled:
            raise
        except (OSError, socket.timeout, http.client.HTTPException) as exc:
            if cancel_event and cancel_event.is_set():
                raise JobCancelled("request cancelled") from exc
            raise CLIProxyError(
                f"direct CLIProxy request failed: {type(exc).__name__}"
            ) from exc
        finally:
            with self._lock:
                self._active.pop(request_token, None)
            conn.close()

    def cancel(self, request_token: str) -> None:
        with self._lock:
            conn = self._active.get(request_token)
        if conn is not None:
            conn.close()


@dataclass(slots=True)
class CLIProxyClient:
    base_url: str
    api_key: str
    transport: JSONTransport = field(default_factory=HTTPJSONTransport)
    timeout: float = 1200.0
    _job_tokens: dict[str, set[str]] = field(default_factory=dict)
    _response_contexts: dict[str, list[dict[str, Any]]] = field(
        default_factory=dict
    )
    _tokens_lock: threading.RLock = field(default_factory=threading.RLock)

    def __post_init__(self) -> None:
        self.base_url = normalize_base_url(self.base_url)
        if not self.api_key:
            raise ConfigurationError("CLIProxy API key is missing")

    def fetch_models(
        self,
        *,
        job_id: str | None = None,
        cancel_event: threading.Event | None = None,
    ) -> dict[str, Any]:
        payload = self._request(
            "GET",
            "/models",
            payload=None,
            job_id=job_id,
            cancel_event=cancel_event,
        )
        if not isinstance(payload, dict):
            raise CLIProxyError("CLIProxy /models response is not an object")
        return payload

    def create_response(
        self,
        *,
        model_id: str,
        input_value: str | list[dict[str, Any]],
        reasoning_effort: str | None,
        tools: list[dict[str, Any]] | None = None,
        previous_response_id: str | None = None,
        job_id: str | None = None,
        cancel_event: threading.Event | None = None,
        metadata: Mapping[str, str] | None = None,
    ) -> dict[str, Any]:
        model = str(model_id or "").strip()
        if not model:
            raise ConfigurationError("exact CLIProxy model ID is missing")
        if reasoning_effort == "ultra":
            raise ConfigurationError(
                "ultra is never sent as API reasoning effort"
            )
        wire_input: str | list[dict[str, Any]] = input_value
        # CLIProxy's current Anthropic Responses adapter rejects the legal
        # string shorthand before it reaches the model ("messages: at least
        # one message is required"). The equivalent message-shaped Responses
        # input is accepted and keeps the same direct /v1/responses contract.
        if isinstance(input_value, str) and model.startswith("claude-"):
            wire_input = [
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": input_value}],
                }
            ]
        wire_previous_response_id = previous_response_id
        if model.startswith("claude-") and previous_response_id:
            # The current CLIProxy Anthropic adapter does not reconstruct the
            # preceding tool_use from previous_response_id. Replaying the
            # equivalent Responses items keeps the conversation native while
            # giving each tool_result its corresponding tool_use block.
            with self._tokens_lock:
                prior_context = self._response_contexts.get(previous_response_id)
            if prior_context is not None:
                continuation = (
                    list(input_value)
                    if isinstance(input_value, list)
                    else [
                        {
                            "role": "user",
                            "content": [
                                {"type": "input_text", "text": input_value}
                            ],
                        }
                    ]
                )
                wire_input = [dict(item) for item in prior_context] + continuation
                wire_previous_response_id = None
        body: dict[str, Any] = {
            "model": model,
            "input": wire_input,
        }
        if reasoning_effort:
            body["reasoning"] = {"effort": reasoning_effort}
        if tools:
            body["tools"] = tools
        if wire_previous_response_id:
            body["previous_response_id"] = wire_previous_response_id
        if metadata:
            body["metadata"] = dict(metadata)
        payload = self._request(
            "POST",
            "/responses",
            payload=body,
            job_id=job_id,
            cancel_event=cancel_event,
        )
        if not isinstance(payload, dict):
            raise CLIProxyError("CLIProxy /responses response is not an object")
        if model.startswith("claude-"):
            current_id = str(payload.get("id") or "").strip()
            output = payload.get("output")
            if current_id and isinstance(wire_input, list) and isinstance(output, list):
                context = [dict(item) for item in wire_input if isinstance(item, Mapping)]
                context.extend(dict(item) for item in output if isinstance(item, Mapping))
                with self._tokens_lock:
                    self._response_contexts[current_id] = context
                    while len(self._response_contexts) > 64:
                        self._response_contexts.pop(next(iter(self._response_contexts)))
        return payload

    def cancel(self, job_id: str) -> None:
        with self._tokens_lock:
            tokens = tuple(self._job_tokens.get(job_id, ()))
        for token in tokens:
            self.transport.cancel(token)

    def _request(
        self,
        method: str,
        endpoint: str,
        *,
        payload: Any | None,
        job_id: str | None,
        cancel_event: threading.Event | None,
    ) -> Any:
        request_token = f"{job_id or 'direct'}:{uuid4().hex}"
        if job_id:
            with self._tokens_lock:
                self._job_tokens.setdefault(job_id, set()).add(request_token)
        try:
            status, response = self.transport.request_json(
                method=method,
                url=f"{self.base_url}{endpoint}",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                payload=payload,
                timeout=self.timeout,
                request_token=request_token,
                cancel_event=cancel_event,
            )
        finally:
            if job_id:
                with self._tokens_lock:
                    job_tokens = self._job_tokens.get(job_id)
                    if job_tokens is not None:
                        job_tokens.discard(request_token)
                        if not job_tokens:
                            self._job_tokens.pop(job_id, None)
        if status < 200 or status >= 300:
            detail = _safe_error_detail(response)
            raise CLIProxyError(
                f"CLIProxy HTTP {status}: {detail}",
                status=status,
            )
        return response


def response_id(response: Mapping[str, Any]) -> str:
    value = str(response.get("id") or "").strip()
    if not value:
        raise CLIProxyError("Responses result is missing id")
    return value


def response_tool_calls(response: Mapping[str, Any]) -> list[dict[str, Any]]:
    output = response.get("output")
    if not isinstance(output, list):
        return []
    calls: list[dict[str, Any]] = []
    for item in output:
        if not isinstance(item, Mapping) or item.get("type") != "function_call":
            continue
        name = str(item.get("name") or "").strip()
        call_id = str(item.get("call_id") or item.get("id") or "").strip()
        arguments = item.get("arguments")
        if not name or not call_id:
            raise CLIProxyError("Responses function_call is missing name/call_id")
        if isinstance(arguments, str):
            try:
                parsed_args = json.loads(arguments or "{}")
            except json.JSONDecodeError as exc:
                raise CLIProxyError(
                    f"tool {name} returned invalid JSON arguments"
                ) from exc
        elif isinstance(arguments, Mapping):
            parsed_args = dict(arguments)
        elif arguments is None:
            parsed_args = {}
        else:
            raise CLIProxyError(
                f"tool {name} arguments are not a JSON object"
            )
        if not isinstance(parsed_args, dict):
            raise CLIProxyError(
                f"tool {name} arguments are not a JSON object"
            )
        calls.append(
            {"call_id": call_id, "name": name, "arguments": parsed_args}
        )
    return calls


def response_output_text(response: Mapping[str, Any]) -> str:
    direct = response.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    output = response.get("output")
    chunks: list[str] = []
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, Mapping) or item.get("type") != "message":
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if (
                    isinstance(part, Mapping)
                    and part.get("type") in ("output_text", "text")
                    and isinstance(part.get("text"), str)
                ):
                    chunks.append(part["text"])
    return "\n".join(chunks).strip()


def _safe_error_detail(response: Any) -> str:
    if isinstance(response, Mapping):
        error = response.get("error")
        if isinstance(error, Mapping):
            detail = error.get("message") or error.get("type")
            if detail:
                return str(detail)[:500]
        if isinstance(error, str):
            return error[:500]
    return "request rejected"
