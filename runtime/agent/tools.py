"""Explicit tool workspaces for the Responses Brain runner."""

from __future__ import annotations

from dataclasses import dataclass
import threading
from typing import Any, Callable, Mapping

from .errors import ToolExecutionError, ToolRegistrationError


ToolHandler = Callable[[dict[str, Any], "ToolExecutionContext"], Any]


@dataclass(frozen=True, slots=True)
class ToolExecutionContext:
    job_id: str
    call_id: str
    cancel_event: threading.Event

    def cancellation_requested(self) -> bool:
        return self.cancel_event.is_set()


@dataclass(frozen=True, slots=True)
class ToolSpec:
    name: str
    description: str
    parameters: Mapping[str, Any]
    handler: ToolHandler
    mutating: bool = False

    def responses_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "name": self.name,
            "description": self.description,
            "parameters": dict(self.parameters),
            "strict": True,
        }


class ToolRegistry:
    """One named workspace/toolset.

    The music Brain cannot mutate Agent Settings. A developer toolset is
    separate and must be selected explicitly by the caller.
    """

    def __init__(self, toolset_id: str):
        value = str(toolset_id or "").strip()
        if not value:
            raise ToolRegistrationError("toolset_id is required")
        self.toolset_id = value
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        name = str(spec.name or "").strip()
        if not name:
            raise ToolRegistrationError("tool name is required")
        if name in self._tools:
            raise ToolRegistrationError(f"duplicate tool: {name}")
        if spec.mutating:
            normalized = name.lower().replace("-", "_").replace(".", "_")
            settings_mutations = (
                "update_settings",
                "apply_settings",
                "save_settings",
                "test_settings",
                "configure_settings",
                "set_agent",
                "update_agent",
                "apply_agent",
                "configure_agent",
                "agent_settings",
                "set_brain_model",
                "configure_brain",
            )
            if any(token in normalized for token in settings_mutations):
                raise ToolRegistrationError(
                    "Brain tools may propose, but cannot mutate Agent Settings"
                )
        params = spec.parameters
        if not isinstance(params, Mapping) or params.get("type") != "object":
            raise ToolRegistrationError(
                f"tool {name} parameters must be an object JSON schema"
            )
        self._tools[name] = spec

    def get(self, name: str) -> ToolSpec:
        try:
            return self._tools[name]
        except KeyError as exc:
            raise ToolExecutionError(f"undeclared tool: {name}") from exc

    def schemas(self) -> list[dict[str, Any]]:
        return [spec.responses_schema() for spec in self._tools.values()]

    def names(self) -> tuple[str, ...]:
        return tuple(self._tools)
