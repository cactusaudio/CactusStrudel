"""macOS Keychain-backed API-key references."""

from __future__ import annotations

from dataclasses import dataclass, field
import subprocess
import threading
from typing import Protocol

from .errors import CredentialError


DEFAULT_KEYCHAIN_SERVICE = "com.cactusstrudel.agent.v3"


class CredentialStore(Protocol):
    def set(self, credential_ref: str, value: str) -> None: ...

    def get(self, credential_ref: str) -> str: ...

    def delete(self, credential_ref: str) -> None: ...


@dataclass(slots=True)
class MacOSKeychainStore:
    service: str = DEFAULT_KEYCHAIN_SERVICE
    security_bin: str = "/usr/bin/security"

    def set(self, credential_ref: str, value: str) -> None:
        ref = _validate_ref(credential_ref)
        if not value:
            raise CredentialError("API key cannot be empty")
        try:
            subprocess.run(
                [
                    self.security_bin,
                    "add-generic-password",
                    "-U",
                    "-s",
                    self.service,
                    "-a",
                    ref,
                    "-w",
                    value,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
        except (OSError, subprocess.CalledProcessError) as exc:
            raise CredentialError(
                f"could not save Agent credential in macOS Keychain: "
                f"{_safe_process_error(exc)}"
            ) from exc

    def get(self, credential_ref: str) -> str:
        ref = _validate_ref(credential_ref)
        try:
            result = subprocess.run(
                [
                    self.security_bin,
                    "find-generic-password",
                    "-s",
                    self.service,
                    "-a",
                    ref,
                    "-w",
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except (OSError, subprocess.CalledProcessError) as exc:
            raise CredentialError(
                f"Agent credential is unavailable in macOS Keychain: "
                f"{_safe_process_error(exc)}"
            ) from exc
        value = result.stdout.rstrip("\r\n")
        if not value:
            raise CredentialError("Agent credential is empty in macOS Keychain")
        return value

    def delete(self, credential_ref: str) -> None:
        ref = _validate_ref(credential_ref)
        try:
            subprocess.run(
                [
                    self.security_bin,
                    "delete-generic-password",
                    "-s",
                    self.service,
                    "-a",
                    ref,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            # security(1) returns 44 when the item does not exist. Delete is
            # intentionally idempotent for abandoned drafts.
            if exc.returncode != 44:
                raise CredentialError(
                    "could not delete Agent credential from macOS Keychain: "
                    f"{_safe_process_error(exc)}"
                ) from exc
        except OSError as exc:
            raise CredentialError(
                f"could not invoke macOS Keychain: {_safe_process_error(exc)}"
            ) from exc


@dataclass(slots=True)
class MemoryCredentialStore:
    """Test/integration adapter; production wiring uses MacOSKeychainStore."""

    values: dict[str, str] = field(default_factory=dict)
    _lock: threading.RLock = field(default_factory=threading.RLock)

    def set(self, credential_ref: str, value: str) -> None:
        ref = _validate_ref(credential_ref)
        if not value:
            raise CredentialError("API key cannot be empty")
        with self._lock:
            self.values[ref] = value

    def get(self, credential_ref: str) -> str:
        ref = _validate_ref(credential_ref)
        with self._lock:
            try:
                return self.values[ref]
            except KeyError as exc:
                raise CredentialError(
                    "Agent credential is unavailable"
                ) from exc

    def delete(self, credential_ref: str) -> None:
        ref = _validate_ref(credential_ref)
        with self._lock:
            self.values.pop(ref, None)


def _validate_ref(value: str) -> str:
    ref = str(value or "").strip()
    if not ref:
        raise CredentialError("credential reference is missing")
    if len(ref) > 160 or any(ord(char) < 32 for char in ref):
        raise CredentialError("credential reference is invalid")
    return ref


def _safe_process_error(exc: BaseException) -> str:
    # Never include argv: add-generic-password carries the secret after -w.
    if isinstance(exc, subprocess.CalledProcessError):
        detail = (exc.stderr or "").strip()
        if detail:
            return detail[:300]
        return f"security exited {exc.returncode}"
    return type(exc).__name__
