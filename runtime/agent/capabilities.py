"""Live catalog enrichment without inventing model availability."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from .errors import ConfigurationError
from .models import AgentProfile, ModelCatalogEntry, REASONING_EFFORTS


@dataclass(frozen=True, slots=True)
class _Capability:
    display_name: str
    efforts: tuple[str, ...] = ()
    default_effort: str | None = None
    ultra_catalog: bool = False
    policy_role: str | None = None


# This manifest augments exact IDs returned by authenticated /models. It never
# creates a model row on its own. Unknown live models remain selectable but
# expose no guessed reasoning or Ultra capability.
CAPABILITY_MANIFEST: dict[str, _Capability] = {
    "claude-opus-5": _Capability(
        "Claude Opus 5",
        policy_role="required-anthropic",
    ),
    "grok-4.5": _Capability(
        "Grok 4.5",
        policy_role="default-xai",
    ),
    "gemini-pro-agent": _Capability(
        "Gemini 3.1 Pro (High)",
        policy_role="default-antigravity",
    ),
    "gpt-5.6-sol": _Capability(
        "GPT 5.6 Sol",
        REASONING_EFFORTS,
        "low",
        ultra_catalog=True,
    ),
    "gpt-5.6-terra": _Capability(
        "GPT 5.6 Terra",
        REASONING_EFFORTS,
        "medium",
        ultra_catalog=True,
    ),
    "gpt-5.6-luna": _Capability(
        "GPT 5.6 Luna",
        REASONING_EFFORTS,
        "medium",
        ultra_catalog=False,
    ),
}

RECOMMENDED_BRAIN_MODEL_ID = "claude-opus-5"


def build_catalog(
    payload: Mapping[str, Any],
    *,
    ultra_client_models: Iterable[str] = (),
) -> list[ModelCatalogEntry]:
    rows = payload.get("data")
    if not isinstance(rows, list):
        raise ConfigurationError("CLIProxy /models response is missing data[]")

    ultra_models = frozenset(str(item) for item in ultra_client_models)
    seen: set[str] = set()
    catalog: list[ModelCatalogEntry] = []
    for raw in rows:
        if not isinstance(raw, Mapping):
            continue
        model_id = str(raw.get("id") or "").strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        cap = CAPABILITY_MANIFEST.get(model_id)
        live_display = str(
            raw.get("display_name") or raw.get("name") or model_id
        ).strip()
        display_name = cap.display_name if cap else live_display
        catalog.append(
            ModelCatalogEntry(
                model_id=model_id,
                display_name=display_name,
                owned_by=_optional_string(raw.get("owned_by")),
                reasoning_efforts=cap.efforts if cap else (),
                default_reasoning_effort=cap.default_effort if cap else None,
                ultra_catalog=bool(cap and cap.ultra_catalog),
                ultra_available=bool(
                    cap and cap.ultra_catalog and model_id in ultra_models
                ),
                policy_role=cap.policy_role if cap else None,
            )
        )
    if not catalog:
        raise ConfigurationError("authenticated CLIProxy catalog is empty")
    return catalog


def validate_profile_against_catalog(
    profile: AgentProfile,
    catalog: Iterable[ModelCatalogEntry],
    *,
    require_complete: bool = True,
) -> ModelCatalogEntry | None:
    if profile.orchestration not in ("standard", "ultra"):
        raise ConfigurationError(
            f"unsupported orchestration: {profile.orchestration}"
        )
    if profile.reasoning_effort == "ultra":
        raise ConfigurationError(
            "ultra is client orchestration, never an API reasoning effort"
        )
    if not profile.model_id:
        if require_complete:
            raise ConfigurationError("select an exact model from the live catalog")
        return None

    by_id = {entry.model_id: entry for entry in catalog}
    entry = by_id.get(profile.model_id)
    if entry is None:
        raise ConfigurationError(
            f"selected model is absent from authenticated catalog: {profile.model_id}"
        )
    if (
        profile.model_id.startswith("claude-")
        and profile.model_id != "claude-opus-5"
    ):
        raise ConfigurationError(
            "Anthropic requests must use exact model ID claude-opus-5"
        )

    efforts = entry.reasoning_efforts
    if efforts:
        if profile.reasoning_effort not in efforts:
            supported = ", ".join(efforts)
            raise ConfigurationError(
                f"{entry.model_id} reasoning effort must be one of: {supported}"
            )
    elif profile.reasoning_effort is not None:
        raise ConfigurationError(
            f"reasoning capabilities are unknown for {entry.model_id}; "
            "do not guess an effort"
        )

    if profile.orchestration == "ultra":
        if not entry.ultra_catalog:
            raise ConfigurationError(
                f"the current catalog does not advertise Ultra for {entry.model_id}"
            )
        if not entry.ultra_available:
            raise ConfigurationError(
                f"this Agent client has no active Ultra coordinator for {entry.model_id}"
            )
    return entry


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
