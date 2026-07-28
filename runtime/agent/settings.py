"""Agent Settings v3 draft/test/apply state machine."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import threading
import time
from typing import Any
from uuid import uuid4

from .capabilities import (
    RECOMMENDED_BRAIN_MODEL_ID,
    build_catalog,
    validate_profile_against_catalog,
)
from .cliproxy import (
    CLIProxyClient,
    normalize_base_url,
    response_id,
    response_output_text,
    response_tool_calls,
)
from .errors import ApplyError, ConfigurationError, CredentialError
from .keychain import CredentialStore, MacOSKeychainStore
from .models import (
    AgentProfile,
    DEFAULT_BASE_URL,
    SCHEMA_VERSION,
    json_fingerprint,
)


DEFAULT_SETTINGS_ROOT = Path.home() / ".cactus-strudel" / "v3" / "agent"
ClientFactory = Callable[[str, str], CLIProxyClient]
ProtectedCredentialRefs = Callable[[], Iterable[str | None]]


class AgentSettingsStore:
    """Small immutable-revision store.

    It is deliberately separate from the legacy config file. The only
    credential material in these files is an opaque Keychain account name.
    """

    def __init__(self, root: str | os.PathLike[str] = DEFAULT_SETTINGS_ROOT):
        self.root = Path(root)
        self.state_path = self.root / "state.json"
        self.revisions_dir = self.root / "revisions"
        self.tests_dir = self.root / "tests"
        self.catalogs_dir = self.root / "catalogs"
        self._lock = threading.RLock()

    def read_state(self) -> dict[str, Any]:
        with self._lock:
            if not self.state_path.exists():
                return self._default_state()
            value = self._read_json(self.state_path)
            if value.get("schema_version") != SCHEMA_VERSION:
                raise ConfigurationError(
                    "Agent Settings state has an unsupported schema version"
                )
            return value

    def save_draft(self, profile: AgentProfile) -> dict[str, Any]:
        with self._lock:
            state = self.read_state()
            previous = AgentProfile.from_dict(state.get("draft"))
            if previous.fingerprint == profile.fingerprint:
                return copy.deepcopy(state)
            state["draft"] = profile.storage_dict()
            state["draft_updated_at"] = utc_now()
            # A changed draft cannot inherit a prior connection verdict.
            state["last_test_id"] = None
            if _connection_fingerprint(previous) != _connection_fingerprint(
                profile
            ):
                state["last_catalog_id"] = None
            self._atomic_json(self.state_path, state)
            return copy.deepcopy(state)

    def commit_test(self, receipt: Mapping[str, Any]) -> dict[str, Any]:
        """Persist a test and publish it only if the draft stayed unchanged."""

        value = dict(receipt)
        test_id = str(value.get("test_id") or "")
        if not test_id:
            raise ConfigurationError("test receipt is missing test_id")
        expected_fingerprint = str(value.get("fingerprint") or "")
        with self._lock:
            state = self.read_state()
            current_profile = AgentProfile.from_dict(state.get("draft"))
            stale = current_profile.fingerprint != expected_fingerprint
            value["stale"] = stale
            self.write_test(value)
            state["last_test_id"] = None if stale else test_id
            self._atomic_json(self.state_path, state)
        return value

    def write_test(self, receipt: Mapping[str, Any]) -> Path:
        test_id = str(receipt.get("test_id") or "")
        if not test_id:
            raise ConfigurationError("test receipt is missing test_id")
        with self._lock:
            path = self.tests_dir / f"{safe_id(test_id)}.json"
            if path.exists():
                raise ConfigurationError(f"test receipt already exists: {test_id}")
            self._atomic_json(path, dict(receipt))
            return path

    def read_test(self, test_id: str) -> dict[str, Any]:
        path = self.tests_dir / f"{safe_id(test_id)}.json"
        if not path.exists():
            raise ApplyError(f"connection test not found: {test_id}")
        return self._read_json(path)

    def write_catalog(
        self, catalog_id: str, payload: Mapping[str, Any]
    ) -> Path:
        with self._lock:
            path = self.catalogs_dir / f"{safe_id(catalog_id)}.json"
            if path.exists():
                raise ConfigurationError(
                    f"catalog snapshot already exists: {catalog_id}"
                )
            self._atomic_json(path, dict(payload))
            return path

    def commit_catalog(
        self, payload: Mapping[str, Any]
    ) -> dict[str, Any]:
        value = dict(payload)
        catalog_id = str(value.get("catalog_id") or "")
        expected = str(value.get("connection_fingerprint") or "")
        if not catalog_id or not expected:
            raise ConfigurationError(
                "catalog snapshot is missing ID/connection fingerprint"
            )
        with self._lock:
            state = self.read_state()
            current = AgentProfile.from_dict(state.get("draft"))
            stale = _connection_fingerprint(current) != expected
            value["stale"] = stale
            self.write_catalog(catalog_id, value)
            if not stale:
                state["last_catalog_id"] = catalog_id
                self._atomic_json(self.state_path, state)
        return value

    def read_catalog(self, catalog_id: str) -> dict[str, Any]:
        path = self.catalogs_dir / f"{safe_id(catalog_id)}.json"
        if not path.exists():
            raise ConfigurationError(f"catalog snapshot not found: {catalog_id}")
        return self._read_json(path)

    def apply_revision(
        self,
        *,
        profile: AgentProfile,
        test_id: str,
        fingerprint: str,
    ) -> dict[str, Any]:
        with self._lock:
            state = self.read_state()
            current_profile = AgentProfile.from_dict(state.get("draft"))
            if current_profile.fingerprint != fingerprint:
                raise ApplyError("draft changed during Apply; test it again")
            if state.get("last_test_id") != test_id:
                raise ApplyError("connection test is no longer current")
            revision_id = f"agentcfg-{uuid4().hex}"
            revision = {
                "schema_version": SCHEMA_VERSION,
                "revision_id": revision_id,
                "applied_at": utc_now(),
                "test_id": test_id,
                "fingerprint": fingerprint,
                "profile": profile.storage_dict(),
            }
            revision_path = self.revisions_dir / f"{revision_id}.json"
            self._atomic_json(revision_path, revision)

            state["active_revision_id"] = revision_id
            state["active_updated_at"] = utc_now()
            self._atomic_json(self.state_path, state)

            # Readback is part of Apply: an in-memory success is insufficient.
            state_readback = self.read_state()
            revision_readback = self.read_revision(revision_id)
            if (
                state_readback.get("active_revision_id") != revision_id
                or revision_readback.get("fingerprint") != fingerprint
            ):
                raise ApplyError("Agent Settings apply readback failed")
            return revision_readback

    def read_revision(self, revision_id: str) -> dict[str, Any]:
        path = self.revisions_dir / f"{safe_id(revision_id)}.json"
        if not path.exists():
            raise ConfigurationError(
                f"Agent config revision not found: {revision_id}"
            )
        value = self._read_json(path)
        if value.get("schema_version") != SCHEMA_VERSION:
            raise ConfigurationError(
                "Agent config revision has an unsupported schema version"
            )
        return value

    def read_active_revision(self) -> dict[str, Any] | None:
        state = self.read_state()
        revision_id = state.get("active_revision_id")
        if not revision_id:
            return None
        return self.read_revision(str(revision_id))

    def applied_credential_refs(self) -> set[str]:
        """Return every credential pinned by an immutable applied revision."""

        refs: set[str] = set()
        with self._lock:
            if not self.revisions_dir.is_dir():
                return refs
            for path in sorted(self.revisions_dir.glob("*.json")):
                revision = self._read_json(path)
                if revision.get("schema_version") != SCHEMA_VERSION:
                    raise ConfigurationError(
                        "Agent config revision has an unsupported schema version"
                    )
                profile = AgentProfile.from_dict(revision.get("profile"))
                if profile.credential_ref:
                    refs.add(profile.credential_ref)
        return refs

    def _default_state(self) -> dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "active_revision_id": None,
            "active_updated_at": None,
            "draft": AgentProfile(base_url=DEFAULT_BASE_URL).storage_dict(),
            "draft_updated_at": None,
            "last_test_id": None,
            "last_catalog_id": None,
        }

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ConfigurationError(
                f"could not read Agent Settings artifact: {path.name}"
            ) from exc
        if not isinstance(value, dict):
            raise ConfigurationError(
                f"Agent Settings artifact is not an object: {path.name}"
            )
        return value

    def _atomic_json(self, path: Path, value: Mapping[str, Any]) -> None:
        _assert_no_plaintext_secret_fields(value)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        body = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)
        tmp = path.parent / f".{path.name}.tmp.{os.getpid()}.{uuid4().hex}"
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(body)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, path)
            os.chmod(path, 0o600)
            try:
                os.chmod(self.root, 0o700)
            except OSError:
                pass
        finally:
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass


class AgentSettingsService:
    """Canonical service used by the live v3 Settings endpoints."""

    def __init__(
        self,
        *,
        store: AgentSettingsStore | None = None,
        credentials: CredentialStore | None = None,
        client_factory: ClientFactory | None = None,
        ultra_client_models: Iterable[str] = (),
        protected_credential_refs: ProtectedCredentialRefs | None = None,
    ):
        self.store = store or AgentSettingsStore()
        self.credentials = credentials or MacOSKeychainStore()
        self.client_factory = client_factory or (
            lambda base_url, key: CLIProxyClient(base_url, key)
        )
        self.ultra_client_models = frozenset(ultra_client_models)
        self.protected_credential_refs = protected_credential_refs

    def get_state(self) -> dict[str, Any]:
        state = self.store.read_state()
        draft = AgentProfile.from_dict(state.get("draft"))
        active_revision = self.store.read_active_revision()
        last_test = None
        if state.get("last_test_id"):
            last_test = self.store.read_test(str(state["last_test_id"]))
        catalog: list[dict[str, Any]] = []
        if state.get("last_catalog_id"):
            snapshot = self.store.read_catalog(str(state["last_catalog_id"]))
            raw_models = snapshot.get("models")
            if isinstance(raw_models, list):
                catalog = [
                    dict(item) for item in raw_models if isinstance(item, Mapping)
                ]
        active_public = None
        if active_revision:
            active_profile = AgentProfile.from_dict(active_revision["profile"])
            active_public = {
                "revision_id": active_revision["revision_id"],
                "applied_at": active_revision["applied_at"],
                "test_id": active_revision["test_id"],
                "fingerprint": active_revision["fingerprint"],
                "profile": active_profile.public_dict(),
            }
        return {
            "schema_version": SCHEMA_VERSION,
            "recommended_model_id": RECOMMENDED_BRAIN_MODEL_ID,
            "draft": draft.public_dict(),
            "draft_fingerprint": draft.fingerprint,
            "draft_updated_at": state.get("draft_updated_at"),
            "last_test": _public_test(last_test),
            "catalog": catalog,
            "active": active_public,
            "draft_is_active": bool(
                active_revision
                and active_revision.get("fingerprint") == draft.fingerprint
            ),
        }

    def ui_document(self) -> dict[str, Any]:
        """Producer UI contract with internal credential references removed."""

        core = self.get_state()
        active_record = core["active"]
        active_profile = (
            dict(active_record["profile"])
            if active_record
            else AgentProfile().public_dict()
        )
        draft_profile = dict(core["draft"])
        test = core["last_test"]
        ui_test = None
        if test:
            ui_test = {
                "id": test.get("test_id"),
                "ok": test.get("ok"),
                "tested_at": test.get("tested_at"),
                "fingerprint": test.get("fingerprint"),
                "latency_ms": test.get("latency_ms"),
                "model_id": test.get("model_id"),
                "response_excerpt": test.get("output_excerpt"),
                "error": test.get("error"),
                "stages": test.get("stages"),
                "stale": test.get("stale"),
            }
        catalog = [
            {
                "id": item.get("id"),
                "owned_by": item.get("owned_by"),
                "label": item.get("display_name") or item.get("id"),
                "reasoning_efforts": item.get("reasoning_efforts") or [],
                "default_reasoning_effort": item.get(
                    "default_reasoning_effort"
                ),
                "supports_ultra": bool(item.get("ultra_available")),
                "ultra_catalog": bool(item.get("ultra_catalog")),
                "capability_source": (
                    "live+manifest"
                    if (
                        item.get("reasoning_efforts")
                        or item.get("policy_role")
                        or item.get("display_name") != item.get("id")
                    )
                    else "unknown"
                ),
            }
            for item in core["catalog"]
        ]
        active_ui = _ui_profile(active_profile)
        draft_ui = _ui_profile(draft_profile)
        active_credential_available = False
        active_test_valid = False
        if active_record:
            revision = self.store.read_revision(active_record["revision_id"])
            persisted_profile = AgentProfile.from_dict(revision["profile"])
            try:
                self._credential_for(persisted_profile)
                active_credential_available = True
            except CredentialError:
                active_credential_available = False
            try:
                applied_test = self.store.read_test(str(revision["test_id"]))
                active_test_valid = bool(
                    applied_test.get("ok")
                    and applied_test.get("fingerprint")
                    == revision.get("fingerprint")
                )
            except (ApplyError, ConfigurationError):
                active_test_valid = False
        active_ui["key_present"] = active_credential_available
        ready = bool(
            active_record and active_credential_available and active_test_valid
        )
        return {
            "revision_id": active_record.get("revision_id")
            if active_record
            else None,
            "active": active_ui,
            "draft": draft_ui,
            "draft_fingerprint": core["draft_fingerprint"],
            "draft_is_active": core["draft_is_active"],
            "test": ui_test,
            "catalog": catalog,
            "managed_overrides": [],
            "status": {
                "ready": ready,
                "detail": (
                    "Active profile is pinned to a tested immutable revision."
                    if ready
                    else (
                        "Active profile credential is unavailable in Keychain."
                        if active_record and not active_credential_available
                        else (
                            "Active profile test receipt is unavailable or invalid."
                            if active_record
                            else "No tested Agent profile has been applied."
                        )
                    )
                ),
            },
            "recommended_model_id": core["recommended_model_id"],
        }

    def stage_ui_draft(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        """Accept the producer-ui draft shape without trusting internal refs."""

        allowed = {
            "base_url",
            "model_id",
            "reasoning_effort",
            "orchestration",
            "api_key",
            "key_present",
            "credential_ref",
            "wire_reasoning_effort",
        }
        unknown = sorted(set(payload) - allowed)
        if unknown:
            raise ConfigurationError(
                f"unknown Agent draft field(s): {', '.join(unknown)}"
            )
        patch = {
            key: payload[key]
            for key in (
                "base_url",
                "model_id",
                "reasoning_effort",
                "orchestration",
            )
            if key in payload
        }
        transient_key = payload.get("api_key")
        api_key = (
            str(transient_key).strip()
            if transient_key is not None and str(transient_key).strip()
            else None
        )
        return self.update_draft(patch, api_key=api_key)

    def update_draft(
        self,
        patch: Mapping[str, Any],
        *,
        api_key: str | None = None,
    ) -> dict[str, Any]:
        if "api_key" in patch:
            raise ConfigurationError(
                "API keys are accepted only as transient Keychain input"
            )
        if "credential_ref" in patch:
            raise ConfigurationError(
                "credential_ref is internal; submit a transient API key instead"
            )
        state = self.store.read_state()
        profile = AgentProfile.from_dict(state.get("draft"))
        clean_patch = dict(patch)
        if "base_url" in clean_patch:
            clean_patch["base_url"] = normalize_base_url(
                str(clean_patch["base_url"])
            )
        if "model_id" in clean_patch:
            value = clean_patch["model_id"]
            clean_patch["model_id"] = (
                str(value).strip() if value is not None else None
            ) or None
        if "reasoning_effort" in clean_patch:
            value = clean_patch["reasoning_effort"]
            clean_patch["reasoning_effort"] = (
                str(value).strip() if value is not None else None
            ) or None
        if "orchestration" in clean_patch:
            clean_patch["orchestration"] = str(
                clean_patch["orchestration"]
            ).strip()

        pending_credential: tuple[str, str] | None = None
        if api_key is not None:
            if not api_key:
                raise CredentialError("API key cannot be empty")
            credential_ref = f"cactusstrudel-agent-v3-{uuid4().hex}"
            clean_patch["credential_ref"] = credential_ref
            pending_credential = (credential_ref, api_key)
        profile = profile.patched(clean_patch)
        _validate_profile_shape(profile, require_complete=False)
        previous_credential_ref = AgentProfile.from_dict(
            state.get("draft")
        ).credential_ref
        if pending_credential:
            self.credentials.set(*pending_credential)
        try:
            self.store.save_draft(profile)
        except Exception:
            if pending_credential:
                # The new reference has not become durable product truth. Do
                # not leave it behind when the draft transaction fails.
                self.credentials.delete(pending_credential[0])
            raise
        if (
            previous_credential_ref
            and previous_credential_ref != profile.credential_ref
        ):
            self.reclaim_credential_if_unreferenced(previous_credential_ref)
        return self.get_state()

    def clear_draft_key(self) -> dict[str, Any]:
        """Detach the draft credential without touching any active revision."""

        state = self.store.read_state()
        profile = AgentProfile.from_dict(state.get("draft"))
        previous_credential_ref = profile.credential_ref
        profile = profile.patched({"credential_ref": None})
        self.store.save_draft(profile)
        if previous_credential_ref:
            self.reclaim_credential_if_unreferenced(previous_credential_ref)
        return self.get_state()

    def reset_draft(self) -> dict[str, Any]:
        """Restore the active profile, or the empty default, as the draft."""

        state = self.store.read_state()
        previous = AgentProfile.from_dict(state.get("draft"))
        active = self.store.read_active_revision()
        target = (
            AgentProfile.from_dict(active.get("profile"))
            if active
            else AgentProfile()
        )
        self.store.save_draft(target)
        if (
            previous.credential_ref
            and previous.credential_ref != target.credential_ref
        ):
            self.reclaim_credential_if_unreferenced(previous.credential_ref)
        return self.get_state()

    def discover_catalog(self) -> dict[str, Any]:
        profile = self._draft_profile()
        key = self._credential_for(profile)
        client = self.client_factory(profile.base_url, key)
        live = client.fetch_models()
        catalog = build_catalog(
            live, ultra_client_models=self.ultra_client_models
        )
        catalog_id = f"catalog-{uuid4().hex}"
        snapshot = {
            "schema_version": SCHEMA_VERSION,
            "catalog_id": catalog_id,
            "fetched_at": utc_now(),
            "base_url": profile.base_url,
            "connection_fingerprint": _connection_fingerprint(profile),
            "models": [entry.public_dict() for entry in catalog],
        }
        return self.store.commit_catalog(snapshot)

    def test_draft(self) -> dict[str, Any]:
        profile = self._draft_profile()
        test_id = f"agenttest-{uuid4().hex}"
        tested_at = utc_now()
        receipt: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "test_id": test_id,
            "tested_at": tested_at,
            "ok": False,
            "fingerprint": profile.fingerprint,
            "base_url": profile.base_url,
            "model_id": profile.model_id,
            "reasoning_effort": profile.reasoning_effort,
            "orchestration": profile.orchestration,
            "wire_reasoning_effort": profile.wire_reasoning_effort,
            "models_count": 0,
            "catalog_id": None,
            "response_id": None,
            "output_excerpt": None,
            "latency_ms": None,
            "stages": [],
            "stale": False,
            "error": None,
        }
        test_started = time.monotonic()
        current_stage = "configuration"
        stage_started = test_started
        try:
            _validate_profile_shape(profile, require_complete=True)
            key = self._credential_for(profile)
            client = self.client_factory(profile.base_url, key)
            current_stage = "catalog"
            stage_started = time.monotonic()
            live = client.fetch_models()
            catalog = build_catalog(
                live, ultra_client_models=self.ultra_client_models
            )
            validate_profile_against_catalog(profile, catalog)
            receipt["stages"].append(
                {
                    "stage": "catalog",
                    "ok": True,
                    "latency_ms": _elapsed_ms(stage_started),
                    "models_count": len(catalog),
                    "selected_model_present": True,
                }
            )
            catalog_id = f"catalog-{uuid4().hex}"
            catalog_snapshot = {
                "schema_version": SCHEMA_VERSION,
                "catalog_id": catalog_id,
                "fetched_at": utc_now(),
                "base_url": profile.base_url,
                "connection_fingerprint": _connection_fingerprint(profile),
                "models": [entry.public_dict() for entry in catalog],
            }
            self.store.commit_catalog(catalog_snapshot)
            receipt["catalog_id"] = catalog_id
            receipt["models_count"] = len(catalog)

            current_stage = "response"
            probe_schema = {
                "type": "function",
                "name": "agent_probe",
                "description": (
                    "Inert Agent Settings connectivity probe. It reads no "
                    "product data and performs no mutation."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "nonce": {
                            "type": "string",
                            "description": "Return the supplied probe nonce.",
                        }
                    },
                    "required": ["nonce"],
                    "additionalProperties": False,
                },
                "strict": True,
            }
            stage_started = time.monotonic()
            first_response = client.create_response(
                model_id=profile.model_id or "",
                input_value=(
                    "Call agent_probe exactly once with nonce "
                    '"cactusstrudel-v3". After its output, reply exactly: READY'
                ),
                reasoning_effort=profile.wire_reasoning_effort,
                tools=[probe_schema],
                metadata={"purpose": "cactusstrudel-agent-settings-test"},
            )
            calls = response_tool_calls(first_response)
            if len(calls) != 1 or calls[0]["name"] != "agent_probe":
                raise ConfigurationError(
                    "selected model did not call the inert agent_probe tool once"
                )
            if calls[0]["arguments"].get("nonce") != "cactusstrudel-v3":
                raise ConfigurationError(
                    "selected model returned the wrong agent_probe nonce"
                )
            first_response_id = response_id(first_response)
            receipt["stages"].append(
                {
                    "stage": "response",
                    "ok": True,
                    "latency_ms": _elapsed_ms(stage_started),
                    "response_id": first_response_id,
                    "request_model_id": profile.model_id,
                    "wire_reasoning_effort": profile.wire_reasoning_effort,
                    "tool_name": "agent_probe",
                }
            )

            current_stage = "tool_loop"
            stage_started = time.monotonic()
            final_response = client.create_response(
                model_id=profile.model_id or "",
                input_value=[
                    {
                        "type": "function_call_output",
                        "call_id": calls[0]["call_id"],
                        "output": json.dumps(
                            {
                                "ok": True,
                                "nonce": "cactusstrudel-v3",
                                "mutated": False,
                            },
                            separators=(",", ":"),
                        ),
                    }
                ],
                reasoning_effort=profile.wire_reasoning_effort,
                tools=[probe_schema],
                previous_response_id=first_response_id,
                metadata={"purpose": "cactusstrudel-agent-settings-test"},
            )
            output = response_output_text(final_response)
            if output.strip().upper() not in {"READY", "OK"}:
                raise ConfigurationError(
                    "selected model did not complete the inert tool probe with READY"
                )
            final_response_id = response_id(final_response)
            receipt["stages"].append(
                {
                    "stage": "tool_loop",
                    "ok": True,
                    "latency_ms": _elapsed_ms(stage_started),
                    "response_id": final_response_id,
                    "function_call_output_sent": True,
                    "mutated": False,
                }
            )
            receipt["response_id"] = final_response_id
            receipt["output_excerpt"] = output[:120]
            receipt["ok"] = True
        except Exception as exc:
            receipt["error"] = _safe_visible_error(exc)
            receipt["stages"].append(
                {
                    "stage": current_stage,
                    "ok": False,
                    "latency_ms": _elapsed_ms(stage_started),
                    "error": receipt["error"],
                }
            )
        receipt["latency_ms"] = _elapsed_ms(test_started)
        receipt = self.store.commit_test(receipt)
        return _public_test(receipt) or {}

    def apply_draft(self, test_id: str) -> dict[str, Any]:
        state = self.store.read_state()
        profile = AgentProfile.from_dict(state.get("draft"))
        receipt = self.store.read_test(test_id)
        if not receipt.get("ok"):
            raise ApplyError("only a successful connection test can be applied")
        if state.get("last_test_id") != test_id:
            raise ApplyError("the selected connection test is not the current draft test")
        if receipt.get("fingerprint") != profile.fingerprint:
            raise ApplyError("draft changed after Test Connection; test it again")
        _validate_profile_shape(profile, require_complete=True)
        self._credential_for(profile)
        revision = self.store.apply_revision(
            profile=profile,
            test_id=test_id,
            fingerprint=profile.fingerprint,
        )
        return {
            "ok": True,
            "revision_id": revision["revision_id"],
            "active": AgentProfile.from_dict(
                revision["profile"]
            ).public_dict(),
            "test_id": revision["test_id"],
            "fingerprint": revision["fingerprint"],
            "applied_at": revision["applied_at"],
        }

    def load_revision(
        self, revision_id: str
    ) -> tuple[AgentProfile, dict[str, Any]]:
        revision = self.store.read_revision(revision_id)
        profile = AgentProfile.from_dict(revision["profile"])
        _validate_profile_shape(profile, require_complete=True)
        return profile, revision

    def load_active(
        self,
    ) -> tuple[AgentProfile, dict[str, Any]]:
        revision = self.store.read_active_revision()
        if not revision:
            raise ConfigurationError(
                "Agent has no active tested configuration"
            )
        profile = AgentProfile.from_dict(revision["profile"])
        _validate_profile_shape(profile, require_complete=True)
        return profile, revision

    def client_for_revision(
        self, revision_id: str
    ) -> tuple[CLIProxyClient, AgentProfile, dict[str, Any]]:
        profile, revision = self.load_revision(revision_id)
        key = self._credential_for(profile)
        return (
            self.client_factory(profile.base_url, key),
            profile,
            revision,
        )

    def _draft_profile(self) -> AgentProfile:
        state = self.store.read_state()
        return AgentProfile.from_dict(state.get("draft"))

    def _credential_for(self, profile: AgentProfile) -> str:
        if not profile.credential_ref:
            raise CredentialError("CLIProxy API key is not set in Keychain")
        return self.credentials.get(profile.credential_ref)

    def reclaim_credential_if_unreferenced(
        self, credential_ref: str | None
    ) -> bool:
        """Reclaim a credential only after every live owner has released it.

        Callers may invoke this after their own durable config readback. The
        current draft, active Agent revision, and application-provided owners
        are checked again at deletion time.
        """

        ref = str(credential_ref or "").strip()
        if not ref:
            return False
        protected: set[str] = set()

        # A concurrent draft update and every immutable applied revision are
        # live owners. Brain jobs pin revision IDs, so historical revisions
        # must remain executable rather than depending only on today's active
        # pointer. The callback lets the application add other owners.
        current = AgentProfile.from_dict(self.store.read_state().get("draft"))
        if current.credential_ref:
            protected.add(current.credential_ref)
        try:
            protected.update(self.store.applied_credential_refs())
        except Exception:
            # A malformed or temporarily unreadable revision makes ownership
            # uncertain. Preserve the credential instead of guessing.
            return False
        if self.protected_credential_refs is not None:
            try:
                values = self.protected_credential_refs()
                protected.update(
                    str(value).strip()
                    for value in values
                    if value is not None and str(value).strip()
                )
            except Exception:
                # If an external owner cannot be read, preserve the credential
                # rather than guessing that it is abandoned.
                return False
        if ref not in protected:
            self.credentials.delete(ref)
            return True
        return False


def _validate_profile_shape(
    profile: AgentProfile, *, require_complete: bool
) -> None:
    normalized = normalize_base_url(profile.base_url)
    if normalized != profile.base_url:
        raise ConfigurationError("API Base URL is not normalized")
    if profile.orchestration not in ("standard", "ultra"):
        raise ConfigurationError(
            f"unsupported orchestration: {profile.orchestration}"
        )
    if profile.reasoning_effort == "ultra":
        raise ConfigurationError(
            "ultra is never an inference API reasoning effort"
        )
    if require_complete:
        if not profile.credential_ref:
            raise ConfigurationError("CLIProxy API key is not set")
        if not profile.model_id:
            raise ConfigurationError("an exact live model ID must be selected")


def _connection_fingerprint(profile: AgentProfile) -> str:
    return json_fingerprint(
        {
            "base_url": profile.base_url,
            "credential_ref": profile.credential_ref,
        }
    )


def _ui_profile(value: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "base_url": value.get("base_url") or DEFAULT_BASE_URL,
        "key_present": bool(value.get("has_key") or value.get("key_present")),
        "model_id": value.get("model_id") or "",
        "reasoning_effort": value.get("reasoning_effort"),
        "orchestration": value.get("orchestration") or "standard",
        "wire_reasoning_effort": value.get("wire_reasoning_effort"),
    }


def _assert_no_plaintext_secret_fields(value: Any) -> None:
    forbidden = {
        "api_key",
        "authorization",
        "credential_value",
        "secret_value",
        "access_token",
    }

    def walk(item: Any) -> None:
        if isinstance(item, Mapping):
            for key, child in item.items():
                if str(key).lower() in forbidden:
                    raise ConfigurationError(
                        f"plaintext secret field is forbidden in Agent JSON: {key}"
                    )
                walk(child)
        elif isinstance(item, (list, tuple)):
            for child in item:
                walk(child)

    walk(value)


def _public_test(value: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not value:
        return None
    allowed = (
        "test_id",
        "tested_at",
        "ok",
        "fingerprint",
        "base_url",
        "model_id",
        "reasoning_effort",
        "orchestration",
        "wire_reasoning_effort",
        "models_count",
        "catalog_id",
        "response_id",
        "output_excerpt",
        "latency_ms",
        "stages",
        "stale",
        "error",
    )
    return {key: value.get(key) for key in allowed}


def _safe_visible_error(exc: BaseException) -> str:
    text = str(exc).strip() or type(exc).__name__
    # Client/Keychain exceptions intentionally never carry the submitted key.
    return text[:700]


def safe_id(value: str) -> str:
    text = str(value or "")
    if not text or len(text) > 160:
        raise ConfigurationError("artifact ID is invalid")
    if not all(char.isalnum() or char in "-_." for char in text):
        raise ConfigurationError("artifact ID contains invalid characters")
    return text


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _elapsed_ms(started: float) -> int:
    return max(0, round((time.monotonic() - started) * 1000))
