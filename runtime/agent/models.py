"""Shared value objects for Agent Settings and Brain jobs."""

from __future__ import annotations

from dataclasses import dataclass, replace
from hashlib import sha256
import json
from typing import Any, Mapping

from .errors import ConfigurationError


SCHEMA_VERSION = 3
DEFAULT_BASE_URL = "http://127.0.0.1:8318/v1"
REASONING_EFFORTS = ("low", "medium", "high", "xhigh", "max")
ORCHESTRATIONS = ("standard", "ultra")


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def json_fingerprint(value: Any) -> str:
    return sha256(canonical_json(value).encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class AgentProfile:
    """One explicit direct-CLIProxy profile.

    ``credential_ref`` is a Keychain account/reference, never an API key.
    Drafts may omit the model or credential. Active revisions may not.
    """

    base_url: str = DEFAULT_BASE_URL
    credential_ref: str | None = None
    model_id: str | None = None
    reasoning_effort: str | None = None
    orchestration: str = "standard"

    @classmethod
    def from_dict(cls, value: Mapping[str, Any] | None) -> "AgentProfile":
        data = dict(value or {})
        return cls(
            base_url=str(data.get("base_url") or DEFAULT_BASE_URL),
            credential_ref=_optional_string(data.get("credential_ref")),
            model_id=_optional_string(data.get("model_id")),
            reasoning_effort=_optional_string(data.get("reasoning_effort")),
            orchestration=str(data.get("orchestration") or "standard"),
        )

    def storage_dict(self) -> dict[str, Any]:
        return {
            "base_url": self.base_url,
            "credential_ref": self.credential_ref,
            "model_id": self.model_id,
            "reasoning_effort": self.reasoning_effort,
            "orchestration": self.orchestration,
        }

    def public_dict(self) -> dict[str, Any]:
        return {
            "base_url": self.base_url,
            "has_key": bool(self.credential_ref),
            "model_id": self.model_id,
            "reasoning_effort": self.reasoning_effort,
            "orchestration": self.orchestration,
            "wire_reasoning_effort": self.wire_reasoning_effort,
        }

    @property
    def wire_reasoning_effort(self) -> str | None:
        # Ultra is orchestration performed by this client. It is never sent as
        # an inference effort. Its upstream lead/scout requests use max.
        if self.orchestration == "ultra":
            return "max"
        return self.reasoning_effort

    @property
    def fingerprint(self) -> str:
        return json_fingerprint(
            {"schema_version": SCHEMA_VERSION, "profile": self.storage_dict()}
        )

    def patched(self, patch: Mapping[str, Any]) -> "AgentProfile":
        allowed = {
            "base_url",
            "credential_ref",
            "model_id",
            "reasoning_effort",
            "orchestration",
        }
        unknown = sorted(set(patch) - allowed)
        if unknown:
            raise ConfigurationError(
                f"unknown Agent profile field(s): {', '.join(unknown)}"
            )
        values = {key: patch[key] for key in patch}
        return replace(self, **values)


@dataclass(frozen=True, slots=True)
class ModelCatalogEntry:
    model_id: str
    display_name: str
    owned_by: str | None
    reasoning_efforts: tuple[str, ...]
    default_reasoning_effort: str | None
    ultra_catalog: bool
    ultra_available: bool
    policy_role: str | None = None

    def public_dict(self) -> dict[str, Any]:
        return {
            "id": self.model_id,
            "display_name": self.display_name,
            "owned_by": self.owned_by,
            "reasoning_efforts": list(self.reasoning_efforts),
            "default_reasoning_effort": self.default_reasoning_effort,
            "ultra_catalog": self.ultra_catalog,
            "ultra_available": self.ultra_available,
            "policy_role": self.policy_role,
        }


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
