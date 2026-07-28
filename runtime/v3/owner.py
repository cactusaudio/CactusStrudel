"""Single-owner lease over one CactusStrudel v3 state root.

RT-OWNER-001: two processes sharing one state root could each run migrations,
recovery, dispatch, and finalization, so a losing launch could mutate the live
owner's jobs before discovering the occupied port. The lease is one local
non-blocking flock plus a monotonic owner epoch and an explicit lifecycle:

    owner_acquired → migrated → recovering → accepting → quiescing → closed

It is deliberately not a cluster coordinator: one lock file, one epoch
counter, and explicit refusal after release are sufficient for a
single-machine product.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
from pathlib import Path
import threading
from typing import Any

from .store import utc_now


LIFECYCLE = (
    "owner_acquired",
    "migrated",
    "recovering",
    "accepting",
    "quiescing",
    "closed",
)

LOCK_NAME = "owner.lock"
META_NAME = "owner.json"


class StateRootBusy(RuntimeError):
    """Another runtime owner currently holds this state root."""


class OwnershipLost(RuntimeError):
    """The lease no longer authorizes the requested state-root operation."""


class OwnerLease:
    """Exclusive runtime ownership of a state root for one process lifetime.

    The flock target (`owner.lock`) is never replaced or unlinked, so the
    lock identity is a stable inode and the OS releases it on any process
    death. `owner.json` is atomic-replace metadata: it persists the monotonic
    epoch across restarts and gives diagnostics a readable holder record.
    """

    def __init__(self, *, state_root: Path, lock_fd: int, epoch: int):
        self.state_root = state_root
        self._lock_fd = lock_fd
        self.epoch = epoch
        self._stage = "owner_acquired"
        self._released = False
        self._state_lock = threading.RLock()

    # ------------------------------------------------------------------
    # Acquisition and release

    @classmethod
    def acquire(cls, state_root: str | os.PathLike[str]) -> "OwnerLease":
        """Non-blocking acquisition; raises StateRootBusy without mutating."""

        root = Path(state_root).expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(root / LOCK_NAME, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            os.close(fd)
            holder = cls._read_meta(root)
            detail = (
                " (epoch {epoch}, pid {pid}, stage {stage})".format(
                    epoch=holder.get("epoch"),
                    pid=holder.get("pid"),
                    stage=holder.get("stage"),
                )
                if holder
                else ""
            )
            raise StateRootBusy(
                f"state root already has a runtime owner: {root}{detail}"
            ) from exc
        try:
            previous = cls._read_meta(root)
            lease = cls(
                state_root=root,
                lock_fd=fd,
                epoch=int(previous.get("epoch") or 0) + 1,
            )
            lease._write_meta()
        except BaseException:
            with contextlib.suppress(OSError):
                fcntl.flock(fd, fcntl.LOCK_UN)
            with contextlib.suppress(OSError):
                os.close(fd)
            raise
        return lease

    def release(self) -> None:
        """Idempotent: mark closed, persist best-effort, drop the flock."""

        with self._state_lock:
            if self._released:
                return
            self._released = True
            self._stage = "closed"
        with contextlib.suppress(OSError):
            self._write_meta()
        with contextlib.suppress(OSError):
            fcntl.flock(self._lock_fd, fcntl.LOCK_UN)
        with contextlib.suppress(OSError):
            os.close(self._lock_fd)

    # ------------------------------------------------------------------
    # Lifecycle and fencing

    @property
    def stage(self) -> str:
        with self._state_lock:
            return self._stage

    @property
    def held(self) -> bool:
        with self._state_lock:
            return not self._released

    def advance(self, stage: str) -> None:
        """Move strictly forward through LIFECYCLE; use release() for closed."""

        if stage not in LIFECYCLE:
            raise ValueError(f"unknown owner lifecycle stage: {stage}")
        if stage == "closed":
            raise ValueError("advance to closed via release()")
        with self._state_lock:
            if self._released:
                raise OwnershipLost(
                    f"cannot advance to {stage}: ownership was released"
                )
            if LIFECYCLE.index(stage) <= LIFECYCLE.index(self._stage):
                raise OwnershipLost(
                    f"owner lifecycle cannot move {self._stage} → {stage}"
                )
            self._stage = stage
        self._write_meta()

    def require(self, action: str, *, new_work: bool = False) -> None:
        """Fence a state-root operation; never fail open.

        Finalization (`new_work=False`) is allowed until release so bounded
        drain can record honest terminal states. New dispatch is additionally
        refused once the owner is quiescing.
        """

        with self._state_lock:
            if self._released or self._stage == "closed":
                raise OwnershipLost(
                    f"{action} refused: state-root ownership was released"
                )
            if new_work and self._stage == "quiescing":
                raise OwnershipLost(
                    f"{action} refused: runtime owner is quiescing"
                )

    # ------------------------------------------------------------------
    # Durable metadata

    def _write_meta(self) -> None:
        body = {
            "schema_version": 1,
            "epoch": self.epoch,
            "pid": os.getpid(),
            "stage": self.stage,
            "state_root": str(self.state_root),
            "updated_at": utc_now(),
        }
        target = self.state_root / META_NAME
        tmp = self.state_root / f".{META_NAME}.tmp.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(body, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, target)
        dir_fd = os.open(self.state_root, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)

    @staticmethod
    def _read_meta(root: Path) -> dict[str, Any]:
        try:
            value = json.loads((root / META_NAME).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return value if isinstance(value, dict) else {}
