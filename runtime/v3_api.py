"""CactusStrudel v3 application boundary.

This module joins the durable runtime truth, direct CLIProxy Responses client,
Agent Settings, render pipeline, and the Producer UI's `/api/v2` contract.
It deliberately contains no HTTP code so handlers, workers, tests, and CLI
tools all exercise the same state transitions.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import wait as futures_wait
from contextlib import closing
from dataclasses import dataclass
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import subprocess
import tempfile
import threading
import time
from typing import Any, Mapping
import urllib.error
import urllib.request
from uuid import uuid4

from agent.capabilities import build_catalog
from agent.cliproxy import CLIProxyClient, response_id, response_output_text
from agent.errors import JobCancelled
from agent.job_store import BrainJobStore, TERMINAL_STATUSES as BRAIN_TERMINAL_STATUSES
from agent.keychain import MacOSKeychainStore
from agent.models import AgentProfile
from agent.responses_runner import BrainRunnerService
from agent.settings import AgentSettingsService, AgentSettingsStore
from agent.tools import ToolExecutionContext, ToolRegistry, ToolSpec
from agent.ultra import BoundedUltraCoordinator
import prompt_kernel
from v3.owner import OwnerLease, OwnershipLost, StateRootBusy
from v3.service import RuntimeTruth
from v3.store import (
    InvalidTransition,
    NotFound,
    canonical_json,
    stable_id,
    utc_now,
)


_FENCE_RE = re.compile(
    r"```(?:javascript|js|strudel)?\s*\n(?P<code>.*?)```",
    re.IGNORECASE | re.DOTALL,
)
_TERMINAL_BATCH = frozenset(
    {"done", "failed", "cancelled", "cancelled_after_commit", "interrupted"}
)
_DEFAULT_RENDER_WALL_TIMEOUT_SECONDS = 6000.0
_RENDER_POLL_SECONDS = 0.1
_RENDER_TERM_GRACE_SECONDS = 5.0
_BATCH_ABANDON_DRAIN_SECONDS = 300.0
# A full composition from a reasoning model runs far past the transport's
# 120s default; the render wall timeout downstream is already 600s.
_DEFAULT_MODEL_TIMEOUT_SECONDS = 1200.0


class V3Error(RuntimeError):
    """Expected application error safe to show in the local UI."""


class Conflict(V3Error):
    pass


@dataclass(frozen=True, slots=True)
class GenerationProfile:
    profile_id: str
    label: str
    model_id: str
    reasoning_effort: str | None
    orchestration: str = "standard"
    description: str = ""

    def public_dict(self, *, active: bool = False) -> dict[str, Any]:
        return {
            "id": self.profile_id,
            "label": self.label,
            "model_id": self.model_id,
            "reasoning_effort": self.reasoning_effort,
            "orchestration": self.orchestration,
            "description": self.description,
            "active": active,
        }

    def storage_dict(self) -> dict[str, Any]:
        return {
            "id": self.profile_id,
            "label": self.label,
            "model_id": self.model_id,
            "reasoning_effort": self.reasoning_effort,
            "orchestration": self.orchestration,
            "description": self.description,
        }


class GenerationConfigStore:
    """Credential-reference-only generation configuration with immutable history."""

    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser()
        self.revisions_dir = self.path.parent / "generation-revisions"
        self._lock = threading.RLock()

    def read(self) -> dict[str, Any] | None:
        with self._lock:
            if not self.path.is_file():
                return None
            raw = self.path.read_text(encoding="utf-8")
            value = json.loads(raw)
            if not isinstance(value, dict) or value.get("schema_version") != 1:
                raise V3Error("generation configuration schema is invalid")
            if _contains_secret_field(value):
                raise V3Error("generation configuration contains a forbidden secret field")
            revision_id = str(value.get("revision_id") or "")
            if re.fullmatch(r"gencfg-[a-f0-9]{32}", revision_id):
                self.revisions_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
                revision_path = self.revisions_dir / f"{revision_id}.json"
                if not revision_path.exists():
                    self._atomic_write(
                        revision_path,
                        raw if raw.endswith("\n") else raw + "\n",
                        replace=False,
                    )
            return value

    def read_revision(self, revision_id: str) -> dict[str, Any]:
        normalized = str(revision_id or "").strip()
        if not re.fullmatch(r"gencfg-[a-f0-9]{32}", normalized):
            raise V3Error("generation revision ID is invalid")
        path = self.revisions_dir / f"{normalized}.json"
        with self._lock:
            if not path.is_file():
                raise NotFound(f"generation revision not found: {normalized}")
            value = json.loads(path.read_text(encoding="utf-8"))
            if (
                not isinstance(value, dict)
                or value.get("schema_version") != 1
                or value.get("revision_id") != normalized
                or _contains_secret_field(value)
            ):
                raise V3Error("immutable generation revision is invalid")
            return value

    def credential_refs(self) -> tuple[str, ...]:
        refs: set[str] = set()
        current = self.read()
        if current and current.get("credential_ref"):
            refs.add(str(current["credential_ref"]))
        with self._lock:
            if self.revisions_dir.is_dir():
                for path in self.revisions_dir.glob("gencfg-*.json"):
                    try:
                        value = json.loads(path.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        # Ownership is uncertain; callers will preserve on any
                        # callback failure rather than delete a pinned key.
                        raise V3Error(
                            f"generation revision is unreadable: {path.name}"
                        )
                    ref = str(value.get("credential_ref") or "").strip()
                    if ref:
                        refs.add(ref)
        return tuple(sorted(refs))

    def write(
        self,
        *,
        base_url: str,
        credential_ref: str,
        profiles: list[GenerationProfile],
        default_profile_id: str,
        catalog_fetched_at: str | None,
    ) -> dict[str, Any]:
        if default_profile_id not in {profile.profile_id for profile in profiles}:
            raise V3Error("default generation profile is absent")
        body = {
            "schema_version": 1,
            "revision_id": f"gencfg-{uuid4().hex}",
            "updated_at": utc_now(),
            "base_url": base_url,
            "credential_ref": credential_ref,
            "default_profile_id": default_profile_id,
            "catalog_fetched_at": catalog_fetched_at,
            "profiles": [profile.storage_dict() for profile in profiles],
        }
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            text = json.dumps(body, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
            self.revisions_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            revision_path = self.revisions_dir / f"{body['revision_id']}.json"
            self._atomic_write(revision_path, text, replace=False)
            self._atomic_write(self.path, text, replace=True)
        return body

    @staticmethod
    def _atomic_write(path: Path, text: str, *, replace: bool) -> None:
        tmp = path.parent / f".{path.name}.tmp.{os.getpid()}.{uuid4().hex}"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            if not replace and path.exists():
                raise Conflict(f"immutable generation revision already exists: {path.stem}")
            os.replace(tmp, path)
            os.chmod(path, 0o600)
        finally:
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass


class ApiEventLog:
    """Persistent, globally monotonic event cursor consumed by EventSource."""

    def __init__(self, db_path: str | Path, *, owner: OwnerLease | None = None):
        self.db_path = Path(db_path)
        self._owner = owner
        self._lock = threading.RLock()
        with closing(self._connect()) as conn, conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS api_events(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    data_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                ) STRICT
                """
            )

    def append(self, event_type: str, data: Mapping[str, Any]) -> int:
        if self._owner is not None:
            self._owner.require("publish api event")
        with self._lock, closing(self._connect()) as conn, conn:
            cursor = conn.execute(
                """
                INSERT INTO api_events(event_type, data_json, created_at)
                VALUES (?, ?, ?)
                """,
                (event_type, canonical_json(dict(data)), utc_now()),
            )
            return int(cursor.lastrowid)

    def after(self, seq: int, *, limit: int = 500) -> list[dict[str, Any]]:
        with closing(self._connect()) as conn, conn:
            rows = conn.execute(
                """
                SELECT seq, event_type, data_json, created_at
                  FROM api_events
                 WHERE seq > ?
                 ORDER BY seq
                 LIMIT ?
                """,
                (max(0, int(seq)), min(max(1, int(limit)), 1000)),
            ).fetchall()
        return [
            {
                "seq": int(row["seq"]),
                "type": row["event_type"],
                "data": json.loads(row["data_json"]),
                "at": row["created_at"],
            }
            for row in rows
        ]

    def cursor(self) -> int:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT COALESCE(MAX(seq), 0) AS n FROM api_events").fetchone()
        return int(row["n"])

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=150)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 15000")
        return conn


class GenerationRepository:
    """Durable best-of-N aggregate jobs; each shot is a truth-layer child job."""

    def __init__(self, db_path: str | Path, *, owner: OwnerLease | None = None):
        self.db_path = Path(db_path)
        self._owner = owner
        self._lock = threading.RLock()
        with closing(self._connect()) as conn, conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS generation_batches(
                    id TEXT PRIMARY KEY,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    request_sha256 TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN (
                        'queued','running','cancelling','cancelled','failed',
                        'done','cancelled_after_commit','interrupted'
                    )),
                    count INTEGER NOT NULL CHECK(count IN (1,2,4)),
                    prompt TEXT NOT NULL,
                    profile_id TEXT NOT NULL,
                    generation_config_json TEXT NOT NULL DEFAULT '{}',
                    kernel_snapshot_json TEXT NOT NULL DEFAULT '{}',
                    child_job_ids_json TEXT NOT NULL DEFAULT '[]',
                    piece_ids_json TEXT NOT NULL DEFAULT '[]',
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    finished_at TEXT
                ) STRICT
                """
            )
            # Existing v3 databases predate immutable generation-input
            # snapshots. Adding the two JSON columns in place preserves their
            # history while every newly queued batch pins exact inputs.
            self._ensure_column(
                conn,
                "generation_batches",
                "generation_config_json",
                "TEXT NOT NULL DEFAULT '{}'",
            )
            self._ensure_column(
                conn,
                "generation_batches",
                "kernel_snapshot_json",
                "TEXT NOT NULL DEFAULT '{}'",
            )

    def _require_owner(self, action: str, *, new_work: bool = False) -> None:
        if self._owner is not None:
            self._owner.require(action, new_work=new_work)

    def create(
        self,
        *,
        count: int,
        prompt: str,
        profile_id: str,
        idempotency_key: str,
        generation_config: Mapping[str, Any] | None = None,
        kernel_snapshot: Mapping[str, Any] | None = None,
    ) -> tuple[dict[str, Any], bool]:
        self._require_owner("create generation batch", new_work=True)
        if count not in (1, 2, 4):
            raise V3Error("count must be 1, 2, or 4")
        request = {"count": count, "prompt": prompt, "profile_id": profile_id}
        request_sha = sha256(canonical_json(request).encode("utf-8")).hexdigest()
        now = utc_now()
        with self._lock, closing(self._connect()) as conn, conn:
            existing = conn.execute(
                "SELECT * FROM generation_batches WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if existing is not None:
                if existing["request_sha256"] != request_sha:
                    raise Conflict("idempotency key belongs to a different generation request")
                return self._decode(existing), False
            batch_id = f"gen_{uuid4().hex}"
            conn.execute(
                """
                INSERT INTO generation_batches(
                    id,idempotency_key,request_sha256,status,count,prompt,
                    profile_id,generation_config_json,kernel_snapshot_json,
                    created_at,updated_at
                ) VALUES (?,?,?,'queued',?,?,?,?,?,?,?)
                """,
                (
                    batch_id,
                    idempotency_key,
                    request_sha,
                    count,
                    prompt,
                    profile_id,
                    canonical_json(dict(generation_config or {})),
                    canonical_json(dict(kernel_snapshot or {})),
                    now,
                    now,
                ),
            )
        return self.get(batch_id), True

    def get(self, batch_id: str) -> dict[str, Any]:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT * FROM generation_batches WHERE id = ?", (batch_id,)
            ).fetchone()
        if row is None:
            raise NotFound(f"generation job not found: {batch_id}")
        return self._decode(row)

    def get_by_idempotency_key(self, idempotency_key: str) -> dict[str, Any] | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT * FROM generation_batches WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
        return self._decode(row) if row is not None else None

    def list(self, *, limit: int = 100) -> list[dict[str, Any]]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                """
                SELECT * FROM generation_batches
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?
                """,
                (min(max(int(limit), 1), 500),),
            ).fetchall()
        return [self._decode(row) for row in rows]

    def record_child(self, batch_id: str, child_id: str) -> dict[str, Any]:
        """Durably attach one allocated child before allocating the next one."""

        self._require_owner("record generation child")
        normalized = str(child_id).strip()
        if not normalized:
            raise V3Error("generation child job ID cannot be empty")
        now = utc_now()
        with self._lock, closing(self._connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute(
                    "SELECT status, count, child_job_ids_json"
                    "  FROM generation_batches WHERE id=?",
                    (batch_id,),
                ).fetchone()
                if row is None:
                    raise NotFound(f"generation job not found: {batch_id}")
                if row["status"] not in {"queued", "running"}:
                    raise Conflict(
                        "cannot allocate a child for a "
                        f"{row['status']} generation batch"
                    )
                child_ids = list(json.loads(row["child_job_ids_json"]))
                if normalized not in child_ids:
                    if len(child_ids) >= int(row["count"]):
                        raise Conflict(
                            "generation batch already has its full child allocation"
                        )
                    child_ids.append(normalized)
                    conn.execute(
                        """
                        UPDATE generation_batches
                           SET child_job_ids_json=?, updated_at=?
                         WHERE id=?
                        """,
                        (canonical_json(child_ids), now, batch_id),
                    )
                conn.commit()
            except BaseException:
                if conn.in_transaction:
                    conn.rollback()
                raise
        return self.get(batch_id)

    def set_running(self, batch_id: str, child_ids: list[str]) -> dict[str, Any]:
        self._require_owner("start generation batch")
        now = utc_now()
        normalized = [str(child_id).strip() for child_id in child_ids]
        if any(not child_id for child_id in normalized):
            raise V3Error("generation child job ID cannot be empty")
        if len(set(normalized)) != len(normalized):
            raise Conflict("generation batch child IDs must be unique")
        with self._lock, closing(self._connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                current = conn.execute(
                    "SELECT * FROM generation_batches WHERE id=?", (batch_id,)
                ).fetchone()
                if current is None:
                    raise NotFound(f"generation job not found: {batch_id}")
                recorded = list(json.loads(current["child_job_ids_json"]))
                if recorded and recorded != normalized:
                    raise Conflict(
                        "generation child allocation does not match durable state"
                    )
                if len(normalized) != int(current["count"]):
                    raise Conflict(
                        "generation batch must persist every child before starting"
                    )
                if current["status"] == "queued":
                    conn.execute(
                        """
                        UPDATE generation_batches
                           SET status='running', child_job_ids_json=?, updated_at=?
                         WHERE id=?
                        """,
                        (canonical_json(normalized), now, batch_id),
                    )
                elif current["status"] != "running":
                    raise InvalidTransition(
                        f"cannot start generation batch in {current['status']}"
                    )
                conn.commit()
            except BaseException:
                if conn.in_transaction:
                    conn.rollback()
                raise
        return self.get(batch_id)

    def request_cancel(self, batch_id: str) -> dict[str, Any]:
        self._require_owner("request generation batch cancellation")
        now = utc_now()
        with self._lock, closing(self._connect()) as conn, conn:
            row = conn.execute(
                "SELECT status, child_job_ids_json FROM generation_batches"
                " WHERE id=?",
                (batch_id,),
            ).fetchone()
            if row is None:
                raise NotFound(f"generation job not found: {batch_id}")
            if row["status"] == "queued":
                conn.execute(
                    """
                    UPDATE generation_batches
                       SET status='cancelled', updated_at=?, finished_at=?
                     WHERE id=?
                    """,
                    (now, now, batch_id),
                )
                # A queued parent may already have recorded queued children;
                # cancel them in the same transaction so a crash right after
                # this commit cannot strand them behind a terminal parent.
                self._interrupt_dangling_children(
                    conn,
                    self._dedupe_ids(list(json.loads(row["child_job_ids_json"]))),
                    reason="parent generation batch cancelled before start",
                    now=now,
                    terminal_status="cancelled",
                )
            elif row["status"] == "running":
                conn.execute(
                    """
                    UPDATE generation_batches SET status='cancelling', updated_at=?
                     WHERE id=?
                    """,
                    (now, batch_id),
                )
        return self.get(batch_id)

    def finish(
        self,
        batch_id: str,
        *,
        status: str,
        piece_ids: list[str],
        error: str | None = None,
        abandon_running: bool = False,
    ) -> dict[str, Any]:
        self._require_owner("finalize generation batch")
        if status not in _TERMINAL_BATCH:
            raise V3Error(f"invalid generation terminal status: {status}")
        now = utc_now()
        with self._lock, closing(self._connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute(
                    "SELECT * FROM generation_batches WHERE id=?", (batch_id,)
                ).fetchone()
                if row is None:
                    raise NotFound(f"generation job not found: {batch_id}")
                if row["status"] in _TERMINAL_BATCH:
                    conn.commit()
                    return self._decode(row)
                child_ids = self._canonical_child_ids(conn, row)
                # GEN-TERM-001: the parent terminal summary derives only from
                # durable child terminal rows. A live child either drains
                # first or is explicitly abandoned in this same transaction —
                # the parent can never terminalize around it silently.
                dangling = self._dangling_child_ids(conn, child_ids)
                if dangling:
                    if not abandon_running:
                        raise Conflict(
                            "generation batch cannot terminalize while "
                            f"{len(dangling)} child job(s) are still live; "
                            "drain them or abandon explicitly"
                        )
                    self._interrupt_dangling_children(
                        conn,
                        dangling,
                        reason=(
                            "abandoned by generation batch finalization "
                            "after bounded drain"
                        ),
                        now=now,
                    )
                committed, has_truth_schema = self._committed_piece_ids(
                    conn, child_ids
                )
                canonical_pieces = (
                    committed
                    if has_truth_schema
                    else self._dedupe_ids(piece_ids)
                )
                terminal = status
                if row["status"] == "cancelling" or status == "cancelled":
                    terminal = (
                        "cancelled_after_commit"
                        if canonical_pieces
                        else "cancelled"
                    )
                conn.execute(
                    """
                    UPDATE generation_batches
                       SET status=?, child_job_ids_json=?, piece_ids_json=?,
                           error=?, updated_at=?, finished_at=?
                     WHERE id=?
                    """,
                    (
                        terminal,
                        canonical_json(child_ids),
                        canonical_json(canonical_pieces),
                        error,
                        now,
                        now,
                        batch_id,
                    ),
                )
                result = conn.execute(
                    "SELECT * FROM generation_batches WHERE id=?", (batch_id,)
                ).fetchone()
                conn.commit()
            except BaseException:
                if conn.in_transaction:
                    conn.rollback()
                raise
        assert result is not None
        return self._decode(result)

    def recover_interrupted(self) -> list[str]:
        self._require_owner("recover interrupted generation batches")
        now = utc_now()
        with self._lock, closing(self._connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                # A crash between a queued parent's cancellation and its
                # children's cancellation can strand live children behind a
                # terminal parent; sweep them before handling live parents.
                self._interrupt_children_of_terminal_batches(conn, now=now)
                rows = conn.execute(
                    """
                    SELECT * FROM generation_batches
                     WHERE status IN ('queued','running','cancelling')
                     ORDER BY created_at, id
                    """
                ).fetchall()
                ids: list[str] = []
                for row in rows:
                    batch_id = str(row["id"])
                    ids.append(batch_id)
                    child_ids = self._canonical_child_ids(conn, row)
                    piece_ids, _has_truth_schema = self._committed_piece_ids(
                        conn, child_ids
                    )
                    self._interrupt_dangling_children(
                        conn,
                        child_ids,
                        reason="runtime restarted before generation child completion",
                        now=now,
                    )
                    if row["status"] == "cancelling":
                        terminal = (
                            "cancelled_after_commit"
                            if piece_ids
                            else "cancelled"
                        )
                    else:
                        terminal = "interrupted"
                    error = (
                        "runtime restarted before batch completion"
                        if terminal == "interrupted"
                        else None
                    )
                    conn.execute(
                        """
                        UPDATE generation_batches
                           SET status=?, child_job_ids_json=?, piece_ids_json=?,
                               error=?, updated_at=?, finished_at=?
                         WHERE id=?
                        """,
                        (
                            terminal,
                            canonical_json(child_ids),
                            canonical_json(piece_ids),
                            error,
                            now,
                            now,
                            batch_id,
                        ),
                    )
                conn.commit()
            except BaseException:
                if conn.in_transaction:
                    conn.rollback()
                raise
        return ids

    @staticmethod
    def _dedupe_ids(values: list[str]) -> list[str]:
        result: list[str] = []
        for value in values:
            normalized = str(value).strip()
            if normalized and normalized not in result:
                result.append(normalized)
        return result

    def _canonical_child_ids(
        self, conn: sqlite3.Connection, batch_row: sqlite3.Row
    ) -> list[str]:
        recorded = self._dedupe_ids(
            list(json.loads(batch_row["child_job_ids_json"]))
        )
        try:
            rows = conn.execute(
                """
                SELECT id, payload_json, created_at
                  FROM jobs
                 WHERE kind='generation'
                 ORDER BY created_at, id
                """
            ).fetchall()
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc).lower():
                return recorded
            raise
        discovered: list[tuple[int, str, str]] = []
        for child in rows:
            try:
                payload = json.loads(child["payload_json"])
            except (TypeError, json.JSONDecodeError):
                continue
            if str(payload.get("batch_id") or "") != str(batch_row["id"]):
                continue
            shot_index = payload.get("shot_index")
            order = shot_index if isinstance(shot_index, int) else 1_000_000
            discovered.append((order, str(child["created_at"]), str(child["id"])))
        for _order, _created_at, child_id in sorted(discovered):
            if child_id not in recorded:
                recorded.append(child_id)
        return recorded

    @staticmethod
    def _committed_piece_ids(
        conn: sqlite3.Connection, child_ids: list[str]
    ) -> tuple[list[str], bool]:
        try:
            if not child_ids:
                conn.execute("SELECT 1 FROM jobs LIMIT 0")
                conn.execute("SELECT 1 FROM piece_versions LIMIT 0")
                return [], True
            placeholders = ",".join("?" for _ in child_ids)
            rows = conn.execute(
                f"""
                SELECT j.id, j.status, j.result_version_id, v.piece_id
                  FROM jobs AS j
                  LEFT JOIN piece_versions AS v
                    ON v.id=j.result_version_id
                   AND v.created_by_job_id=j.id
                 WHERE j.id IN ({placeholders})
                """,
                tuple(child_ids),
            ).fetchall()
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc).lower():
                return [], False
            raise
        by_child = {
            str(row["id"]): str(row["piece_id"])
            for row in rows
            if row["status"] in {"succeeded", "cancelled_after_commit"}
            and row["result_version_id"]
            and row["piece_id"]
        }
        return (
            list(
                dict.fromkeys(
                    by_child[child_id]
                    for child_id in child_ids
                    if child_id in by_child
                )
            ),
            True,
        )

    def _interrupt_children_of_terminal_batches(
        self, conn: sqlite3.Connection, *, now: str
    ) -> None:
        try:
            live_children = conn.execute(
                """
                SELECT id, payload_json FROM jobs
                 WHERE kind='generation'
                   AND status IN ('queued','running','cancel_requested')
                """
            ).fetchall()
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc).lower():
                return
            raise
        for child in live_children:
            try:
                payload = json.loads(child["payload_json"])
            except (TypeError, json.JSONDecodeError):
                continue
            batch_id = str(payload.get("batch_id") or "")
            if not batch_id:
                continue
            parent = conn.execute(
                "SELECT status FROM generation_batches WHERE id=?",
                (batch_id,),
            ).fetchone()
            if parent is None or parent["status"] not in _TERMINAL_BATCH:
                continue
            self._interrupt_dangling_children(
                conn,
                [str(child["id"])],
                reason=(
                    "parent generation batch was already terminal at restart"
                ),
                now=now,
            )

    @staticmethod
    def _dangling_child_ids(
        conn: sqlite3.Connection, child_ids: list[str]
    ) -> list[str]:
        if not child_ids:
            return []
        try:
            placeholders = ",".join("?" for _ in child_ids)
            rows = conn.execute(
                f"""
                SELECT id FROM jobs
                 WHERE id IN ({placeholders})
                   AND status IN ('queued', 'running', 'cancel_requested')
                """,
                tuple(child_ids),
            ).fetchall()
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc).lower():
                return []
            raise
        return [str(row["id"]) for row in rows]

    @staticmethod
    def _interrupt_dangling_children(
        conn: sqlite3.Connection,
        child_ids: list[str],
        *,
        reason: str,
        now: str,
        terminal_status: str = "interrupted",
    ) -> None:
        if terminal_status not in {"interrupted", "cancelled"}:
            raise V3Error("dangling children may only be interrupted/cancelled")
        if not child_ids:
            return
        try:
            placeholders = ",".join("?" for _ in child_ids)
            rows = conn.execute(
                f"""
                SELECT id, status FROM jobs
                 WHERE id IN ({placeholders})
                """,
                tuple(child_ids),
            ).fetchall()
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc).lower():
                return
            raise
        for row in rows:
            if row["status"] not in {"queued", "running", "cancel_requested"}:
                continue
            conn.execute(
                """
                UPDATE jobs
                   SET status=?, error_json=?,
                       finished_at=?, updated_at=?
                 WHERE id=?
                """,
                (
                    terminal_status,
                    canonical_json({"message": reason}),
                    now,
                    now,
                    row["id"],
                ),
            )
            conn.execute(
                """
                INSERT INTO job_events(job_id,event_type,payload_json,created_at)
                VALUES (?,?,?,?)
                """,
                (
                    row["id"],
                    f"job.{terminal_status}",
                    canonical_json({"message": reason}),
                    now,
                ),
            )

    @staticmethod
    def _decode(row: sqlite3.Row) -> dict[str, Any]:
        value = dict(row)
        value["generation_config"] = json.loads(
            value.pop("generation_config_json", "{}")
        )
        value["kernel_snapshot"] = json.loads(
            value.pop("kernel_snapshot_json", "{}")
        )
        value["child_job_ids"] = json.loads(value.pop("child_job_ids_json"))
        value["piece_ids"] = json.loads(value.pop("piece_ids_json"))
        return value

    @staticmethod
    def _ensure_column(
        conn: sqlite3.Connection,
        table: str,
        column: str,
        declaration: str,
    ) -> None:
        columns = {
            str(row["name"])
            for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if column not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=150)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 15000")
        return conn


class V3Application:
    """Long-lived application object shared by threaded HTTP handlers."""

    def __init__(
        self,
        repo_root: str | Path,
        *,
        state_root: str | Path | None = None,
        max_generation_workers: int = 2,
        owner: OwnerLease | None = None,
    ):
        self.repo_root = Path(repo_root).expanduser().resolve()
        self.state_root = (
            Path(state_root).expanduser().resolve()
            if state_root is not None
            else Path.home() / ".cactus-strudel" / "v3"
        )
        # RT-OWNER-001: exactly one runtime owner per state root. Ownership is
        # acquired before any store/schema/recovery work so a losing launch
        # exits without mutating the live owner's state.
        if owner is None:
            owner = OwnerLease.acquire(self.state_root)
        elif Path(owner.state_root) != self.state_root:
            raise V3Error("owner lease does not cover this state root")
        self.owner = owner
        self.state_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db_path = self.state_root / "runtime.sqlite3"
        self.assets_root = self.repo_root / "producer-brain" / "assets"
        self.truth = RuntimeTruth(
            repo_root=self.repo_root,
            db_path=self.db_path,
            assets_root=self.assets_root,
            owner=self.owner,
        )
        self.events = ApiEventLog(self.db_path, owner=self.owner)
        self.generation_repo = GenerationRepository(self.db_path, owner=self.owner)
        self.credentials = MacOSKeychainStore()
        self.generation_config = GenerationConfigStore(
            self.state_root / "generation.json"
        )
        self.agent_settings = AgentSettingsService(
            store=AgentSettingsStore(self.state_root / "agent"),
            credentials=self.credentials,
            ultra_client_models=("gpt-5.6-sol", "gpt-5.6-terra"),
            protected_credential_refs=self.generation_config.credential_refs,
        )
        self.brain_store = BrainJobStore(self.db_path, owner=self.owner)
        self._generation_pool = ThreadPoolExecutor(
            max_workers=max_generation_workers,
            thread_name_prefix="cactus-generation-v3",
        )
        self._batch_threads: dict[str, threading.Thread] = {}
        self._batch_cancel: dict[str, threading.Event] = {}
        self._generation_clients: dict[str, CLIProxyClient] = {}
        self._brain_monitors: dict[str, threading.Thread] = {}
        self._lock = threading.RLock()
        self.started_at = utc_now()
        self._catalog_cache = self._read_latest_catalog()
        self.brain = self._build_brain()

        self.owner.advance("migrated")
        self.owner.advance("recovering")
        self.truth.recover_after_restart()
        interrupted = self.generation_repo.recover_interrupted()
        brain_recovery = self.brain.recover()
        for job_id in brain_recovery["queued"]:
            self._ensure_brain_monitor(job_id)
        for batch_id in interrupted:
            self._publish("job.updated", self.generation_job(batch_id))
        self.owner.advance("accepting")

    # ------------------------------------------------------------------
    # Doctor (B1): one honest diagnostic pass over runtime + environment

    def doctor(self) -> dict[str, Any]:
        """Read-only health verdicts with a concrete fix per failure."""

        checks: list[dict[str, Any]] = []

        def check(
            check_id: str, ok: bool, detail: str, fix: str | None = None
        ) -> None:
            entry: dict[str, Any] = {
                "id": check_id,
                "ok": bool(ok),
                "detail": detail,
            }
            if fix and not ok:
                entry["fix"] = fix
            checks.append(entry)

        check(
            "owner",
            self.owner.held and self.owner.stage == "accepting",
            f"epoch {self.owner.epoch} · {self.owner.stage}",
            "restart the runtime (launchctl kickstart gui/$UID/com.cactus.strudel)",
        )
        try:
            with closing(sqlite3.connect(self.db_path)) as conn:
                verdict = conn.execute("PRAGMA quick_check").fetchone()[0]
                version = conn.execute(
                    "SELECT COALESCE(MAX(version),0) FROM schema_migrations"
                ).fetchone()[0]
            check(
                "database",
                verdict == "ok",
                f"quick_check={verdict} · schema v{version}",
                "restore the latest backup (bin/cactus restore)",
            )
        except Exception as exc:  # noqa: BLE001 - the failure IS the verdict
            check("database", False, f"unreadable: {exc}", "inspect runtime.sqlite3")
        try:
            reconciliation = self.truth.reconcile_receipts()
            problem_count = sum(
                len(reconciliation[key])
                for key in (
                    "orphan_promoted",
                    "invalid",
                    "registered_receipt_identity_mismatch",
                    "registered_without_valid_receipt",
                    "abandoned_commit_intents",
                    "staging_leftovers",
                )
            )
            check(
                "receipts",
                problem_count == 0,
                f"{len(reconciliation['matched'])} matched · "
                f"{problem_count} problem(s)",
                "bin/v3-reconcile for the itemized report",
            )
        except Exception as exc:  # noqa: BLE001
            check("receipts", False, f"reconciliation failed: {exc}", None)
        try:
            usage = shutil.disk_usage(self.state_root)
            free_gb = usage.free / 1e9
            check(
                "disk",
                free_gb > 2.0,
                f"{free_gb:.1f} GB free at state root",
                "free disk space; renders and backups need headroom",
            )
        except OSError as exc:
            check("disk", False, str(exc), None)
        for binary, fix in (
            ("ffmpeg", "brew install ffmpeg"),
            ("ffprobe", "brew install ffmpeg"),
            ("node", "brew install node"),
            ("pnpm", "corepack enable && corepack prepare pnpm@latest --activate"),
        ):
            path = shutil.which(binary)
            check(
                f"binary:{binary}",
                path is not None,
                path or "not on PATH",
                fix,
            )
        # The renderer prefers the system Chrome channel, then an explicit
        # CACTUS_RENDER_BROWSER_PATH, then Playwright's bundled Chromium —
        # the doctor mirrors that exact fallback order.
        configured_browser = os.environ.get("CACTUS_RENDER_BROWSER_PATH", "").strip()
        system_chrome = Path(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        )
        playwright_cache = Path.home() / "Library" / "Caches" / "ms-playwright"
        bundled_chromium = any(
            entry.name.startswith("chromium")
            for entry in (
                playwright_cache.iterdir() if playwright_cache.is_dir() else []
            )
        )
        if configured_browser:
            browser_ok = Path(configured_browser).is_file()
            browser_detail = f"configured: {configured_browser}"
        elif system_chrome.is_file():
            browser_ok = True
            browser_detail = "system Chrome (renderer's preferred channel)"
        else:
            browser_ok = bundled_chromium
            browser_detail = (
                "bundled Playwright Chromium"
                if bundled_chromium
                else "no Chrome, no bundled Chromium"
            )
        check(
            "render-browser",
            browser_ok,
            browser_detail,
            "install Google Chrome, or "
            "pnpm -C packages/renderer exec playwright install chromium",
        )
        render_worker_deps = (
            self.repo_root / "apps" / "render-worker" / "node_modules"
        ).is_dir() or (self.repo_root / "node_modules").is_dir()
        check(
            "render-worker-deps",
            render_worker_deps,
            "workspace node_modules present"
            if render_worker_deps
            else "node_modules missing",
            "pnpm install --frozen-lockfile",
        )
        config = self.generation_config.read()
        if config:
            base_url = str(config.get("base_url") or "")
            reachable = False
            detail = "no base_url"
            if base_url:
                try:
                    request = urllib.request.Request(
                        f"{base_url.rstrip('/')}/models",
                        headers={"Authorization": "Bearer doctor-probe"},
                    )
                    with urllib.request.urlopen(request, timeout=30):
                        reachable = True
                        detail = f"{base_url} reachable"
                except urllib.error.HTTPError as exc:
                    # 401/403 means the service answered: reachable.
                    reachable = exc.code in {401, 403}
                    detail = f"{base_url} → HTTP {exc.code}"
                except Exception as exc:  # noqa: BLE001
                    detail = f"{base_url} unreachable: {exc}"
            check(
                "cliproxy",
                reachable,
                detail,
                "start CLIProxy on the configured port",
            )
            try:
                self.credentials.get(str(config["credential_ref"]))
                check("generation-credential", True, "Keychain reference resolves")
            except Exception as exc:  # noqa: BLE001
                check(
                    "generation-credential",
                    False,
                    f"Keychain reference failed: {type(exc).__name__}",
                    "re-enter the API key in Agent Settings and re-sync",
                )
        else:
            check(
                "cliproxy",
                False,
                "generation is not configured",
                "run Agent Settings catalog+test, then sync generation",
            )
        agent_document = self.agent_settings.ui_document()
        check(
            "agent",
            bool((agent_document.get("status") or {}).get("ready")),
            str((agent_document.get("status") or {}).get("detail") or ""),
            "Apply a tested Agent profile in Settings",
        )
        backups_dir = self.state_root / "backups"
        newest: float | None = None
        if backups_dir.is_dir():
            stamps = [entry.stat().st_mtime for entry in backups_dir.iterdir()]
            newest = max(stamps) if stamps else None
        if newest is None:
            check("backup", False, "no backup exists", "bin/cactus backup")
        else:
            age_hours = (time.time() - newest) / 3600
            check(
                "backup",
                age_hours < 24 * 7,
                f"latest backup {age_hours:.1f}h old",
                "bin/cactus backup",
            )
        return {
            "ok": all(entry["ok"] for entry in checks),
            "checked_at": utc_now(),
            "checks": checks,
        }

    # ------------------------------------------------------------------
    # Runtime-owner lifecycle

    def begin_quiesce(self) -> None:
        """Refuse new dispatch while in-flight work may still finalize."""

        if not self.owner.held or self.owner.stage == "quiescing":
            return
        self.owner.advance("quiescing")

    def shutdown(self, *, drain_timeout: float = 100.0) -> dict[str, Any]:
        """Bounded owner shutdown: quiesce → cancel → drain → close → release.

        Work that cannot drain inside the deadline stays daemon-threaded; its
        later finalization attempts fail closed against the released lease and
        the next owner's recovery records the honest interrupted state.
        """

        if not self.owner.held:
            return {"drained": True, "epoch": self.owner.epoch}
        deadline = time.monotonic() + max(0.0, float(drain_timeout))
        self.begin_quiesce()

        with self._lock:
            batch_ids = list(self._batch_cancel)
            cancel_events = list(self._batch_cancel.values())
            clients = dict(self._generation_clients)
            batch_threads = dict(self._batch_threads)
        for event in cancel_events:
            event.set()
        for batch_id in batch_ids:
            try:
                self.generation_repo.request_cancel(batch_id)
            except Exception:
                pass
        for child_id, client in clients.items():
            try:
                self.truth.request_cancel(child_id)
            except Exception:
                pass
            try:
                client.cancel(child_id)
            except Exception:
                pass
        try:
            for job in self.brain_store.list_jobs(limit=500):
                if job["status"] in {"queued", "running", "cancel_requested"}:
                    try:
                        self.brain.cancel(job["job_id"])
                    except Exception:
                        pass
        except Exception:
            pass

        drained = True
        for thread in batch_threads.values():
            thread.join(timeout=max(0.0, deadline - time.monotonic()))
            if thread.is_alive():
                drained = False
        if not self.brain.drain(timeout=max(0.0, deadline - time.monotonic())):
            drained = False

        self._generation_pool.shutdown(wait=False, cancel_futures=True)
        self.brain.close(wait=False)
        self.owner.release()
        return {"drained": drained, "epoch": self.owner.epoch}

    # ------------------------------------------------------------------
    # Public snapshots and event stream

    def bootstrap(self) -> dict[str, Any]:
        # Read the cursor first. A concurrent mutation may then appear in both
        # the snapshot and the subsequent stream (safe idempotent upsert), but
        # can never be skipped forever by a cursor newer than the snapshot.
        cursor = self.events.cursor()
        pieces = self.list_pieces(include_archived=True)
        jobs = [self._generation_public(row) for row in self.generation_repo.list()]
        brain_jobs = [self._brain_public(row) for row in self.brain_store.list_jobs()]
        return {
            "pieces": pieces,
            "jobs": jobs,
            "brain_jobs": brain_jobs,
            "activity": self.activity(limit=160),
            "settings": self.settings_public(),
            "cursor": cursor,
            "server_time": utc_now(),
        }

    def health(self) -> dict[str, Any]:
        """Compact liveness/readback without materializing the full UI graph."""

        with closing(sqlite3.connect(self.db_path)) as conn:
            pieces = int(
                conn.execute(
                    "SELECT COUNT(*) FROM pieces WHERE current_version_id IS NOT NULL"
                ).fetchone()[0]
            )
            generation_jobs = int(
                conn.execute("SELECT COUNT(*) FROM generation_batches").fetchone()[0]
            )
            brain_jobs = int(
                conn.execute("SELECT COUNT(*) FROM brain_jobs").fetchone()[0]
            )
        return {
            "ok": True,
            "api_version": "v2",
            "pieces": pieces,
            "generation_jobs": generation_jobs,
            "brain_jobs": brain_jobs,
            "agent_ready": self.agent_settings.store.read_active_revision()
            is not None,
            "cursor": self.events.cursor(),
        }

    def settings_public(self) -> dict[str, Any]:
        return {
            "agent": self.agent_settings_public(),
            "generation": self.generation_settings_public(),
            "system": self.system_settings_public(),
        }

    def events_after(self, cursor: int, *, limit: int = 500) -> list[dict[str, Any]]:
        return self.events.after(cursor, limit=limit)

    def operation_readback(self, idempotency_key: str) -> dict[str, Any]:
        """IDEM-001: exact prior outcome for one idempotency key.

        A restored UI asks here before creating a new durable operation, so a
        browser restart cannot duplicate a generation, preview, Brain job, or
        score whose intent already committed.
        """

        key = str(idempotency_key or "").strip()
        if not key or len(key) > 180:
            raise V3Error("idempotency key is required")
        batch = self.generation_repo.get_by_idempotency_key(key)
        if batch is not None:
            return {
                "found": True,
                "kind": "generation",
                "operation": self._generation_public(batch),
            }
        brain_job = self.brain_store.get_job_by_idempotency_key(key)
        if brain_job is not None:
            return {
                "found": True,
                "kind": "brain",
                "operation": self._brain_public(brain_job),
            }
        truth_job = self.truth.store.get_job_by_idempotency_key(key)
        if truth_job is not None:
            outcome: dict[str, Any] = {
                "job_id": truth_job["id"],
                "kind": truth_job["kind"],
                "status": truth_job["status"],
                "result_version_id": truth_job.get("result_version_id"),
                "error": truth_job.get("error_json"),
            }
            version_id = truth_job.get("result_version_id")
            if version_id:
                try:
                    version = self.truth.store.get_version(str(version_id))
                    outcome["piece_id"] = version["piece_id"]
                except NotFound:
                    pass
            return {"found": True, "kind": "preview", "operation": outcome}
        with self.truth.database.transaction(immediate=False) as conn:
            rating = conn.execute(
                "SELECT * FROM ratings WHERE source_key = ?", (key,)
            ).fetchone()
            if rating is not None:
                return {
                    "found": True,
                    "kind": "score",
                    "operation": {
                        "rating_id": rating["id"],
                        "revision_id": rating["piece_version_id"],
                        "audio_sha": rating["audio_sha256"],
                        "score": float(rating["score"]),
                        "note": rating["note"],
                        "created_at": rating["created_at"],
                    },
                }
        return {"found": False, "kind": None, "operation": None}

    def activity(self, *, limit: int = 200) -> list[dict[str, Any]]:
        cursor = max(0, self.events.cursor() - max(1, limit) * 3)
        rows = self.events.after(cursor, limit=limit * 3)
        activity: list[dict[str, Any]] = []
        for row in reversed(rows):
            if row["type"] == "activity.created":
                item = dict(row["data"])
                item["seq"] = row["seq"]
                activity.append(item)
            elif row["type"] in {"job.updated", "brain.updated"}:
                data = row["data"]
                state = str(data.get("state") or "")
                activity.append(
                    {
                        "seq": row["seq"],
                        "id": f"activity-{row['seq']}",
                        "at": row["at"],
                        "kind": row["type"],
                        "title": f"{data.get('id', 'job')} · {state}",
                        "detail": data.get("stage") or data.get("error"),
                        "status": (
                            "error"
                            if state == "failed"
                            else "warn"
                            if state in {"cancelled", "interrupted"}
                            else "ok"
                            if state in {"done", "cancelled_after_commit"}
                            else "info"
                        ),
                        "job_id": data.get("id"),
                    }
                )
            if len(activity) >= limit:
                break
        return activity

    # ------------------------------------------------------------------
    # Piece/read model

    def asset_request_gate(
        self, file_path: Path
    ) -> tuple[int, dict[str, Any]] | None:
        """Gate static serving of immutable revision assets (DT-003)."""

        return self.truth.asset_request_gate(file_path)

    def list_pieces(self, *, include_archived: bool = False) -> list[dict[str, Any]]:
        rows = self.truth.list_pieces(
            include_archived=include_archived,
            limit=1000,
        )
        result: list[dict[str, Any]] = []
        for row in rows:
            if not row.get("current_version_id"):
                continue
            result.append(self._piece_public(row))
        return result

    def get_piece(self, piece_id: str) -> dict[str, Any]:
        return self._piece_public(self.truth.store.get_piece(piece_id))

    def patch_piece(self, piece_id: str, patch: Mapping[str, Any]) -> dict[str, Any]:
        # This path writes the canonical database directly, so it carries its
        # own owner fence: a daemon handler surviving bounded shutdown must
        # fail closed instead of mutating under a released lease.
        self.owner.require("patch piece")
        allowed = {"archived", "name", "tags"}
        unknown = set(patch) - allowed
        if unknown:
            raise V3Error(f"unknown piece field(s): {', '.join(sorted(unknown))}")
        archived = bool(patch["archived"]) if "archived" in patch else None
        name = None
        if "name" in patch:
            name = str(patch["name"] or "").strip()
            if not name or len(name) > 120:
                raise V3Error("piece name must be 1..120 characters")
        tags = None
        if "tags" in patch:
            raw_tags = patch["tags"]
            if not isinstance(raw_tags, list):
                raise V3Error("tags must be an array")
            tags = list(dict.fromkeys(str(tag).strip() for tag in raw_tags if str(tag).strip()))
            if len(tags) > 50 or any(len(tag) > 80 for tag in tags):
                raise V3Error("piece tags exceed the supported limit")
        if archived is not None or name is not None or tags is not None:
            with self.truth.database.transaction() as conn:
                current = conn.execute(
                    "SELECT id FROM pieces WHERE id=?", (piece_id,)
                ).fetchone()
                if current is None:
                    raise NotFound(f"piece not found: {piece_id}")
                fields = ["updated_at=?"]
                values: list[Any] = [utc_now()]
                if name is not None:
                    fields.append("display_name=?")
                    values.append(name)
                if tags is not None:
                    fields.append("tags_json=?")
                    values.append(canonical_json(tags))
                if archived is not None:
                    fields.append("archived_at=?")
                    values.append(utc_now() if archived else None)
                values.append(piece_id)
                try:
                    conn.execute(
                        f"UPDATE pieces SET {', '.join(fields)} WHERE id=?",
                        values,
                    )
                except sqlite3.IntegrityError as exc:
                    raise Conflict("piece name is already in use") from exc
        piece = self.get_piece(piece_id)
        self._publish("piece.updated", piece)
        return piece

    def score_revision(
        self,
        *,
        piece_id: str,
        revision_id: str,
        audio_sha: str,
        score: float,
        note: str | None,
        source_key: str | None = None,
    ) -> dict[str, Any]:
        value = float(score)
        if not math.isfinite(value) or value < 0 or value > 10:
            raise V3Error("score must be a finite number from 0 to 10")
        version = self.truth.store.get_version(revision_id)
        if version["piece_id"] != piece_id:
            raise Conflict("revision does not belong to piece")
        self.truth.rate(
            piece_version_id=revision_id,
            audio_sha256=str(audio_sha),
            score=value,
            note=str(note).strip() if note is not None else None,
            source_key=source_key,
        )
        piece = self.get_piece(piece_id)
        self._publish("piece.updated", piece)
        return piece

    def promote_revision(self, *, piece_id: str, revision_id: str) -> dict[str, Any]:
        current = self.truth.store.get_piece(piece_id)
        if str(current.get("current_version_id") or "") == revision_id:
            # Idempotent retry: the pointer already names this revision, so a
            # repeated promote must not emit another receipt/publish/activity.
            return {
                "piece": self.get_piece(piece_id),
                "receipt": {
                    "id": f"promote-noop-{revision_id}",
                    "kind": "revision.promote",
                    "status": "already-current",
                    "at": utc_now(),
                    "summary": f"{revision_id} is already the active revision",
                    "details": {"piece_id": piece_id, "revision_id": revision_id},
                },
            }
        self.truth.promote_version(piece_id=piece_id, version_id=revision_id)
        piece = self.get_piece(piece_id)
        receipt = {
            "id": f"promote-{uuid4().hex}",
            "kind": "revision.promote",
            "status": "done",
            "at": utc_now(),
            "summary": f"{revision_id} is now the active immutable revision",
            "details": {"piece_id": piece_id, "revision_id": revision_id},
        }
        self._publish("piece.updated", piece)
        self._activity("Revision promoted", receipt["summary"], "ok", piece_id=piece_id)
        return {"piece": piece, "receipt": receipt}

    # Remaining generation, preview, Agent, and Brain methods are defined
    # below; keeping all mutations behind this object preserves one truth path.

    # ------------------------------------------------------------------
    # Generation configuration + durable best-of-N jobs

    def configure_generation_from_catalog(
        self,
        *,
        base_url: str,
        credential_ref: str,
        catalog_snapshot: Mapping[str, Any],
    ) -> dict[str, Any]:
        live_ids = {
            str(row.get("id"))
            for row in catalog_snapshot.get("models", [])
            if isinstance(row, Mapping) and row.get("id")
        }
        definitions = (
            GenerationProfile(
                "gemini-pro",
                "Gemini Pro Producer",
                "gemini-pro-agent",
                None,
                description="Validated CactusStrudel direction; unconstrained first shot.",
            ),
            GenerationProfile(
                "terra-balanced",
                "Terra Balanced",
                "gpt-5.6-terra",
                "medium",
                description="Balanced alternative with explicit medium reasoning.",
            ),
            GenerationProfile(
                "sol-max",
                "Sol Max",
                "gpt-5.6-sol",
                "max",
                description="Highest upstream effort for a deliberate independent take.",
            ),
            GenerationProfile(
                "grok-creative",
                "Grok 4.5",
                "grok-4.5",
                None,
                description="Alternative creative prior; no guessed effort.",
            ),
            GenerationProfile(
                "opus-producer",
                "Claude Opus 5",
                "claude-opus-5",
                None,
                description="Exact Anthropic route; no guessed effort.",
            ),
        )
        profiles = [profile for profile in definitions if profile.model_id in live_ids]
        if not profiles:
            raise V3Error("no supported generation profile exists in the authenticated catalog")
        available_ids = {profile.profile_id for profile in profiles}
        previous = self.generation_config.read()
        previous_default = str(
            (previous or {}).get("default_profile_id") or ""
        )
        default_id = (
            previous_default
            if previous_default in available_ids
            else (
                "gemini-pro"
                if "gemini-pro" in available_ids
                else profiles[0].profile_id
            )
        )
        catalog_fetched_at = (
            str(catalog_snapshot.get("fetched_at") or "") or None
        )
        desired_stable = {
            "base_url": base_url,
            "credential_ref": credential_ref,
            "profiles": [profile.storage_dict() for profile in profiles],
            "default_profile_id": default_id,
            "catalog_fetched_at": catalog_fetched_at,
        }
        if previous:
            current_stable = {
                key: previous.get(key)
                for key in (
                    "base_url",
                    "credential_ref",
                    "profiles",
                    "default_profile_id",
                    "catalog_fetched_at",
                )
            }
            if canonical_json(current_stable) == canonical_json(desired_stable):
                return self.generation_settings_public()
        config = self.generation_config.write(
            base_url=base_url,
            credential_ref=credential_ref,
            profiles=profiles,
            default_profile_id=default_id,
            catalog_fetched_at=catalog_fetched_at,
        )
        persisted = self.generation_config.read()
        document = self.generation_settings_public()
        if (
            not persisted
            or persisted.get("revision_id") != config["revision_id"]
            or persisted.get("credential_ref") != credential_ref
            or document.get("revision_id") != config["revision_id"]
            or document.get("default_profile_id") != default_id
        ):
            raise V3Error("generation settings readback did not match the committed revision")
        return document

    def sync_generation_from_agent_test(self, test_id: str) -> dict[str, Any]:
        """Publish generation profiles from the current tested Agent draft.

        This deliberately reads the draft/test/catalog artifacts and never
        activates the Agent profile. Generation and Brain remain separate
        explicit controls even when they share a direct CLIProxy credential.
        """

        selected_test_id = str(test_id or "")
        if not selected_test_id:
            raise V3Error("test_id is required")
        state = self.agent_settings.store.read_state()
        if state.get("last_test_id") != selected_test_id:
            raise V3Error(
                "generation sync requires the current Agent draft connection test"
            )
        receipt = self.agent_settings.store.read_test(selected_test_id)
        draft = AgentProfile.from_dict(state.get("draft"))
        if (
            not receipt.get("ok")
            or receipt.get("stale")
            or receipt.get("fingerprint") != draft.fingerprint
        ):
            raise V3Error(
                "generation sync requires a passing test for the unchanged Agent draft"
            )
        catalog_id = str(receipt.get("catalog_id") or "")
        if not catalog_id or state.get("last_catalog_id") != catalog_id:
            raise V3Error(
                "generation sync requires the authenticated catalog from that test"
            )
        catalog = self.agent_settings.store.read_catalog(catalog_id)
        if (
            catalog.get("stale")
            or catalog.get("catalog_id") != catalog_id
            or catalog.get("base_url") != draft.base_url
        ):
            raise V3Error(
                "generation sync catalog no longer matches the tested Agent connection"
            )
        if not draft.credential_ref:
            raise V3Error("tested Agent draft has no credential reference")
        # Resolve once so a stale Keychain reference cannot become a generation
        # configuration that only fails later when a job starts.
        self.agent_settings._credential_for(draft)
        previous = self.generation_config.read()
        document = self.configure_generation_from_catalog(
            base_url=draft.base_url,
            credential_ref=draft.credential_ref,
            catalog_snapshot=catalog,
        )
        if (previous or {}).get("revision_id") != document.get("revision_id"):
            self._publish("settings.updated", {"generation": document})
            self._activity(
                "Generation profiles synced",
                (
                    f"{len(document['profiles'])} authenticated profiles · "
                    f"{document['revision_id']}"
                ),
                "ok",
            )
        return document

    def set_generation_default(self, profile_id: str) -> dict[str, Any]:
        selected = str(profile_id or "")
        if not selected:
            raise V3Error("profile_id is required")
        config = self.generation_config.read()
        if not config:
            raise V3Error("generation connection is not configured")
        profile = self._profile_from_config(config, selected)
        if config.get("default_profile_id") == selected:
            return self.generation_settings_public()
        profiles = [
            self._profile_from_config(config, str(row.get("id") or ""))
            for row in config.get("profiles", [])
            if isinstance(row, Mapping)
        ]
        written = self.generation_config.write(
            base_url=str(config["base_url"]),
            credential_ref=str(config["credential_ref"]),
            profiles=profiles,
            default_profile_id=selected,
            catalog_fetched_at=(
                str(config.get("catalog_fetched_at"))
                if config.get("catalog_fetched_at")
                else None
            ),
        )
        document = self.generation_settings_public()
        if (
            document.get("revision_id") != written["revision_id"]
            or document.get("default_profile_id") != selected
        ):
            raise V3Error("generation default readback did not match the committed revision")
        self._publish("settings.updated", {"generation": document})
        self._activity(
            "Generation default changed",
            f"{profile.label} · {written['revision_id']}",
            "ok",
        )
        return document

    def generation_settings_public(self) -> dict[str, Any]:
        compiled = prompt_kernel.compile(mode="responses")
        config = self.generation_config.read()
        if not config:
            return {
                "configured": False,
                "revision_id": None,
                "updated_at": None,
                "base_url": None,
                "catalog_fetched_at": None,
                "profiles": [],
                "default_profile_id": None,
                "validator_mode": "deterministic",
                "kernel_hash": compiled["hash"],
                "kernel_fragments": compiled["fragments_used"],
            }
        default_id = config["default_profile_id"]
        profiles = [
            GenerationProfile(
                profile_id=str(row["id"]),
                label=str(row["label"]),
                model_id=str(row["model_id"]),
                reasoning_effort=row.get("reasoning_effort"),
                orchestration=str(row.get("orchestration") or "standard"),
                description=str(row.get("description") or ""),
            ).public_dict(active=str(row["id"]) == default_id)
            for row in config.get("profiles", [])
        ]
        return {
            "configured": True,
            "revision_id": config["revision_id"],
            "updated_at": config["updated_at"],
            "base_url": config["base_url"],
            "catalog_fetched_at": config.get("catalog_fetched_at"),
            "profiles": profiles,
            "default_profile_id": default_id,
            "validator_mode": "deterministic",
            "kernel_hash": compiled["hash"],
            "kernel_fragments": compiled["fragments_used"],
        }

    def create_generation_job(
        self,
        *,
        count: int,
        prompt: str,
        profile_id: str | None,
        idempotency_key: str,
    ) -> dict[str, Any]:
        config = self.generation_config.read()
        if not config:
            raise V3Error("generation connection is not configured")
        selected = str(profile_id or config.get("default_profile_id") or "")
        self._profile_from_config(config, selected)
        kernel = prompt_kernel.compile(mode="responses")
        kernel_snapshot = {
            "text": str(kernel["text"]),
            "hash": str(kernel["hash"]),
            "fragments_used": list(kernel["fragments_used"]),
            "mode": str(kernel.get("mode") or "responses"),
        }
        batch, created = self.generation_repo.create(
            count=int(count),
            prompt=str(prompt or "").strip(),
            profile_id=selected,
            idempotency_key=idempotency_key,
            generation_config=config,
            kernel_snapshot=kernel_snapshot,
        )
        if created:
            cancel_event = threading.Event()
            thread = threading.Thread(
                target=self._run_generation_batch,
                args=(
                    batch["id"],
                    dict(batch["generation_config"]),
                    dict(batch["kernel_snapshot"]),
                    cancel_event,
                ),
                daemon=True,
                name=f"cactus-batch-{batch['id'][-8:]}",
            )
            with self._lock:
                self._batch_cancel[batch["id"]] = cancel_event
                self._batch_threads[batch["id"]] = thread
            thread.start()
            self._activity(
                "Generation queued",
                f"{batch['count']} independent first-shot job(s)",
                "info",
                job_id=batch["id"],
            )
        public = self.generation_job(batch["id"])
        self._publish("job.updated", public)
        return public

    def generation_job(self, batch_id: str) -> dict[str, Any]:
        return self._generation_public(self.generation_repo.get(batch_id))

    def cancel_generation(self, batch_id: str) -> dict[str, Any]:
        batch = self.generation_repo.request_cancel(batch_id)
        with self._lock:
            event = self._batch_cancel.get(batch_id)
            clients = [
                self._generation_clients.get(child_id)
                for child_id in batch["child_job_ids"]
            ]
        if event is not None:
            event.set()
        for child_id, client in zip(batch["child_job_ids"], clients):
            try:
                self.truth.request_cancel(child_id)
            except (NotFound, InvalidTransition):
                pass
            if client is not None:
                client.cancel(child_id)
        public = self.generation_job(batch_id)
        self._publish("job.updated", public)
        return public

    def _run_generation_batch(
        self,
        batch_id: str,
        config: dict[str, Any],
        kernel: dict[str, Any],
        cancel_event: threading.Event,
    ) -> None:
        child_ids: list[str] = []
        future_to_child: dict[Any, str] = {}
        try:
            batch = self.generation_repo.get(batch_id)
            if batch["status"] == "cancelled":
                return
            profile = self._profile_from_config(config, batch["profile_id"])
            for index in range(batch["count"]):
                child, _ = self.truth.create_job(
                    kind="generation",
                    payload={
                        "batch_id": batch_id,
                        "shot_index": index,
                        "prompt": batch["prompt"],
                        "profile": profile.storage_dict(),
                        "generation_config_revision_id": config["revision_id"],
                        "kernel": {
                            "hash": kernel["hash"],
                            "text": kernel["text"],
                            "fragments_used": kernel["fragments_used"],
                        },
                    },
                    idempotency_key=f"{batch_id}:shot:{index}",
                )
                child_ids.append(child["id"])
                self.generation_repo.record_child(batch_id, child["id"])
            self.generation_repo.set_running(batch_id, child_ids)
            self._publish("job.updated", self.generation_job(batch_id))

            future_to_child = {
                self._generation_pool.submit(
                    self._run_generation_shot,
                    batch_id=batch_id,
                    child_job_id=child_id,
                    shot_index=index,
                    prompt=batch["prompt"],
                    profile=profile,
                    config=config,
                    kernel=kernel,
                    cancel_event=cancel_event,
                ): child_id
                for index, child_id in enumerate(child_ids)
            }
            piece_ids: list[str] = []
            errors: list[str] = []
            for future in as_completed(future_to_child):
                child_id = future_to_child[future]
                try:
                    result = future.result()
                    if result.get("piece_id"):
                        piece_ids.append(str(result["piece_id"]))
                except Exception as exc:
                    errors.append(f"{child_id}: {str(exc) or type(exc).__name__}")
                self._publish("job.updated", self.generation_job(batch_id))

            if cancel_event.is_set():
                terminal = "cancelled_after_commit" if piece_ids else "cancelled"
            elif errors:
                terminal = "failed"
            else:
                terminal = "done"
            finished = self.generation_repo.finish(
                batch_id,
                status=terminal,
                piece_ids=piece_ids,
                error="; ".join(errors)[:1600] if errors else None,
            )
            for piece_id in finished["piece_ids"]:
                self._publish("piece.created", self.get_piece(piece_id))
            self._publish("job.updated", self.generation_job(batch_id))
        except Exception as exc:
            was_cancelled = cancel_event.is_set()
            cancel_event.set()
            for child_id in child_ids:
                try:
                    self.truth.request_cancel(child_id)
                except (NotFound, InvalidTransition):
                    pass
            # GEN-TERM-001: drain allocated shots for a bounded interval so
            # the terminal summary reflects durable child truth; anything
            # still live afterwards is explicitly abandoned in the same
            # finalization transaction, never terminalized around silently.
            if future_to_child:
                futures_wait(
                    list(future_to_child),
                    timeout=_BATCH_ABANDON_DRAIN_SECONDS,
                )
            finished: dict[str, Any] | None = None
            try:
                finished = self.generation_repo.finish(
                    batch_id,
                    status="cancelled" if was_cancelled else "failed",
                    piece_ids=[],
                    error=(str(exc) or type(exc).__name__)[:1600],
                    abandon_running=True,
                )
            except Exception:
                pass
            for piece_id in (finished or {}).get("piece_ids", []):
                try:
                    self._publish("piece.created", self.get_piece(piece_id))
                except Exception:
                    pass
            self._publish("job.updated", self.generation_job(batch_id))
        finally:
            with self._lock:
                self._batch_cancel.pop(batch_id, None)
                self._batch_threads.pop(batch_id, None)

    def _run_generation_shot(
        self,
        *,
        batch_id: str,
        child_job_id: str,
        shot_index: int,
        prompt: str,
        profile: GenerationProfile,
        config: Mapping[str, Any],
        kernel: Mapping[str, Any],
        cancel_event: threading.Event,
    ) -> dict[str, Any]:
        worker_id = (
            f"generation-worker-{threading.get_ident()}@e{self.owner.epoch}"
        )
        self.truth.start_job(child_job_id, worker_id=worker_id)
        started = utc_now()
        client: CLIProxyClient | None = None
        try:
            key = self.credentials.get(str(config["credential_ref"]))
            client = CLIProxyClient(
                str(config["base_url"]),
                key,
                timeout=self._model_timeout_seconds(),
            )
            with self._lock:
                self._generation_clients[child_job_id] = client
            if cancel_event.is_set():
                self.truth.request_cancel(child_job_id)
                self.truth.finish_cancel(child_job_id)
                raise JobCancelled("generation cancelled before model request")
            producer_brief = prompt.strip() or (
                "Compose an original complete piece. Make the musical decisions yourself."
            )
            compiled_prompt = (
                f"{kernel['text'].rstrip()}\n\n---\n\n"
                "HUMAN PRODUCER BRIEF\n"
                f"{producer_brief}\n\n"
                "This is vision, not recipe. The musical decisions are entirely yours.\n"
            )
            request_started = time.monotonic()
            response = client.create_response(
                model_id=profile.model_id,
                input_value=compiled_prompt,
                reasoning_effort=profile.reasoning_effort,
                tools=None,
                job_id=child_job_id,
                cancel_event=cancel_event,
                metadata={
                    "cactus_job_id": child_job_id,
                    "batch_id": batch_id,
                    "shot_index": str(shot_index),
                    "purpose": "strudel-first-shot",
                },
            )
            response_latency_ms = round(
                (time.monotonic() - request_started) * 1000
            )
            response_text = response_output_text(response)
            code = self._extract_code(response_text)
            code_sha = sha256(code.encode("utf-8")).hexdigest()
            # Preserve the exact model boundary before deterministic
            # validation or rendering can fail. Successful generations also
            # get an immutable asset receipt; failed attempts must remain
            # diagnosable instead of losing the only copy of their output.
            self.truth.store.append_job_event(
                child_job_id,
                "model.response_captured",
                {
                    "response_id": response_id(response),
                    "response_text": response_text,
                    "response_text_sha256": sha256(
                        response_text.encode("utf-8")
                    ).hexdigest(),
                    "extracted_code": code,
                    "code_sha256": code_sha,
                    "compiled_prompt": compiled_prompt,
                    "prompt_sha256": sha256(
                        compiled_prompt.encode("utf-8")
                    ).hexdigest(),
                    "kernel_hash": kernel["hash"],
                    "generation_config_revision_id": config["revision_id"],
                    "model_id": profile.model_id,
                    "reasoning_effort": profile.reasoning_effort,
                    "orchestration": profile.orchestration,
                    "latency_ms": response_latency_ms,
                },
            )
            self._validate_code(code)
            if cancel_event.is_set():
                self.truth.request_cancel(child_job_id)
                self.truth.finish_cancel(child_job_id)
                raise JobCancelled("generation cancelled before render")

            identity = self.truth.allocate_render_identity()
            display_name = time.strftime("CS-%Y%m%d-%H%M%S") + f"-{child_job_id[-6:]}"
            work_dir, audio_path, features = self._render_code_with_retry(
                code,
                job_id=child_job_id,
                cancel_event=cancel_event,
            )
            try:
                prompt_receipt = {
                    "schema_version": 1,
                    "mode": "responses",
                    "compiled_prompt": compiled_prompt,
                    "producer_brief": producer_brief,
                    "kernel": {
                        "hash": kernel["hash"],
                        "fragments_used": kernel["fragments_used"],
                    },
                    "model": {
                        "id": profile.model_id,
                        "reasoning_effort": profile.reasoning_effort,
                        "orchestration": profile.orchestration,
                    },
                }
                provenance = {
                    "provider_route": f"{config['base_url']}/responses",
                    "route": f"{config['base_url']}/responses",
                    "model_id": profile.model_id,
                    "reasoning_effort": profile.reasoning_effort,
                    "orchestration": profile.orchestration,
                    "kernel_hash": kernel["hash"],
                    "validator_mode": "deterministic",
                    "repair_applied": False,
                    "job_id": child_job_id,
                    "generation_config_revision_id": config["revision_id"],
                    "original_code_sha256": code_sha,
                    "rendered_code_sha256": code_sha,
                }
                staged = self.truth.stage_render(
                    job_id=child_job_id,
                    piece_id=identity["piece_id"],
                    version_id=identity["version_id"],
                    code=code,
                    audio_path=audio_path,
                    prompt=prompt_receipt,
                    features=features,
                )
                finished = utc_now()
                committed = self.truth.commit_rendered_version(
                    staged=staged,
                    display_name=display_name,
                    provenance=provenance,
                    model_run={
                        "provider_route": f"{config['base_url']}/responses",
                        "model_id": profile.model_id,
                        "reasoning_effort": profile.reasoning_effort,
                        "orchestration": profile.orchestration,
                        "kernel_hash": kernel["hash"],
                        "validator_mode": "deterministic",
                        "request_receipt": {
                            "prompt_sha256": sha256(
                                compiled_prompt.encode("utf-8")
                            ).hexdigest(),
                            "prompt_chars": len(compiled_prompt),
                            "generation_config_revision_id": config["revision_id"],
                        },
                        "response_receipt": {
                            "response_id": response_id(response),
                            "response_text_sha256": sha256(
                                response_text.encode("utf-8")
                            ).hexdigest(),
                            "code_sha256": code_sha,
                            "latency_ms": response_latency_ms,
                        },
                        "started_at": started,
                        "finished_at": finished,
                    },
                    piece_fields={
                        "collection": "active",
                        "provenance_class": "native",
                    },
                    version_fields={"kind": "original", "state": "ready"},
                )
                if committed["version"] is None:
                    raise JobCancelled("cancelled before immutable asset commit")
                return {
                    "piece_id": identity["piece_id"],
                    "version_id": identity["version_id"],
                }
            finally:
                shutil.rmtree(work_dir, ignore_errors=True)
        except JobCancelled:
            self._finish_child_cancel(child_job_id)
            raise
        except Exception as exc:
            try:
                current = self.truth.get_job(child_job_id)
                if current["status"] not in {
                    "failed",
                    "cancelled",
                    "cancelled_after_commit",
                    "succeeded",
                }:
                    self.truth.store.finish_job(
                        child_job_id,
                        status="failed",
                        error={"message": (str(exc) or type(exc).__name__)[:1000]},
                    )
            except Exception:
                pass
            raise
        finally:
            with self._lock:
                self._generation_clients.pop(child_job_id, None)

    def _finish_child_cancel(self, child_job_id: str) -> None:
        try:
            current = self.truth.get_job(child_job_id)
            if current["status"] == "running":
                self.truth.request_cancel(child_job_id)
                current = self.truth.get_job(child_job_id)
            if current["status"] == "cancel_requested":
                self.truth.finish_cancel(child_job_id)
        except (NotFound, InvalidTransition):
            pass

    # ------------------------------------------------------------------
    # Manual preview is immutable but does not change the active pointer.

    def create_preview(
        self,
        *,
        piece_id: str,
        source_revision_id: str,
        code: str,
        intent: str | None,
        idempotency_key: str,
        cancel_event: threading.Event | None = None,
    ) -> dict[str, Any]:
        event = cancel_event or threading.Event()
        piece = self.truth.store.get_piece(piece_id)
        source = self.truth.store.get_version(source_revision_id)
        if source["piece_id"] != piece_id:
            raise Conflict("source revision does not belong to piece")
        source_verdict = self.truth.revision_usability(source, action="play")
        if not source_verdict.usable:
            raise Conflict(
                "preview source revision is not usable: "
                f"{source_verdict.reason}"
            )
        job, _ = self.truth.create_job(
            kind="render-preview",
            payload={
                "piece_id": piece_id,
                "source_revision_id": source_revision_id,
                "code_sha256": sha256(str(code).encode("utf-8")).hexdigest(),
                "intent": intent,
            },
            idempotency_key=idempotency_key,
        )
        if job["status"] == "succeeded" and job.get("result_version_id"):
            return self._revision_public(
                self.truth.store.get_version(job["result_version_id"]),
                piece,
            )
        self.truth.start_job(job["id"], worker_id=f"preview-{threading.get_ident()}")
        work_dir: Path | None = None
        staged_path: Path | None = None
        try:
            if event.is_set():
                raise JobCancelled("cancelled before preview validation")
            self._validate_code(code)
            if event.is_set():
                raise JobCancelled("cancelled before preview render")
            work_dir, audio_path, features = self._render_code_with_retry(
                code,
                job_id=job["id"],
                cancel_event=event,
            )
            if event.is_set():
                raise JobCancelled("cancelled after preview render")
            identity = self.truth.allocate_render_identity(
                piece_id=piece_id,
            )
            code_sha = sha256(code.encode("utf-8")).hexdigest()
            provenance = {
                "provider_route": "manual-editor",
                "route": "manual-editor",
                "model_id": "human-code",
                "reasoning_effort": None,
                "orchestration": "standard",
                "kernel_hash": None,
                "validator_mode": "deterministic",
                "repair_applied": False,
                "job_id": job["id"],
                "source_revision_id": source_revision_id,
                "original_code_sha256": source["code_sha256"],
                "rendered_code_sha256": code_sha,
            }
            staged = self.truth.stage_render(
                job_id=job["id"],
                piece_id=piece_id,
                version_id=identity["version_id"],
                code=code,
                audio_path=audio_path,
                prompt={
                    "schema_version": 1,
                    "mode": "manual-preview",
                    "intent": intent,
                    "source_revision_id": source_revision_id,
                },
                features=features,
            )
            staged_path = staged.path
            if event.is_set():
                raise JobCancelled("cancelled before preview commit")
            result = self.truth.commit_rendered_version(
                staged=staged,
                display_name=piece["display_name"],
                provenance=provenance,
                model_run={
                    "provider_route": "manual-editor",
                    "model_id": "human-code",
                    "reasoning_effort": None,
                    "orchestration": "standard",
                    "kernel_hash": None,
                    "validator_mode": "deterministic",
                    "request_receipt": {
                        "source_revision_id": source_revision_id,
                        "code_sha256": code_sha,
                    },
                    "response_receipt": {"rendered_code_sha256": code_sha},
                },
                version_fields={
                    "kind": "preview",
                    "state": "ready",
                    "parent_version_id": source_revision_id,
                },
            )
            if result["version"] is None:
                raise JobCancelled("cancelled before immutable preview commit")
            staged_path = None
            revision = self._revision_public(result["version"], piece)
            self._publish("piece.updated", self.get_piece(piece_id))
            self._activity(
                "Preview rendered",
                f"{piece['display_name']} · {revision['audio_sha'][:10]}",
                "ok",
                piece_id=piece_id,
                job_id=job["id"],
            )
            return revision
        except JobCancelled:
            self._finish_child_cancel(job["id"])
            raise
        except Exception as exc:
            try:
                current = self.truth.get_job(job["id"])
                if current["status"] not in {
                    "failed",
                    "cancelled",
                    "cancelled_after_commit",
                    "succeeded",
                }:
                    self.truth.store.finish_job(
                        job["id"],
                        status="failed",
                        error={"message": (str(exc) or type(exc).__name__)[:1000]},
                    )
            except Exception:
                pass
            raise
        finally:
            if staged_path is not None:
                shutil.rmtree(staged_path, ignore_errors=True)
            if work_dir is not None:
                shutil.rmtree(work_dir, ignore_errors=True)

    # ------------------------------------------------------------------
    # Agent Settings: live catalog -> real tool probe -> explicit Apply.

    def agent_settings_public(self) -> dict[str, Any]:
        # The in-product panel is the sole Brain configuration authority.
        # Historical environment names are intentionally ignored rather than
        # advertised as controls they no longer own.
        return self.agent_settings.ui_document()

    def discover_agent_catalog(
        self, draft: Mapping[str, Any]
    ) -> dict[str, Any]:
        self.agent_settings.stage_ui_draft(draft)
        snapshot = self.agent_settings.discover_catalog()
        self._catalog_cache = dict(snapshot)
        document = self.agent_settings_public()
        self._publish("settings.updated", self.settings_public())
        return {
            "catalog": document["catalog"],
            "fingerprint": document["draft_fingerprint"],
        }

    def test_agent_settings(self, draft: Mapping[str, Any]) -> dict[str, Any]:
        self.agent_settings.stage_ui_draft(draft)
        self.agent_settings.test_draft()
        document = self.agent_settings_public()
        self._publish("settings.updated", self.settings_public())
        self._activity(
            "Agent profile tested",
            (
                f"{document['draft'].get('model_id')} · "
                f"{'passed' if document.get('test', {}).get('ok') else 'failed'}"
            ),
            "ok" if document.get("test", {}).get("ok") else "error",
        )
        return document

    def apply_agent_settings(
        self, *, draft: Mapping[str, Any], test_id: str
    ) -> dict[str, Any]:
        self.agent_settings.stage_ui_draft(draft)
        result = self.agent_settings.apply_draft(str(test_id))
        document = self.agent_settings_public()
        if document.get("revision_id") != result.get("revision_id"):
            raise V3Error("Agent Apply readback did not return the committed revision")
        self._publish("settings.updated", self.settings_public())
        self._activity(
            "Agent profile applied",
            f"{document['active'].get('model_id')} · {document['revision_id']}",
            "ok",
        )
        return document

    def reset_agent_draft(
        self, expected_fingerprint: str | None = None
    ) -> dict[str, Any]:
        active = self.agent_settings.store.read_active_revision()
        self.agent_settings.reset_draft(
            expected_fingerprint=expected_fingerprint
        )
        document = self.agent_settings_public()
        self._publish("settings.updated", self.settings_public())
        self._activity(
            "Agent draft discarded",
            "Persisted draft now matches the active revision."
            if active
            else "Persisted draft returned to the empty default.",
            "info",
        )
        return document

    # ------------------------------------------------------------------
    # Durable Responses Brain with a music-only toolset.

    def brain_threads(self, *, limit: int = 40) -> list[dict[str, Any]]:
        """Conversation threads grouped from durable Brain jobs.

        A thread is the durable grouping key carried in job metadata; jobs
        predating threads (or created outside the UI) each stand alone so no
        history is hidden.
        """

        threads: dict[str, dict[str, Any]] = {}
        for job in self.brain_store.list_jobs(limit=400):
            metadata = dict(job.get("metadata") or {})
            thread_id = str(metadata.get("thread_id") or "") or f"job:{job['job_id']}"
            entry = threads.get(thread_id)
            title = str(
                metadata.get("user_message") or job["input"]["text"]
            ).strip()
            if entry is None:
                threads[thread_id] = {
                    "thread_id": thread_id,
                    "title": title[:80],
                    "piece_id": metadata.get("piece_id"),
                    "job_count": 1,
                    "created_at": job["created_at"],
                    "updated_at": job["updated_at"],
                    "last_state": job["status"],
                }
                continue
            entry["job_count"] += 1
            # list_jobs is newest-first: the oldest row owns the title.
            entry["title"] = title[:80]
            entry["piece_id"] = metadata.get("piece_id") or entry["piece_id"]
            entry["created_at"] = min(entry["created_at"], job["created_at"])
        ordered = sorted(
            threads.values(), key=lambda row: row["updated_at"], reverse=True
        )
        return ordered[: max(1, int(limit))]

    def _thread_transcript(self, thread_id: str) -> str:
        """Bounded prior-turn transcript so a thread has real continuity.

        Each Brain job is one durable turn; without this the model would
        answer every message with no memory of the thread.
        """

        turns: list[dict[str, Any]] = []
        for job in self.brain_store.list_jobs(limit=400):
            metadata = dict(job.get("metadata") or {})
            if str(metadata.get("thread_id") or "") != thread_id:
                continue
            turns.append(job)
        if not turns:
            return ""
        turns.sort(key=lambda row: row["created_at"])
        lines: list[str] = []
        for job in turns[-8:]:
            metadata = dict(job.get("metadata") or {})
            question = str(
                metadata.get("user_message") or job["input"]["text"]
            ).strip()
            answer = str(
                (job.get("result") or {}).get("output_text")
                or job.get("error")
                or f"({job['status']})"
            ).strip()
            lines.append(f"Bowei: {question[:600]}")
            lines.append(f"You: {answer[:900]}")
        transcript = "\n".join(lines)
        return transcript[-6000:]

    def create_brain_job(
        self,
        *,
        message: str,
        piece_id: str | None = None,
        revision_id: str | None = None,
        audio_sha: str | None = None,
        score: float | None = None,
        idempotency_key: str | None = None,
        thread_id: str | None = None,
    ) -> dict[str, Any]:
        user_message = str(message or "").strip()
        if not user_message:
            raise V3Error("Brain message cannot be empty")
        thread = str(thread_id or "").strip()
        if thread and (len(thread) > 120 or any(ord(c) < 32 for c in thread)):
            raise V3Error("thread_id is invalid")
        context: dict[str, Any] = {}
        if piece_id:
            piece = self.truth.store.get_piece(str(piece_id))
            selected_revision = str(revision_id or piece.get("current_version_id") or "")
            if selected_revision:
                version = self.truth.store.get_version(selected_revision)
                if version["piece_id"] != piece["id"]:
                    raise Conflict("Brain context revision does not belong to piece")
                if audio_sha and str(audio_sha) != version["audio_sha256"]:
                    raise Conflict(
                        "Brain context audio SHA does not match the pinned revision"
                    )
                verdict = self.truth.revision_usability(version, action="brain")
                if not verdict.usable:
                    raise Conflict(
                        "Brain context revision is not usable heard truth: "
                        f"{verdict.reason}"
                    )
                with self.truth.database.transaction(immediate=False) as conn:
                    rating = conn.execute(
                        """
                        SELECT score FROM ratings
                         WHERE piece_version_id=?
                         ORDER BY created_at DESC, rowid DESC LIMIT 1
                        """,
                        (selected_revision,),
                    ).fetchone()
                current_score = float(rating["score"]) if rating else None
                if score is not None:
                    try:
                        requested_score = float(score)
                    except (TypeError, ValueError) as exc:
                        raise V3Error("Brain context score must be numeric") from exc
                    if not math.isfinite(requested_score):
                        raise V3Error("Brain context score must be finite")
                    if current_score is None or requested_score != current_score:
                        raise Conflict(
                            "Brain context score does not match the pinned revision"
                        )
                context = {
                    "piece_id": piece["id"],
                    "piece_name": piece["display_name"],
                    "revision_id": selected_revision,
                    "audio_sha256": version["audio_sha256"],
                    "score": current_score,
                }
        if score is not None and not context:
            raise Conflict("Brain context score requires a pinned revision")
        model_input = user_message
        transcript = self._thread_transcript(thread) if thread else ""
        if transcript:
            model_input = (
                "PRIOR TURNS IN THIS THREAD (oldest first; durable record)\n"
                + transcript
                + "\n\nCURRENT MESSAGE\n"
                + user_message
            )
        if context:
            model_input += (
                "\n\nPINNED PRODUCT CONTEXT\n"
                + json.dumps(context, ensure_ascii=False, indent=2)
                + "\nUse tools to read current truth; do not invent missing evidence."
            )
        job = self.brain.submit(
            model_input,
            toolset_id="music",
            metadata={
                "user_message": user_message,
                **({"thread_id": thread} if thread else {}),
                **context,
            },
            idempotency_key=idempotency_key,
        )
        self._ensure_brain_monitor(job["job_id"])
        public = self._brain_public(job)
        self._publish("brain.updated", public)
        return public

    def get_brain_job(self, job_id: str) -> dict[str, Any]:
        return self._brain_public(self.brain_store.get_job(job_id))

    def cancel_brain_job(self, job_id: str) -> dict[str, Any]:
        self.brain.cancel(job_id)
        public = self.get_brain_job(job_id)
        self._publish("brain.updated", public)
        return public

    def _monitor_brain_job(self, job_id: str) -> None:
        try:
            self.brain.wait(job_id)
        finally:
            try:
                self._publish("brain.updated", self.get_brain_job(job_id))
            except Exception:
                pass
            with self._lock:
                self._brain_monitors.pop(job_id, None)

    def _ensure_brain_monitor(self, job_id: str) -> bool:
        if self.brain_store.get_job(job_id)["status"] in BRAIN_TERMINAL_STATUSES:
            return False
        with self._lock:
            existing = self._brain_monitors.get(job_id)
            if existing is not None and existing.is_alive():
                return False
            monitor = threading.Thread(
                target=self._monitor_brain_job,
                args=(job_id,),
                daemon=True,
                name=f"cactus-brain-monitor-{job_id[-8:]}",
            )
            self._brain_monitors[job_id] = monitor
            monitor.start()
        return True

    def _build_brain(self) -> BrainRunnerService:
        registry = ToolRegistry("music")

        def register(
            name: str,
            description: str,
            properties: Mapping[str, Any],
            required: list[str],
            handler,
            *,
            mutating: bool = False,
        ) -> None:
            registry.register(
                ToolSpec(
                    name=name,
                    description=description,
                    parameters={
                        "type": "object",
                        "properties": dict(properties),
                        "required": required,
                        "additionalProperties": False,
                    },
                    handler=handler,
                    mutating=mutating,
                )
            )

        register(
            "list_recent_pieces",
            "List recent immutable pieces and ear scores.",
            {"limit": {"type": "integer", "minimum": 1, "maximum": 30}},
            ["limit"],
            lambda args, _ctx: {
                "pieces": [
                    {
                        "id": piece["id"],
                        "name": piece["name"],
                        "revision_id": piece["active_revision_id"],
                        "audio_sha": piece["active_revision"]["audio_sha"],
                        "score": piece["active_revision"].get("score"),
                        "note": piece["active_revision"].get("note"),
                        "model_id": piece["active_revision"]["provenance"].get(
                            "model_id"
                        ),
                        "usable": piece["active_revision"].get("usable", True),
                        "usability_reason": piece["active_revision"].get(
                            "usability_reason"
                        ),
                    }
                    for piece in self.list_pieces()[: int(args["limit"])]
                ]
            },
        )
        register(
            "read_piece",
            "Read exact code, revisions, score, and provenance for one piece.",
            {"piece_id": {"type": "string"}},
            ["piece_id"],
            lambda args, _ctx: self.get_piece(str(args["piece_id"])),
        )
        register(
            "read_runtime_status",
            "Read generation, kernel, migration, and Agent readiness without secrets.",
            {},
            [],
            lambda _args, _ctx: {
                "generation": self.generation_settings_public(),
                "agent": self.agent_settings_public(),
                "system": self.system_settings_public(),
            },
        )
        register(
            "set_piece_archived",
            "Archive or restore a piece without deleting evidence or assets.",
            {
                "piece_id": {"type": "string"},
                "archived": {"type": "boolean"},
            },
            ["piece_id", "archived"],
            lambda args, _ctx: self.patch_piece(
                str(args["piece_id"]), {"archived": bool(args["archived"])}
            ),
            mutating=True,
        )
        register(
            "render_piece_preview",
            (
                "Deterministically validate and render complete Strudel code as "
                "an immutable B preview. It does not replace the active revision."
            ),
            {
                "piece_id": {"type": "string"},
                "source_revision_id": {"type": "string"},
                "code": {"type": "string"},
                "intent": {"type": "string"},
            },
            ["piece_id", "source_revision_id", "code", "intent"],
            lambda args, ctx: self.create_preview(
                piece_id=str(args["piece_id"]),
                source_revision_id=str(args["source_revision_id"]),
                code=str(args["code"]),
                intent=str(args.get("intent") or "Brain preview"),
                idempotency_key=f"brain:{ctx.job_id}:{ctx.call_id}",
                cancel_event=ctx.cancel_event,
            ),
            mutating=True,
        )
        register(
            "generate_first_shots",
            "Queue 1, 2, or 4 independent first shots using an explicit generation profile.",
            {
                "count": {"type": "integer", "enum": [1, 2, 4]},
                "producer_brief": {"type": "string"},
                "profile_id": {"type": "string"},
            },
            ["count", "producer_brief", "profile_id"],
            lambda args, ctx: self.create_generation_job(
                count=int(args["count"]),
                prompt=str(args["producer_brief"]),
                profile_id=str(args["profile_id"]),
                idempotency_key=f"brain:{ctx.job_id}:{ctx.call_id}",
            ),
            mutating=True,
        )
        # Deliberately absent: scoring and revision promotion. Brain may create
        # reversible evidence, but only Bowei can bind an ear score or choose A.
        ultra = BoundedUltraCoordinator(
            supported_models=("gpt-5.6-sol", "gpt-5.6-terra"),
            scout_count=2,
        )
        return BrainRunnerService(
            store=self.brain_store,
            settings=self.agent_settings,
            toolsets={"music": registry},
            ultra=ultra,
            max_workers=2,
            max_tool_rounds=10,
            effect_reconciler=self._reconcile_brain_effect,
        )

    def _reconcile_brain_effect(
        self, call: Mapping[str, Any]
    ) -> dict[str, Any] | None:
        """BJ-EFFECT-001 probe: was this mutating tool's durable effect
        committed?

        The mutating Brain tools create internal durable rows under the
        deterministic idempotency key `brain:{job_id}:{call_id}`, so the
        observed effect is a lookup, never a replay. Returns
        {"observed": bool, "identity": {...}} or None when this probe cannot
        decide.
        """

        tool_name = str(call.get("tool_name") or "")
        arguments = dict(call.get("arguments") or {})
        effect_key = f"brain:{call.get('job_id')}:{call.get('call_id')}"
        try:
            if tool_name == "generate_first_shots":
                batch = self.generation_repo.get_by_idempotency_key(effect_key)
                if batch is None:
                    return {"observed": False, "identity": {}}
                return {
                    "observed": True,
                    "identity": {
                        "kind": "generation_batch",
                        "batch_id": batch["id"],
                        "status": batch["status"],
                    },
                }
            if tool_name == "render_piece_preview":
                job = self.truth.store.get_job_by_idempotency_key(effect_key)
                if job is None:
                    return {"observed": False, "identity": {}}
                return {
                    "observed": True,
                    "identity": {
                        "kind": "preview_job",
                        "job_id": job["id"],
                        "status": job["status"],
                        "result_version_id": job.get("result_version_id"),
                    },
                }
            # set_piece_archived deliberately has NO probe: its effect is
            # mutable current state, so "matches requested" can be a
            # coincidence in either direction. It stays
            # reconciliation_required — the state is visible, reversible,
            # and a human resolves it at a glance.
        except Exception:
            return None
        return None

    # ------------------------------------------------------------------
    # UI document normalization

    def system_settings_public(self) -> dict[str, Any]:
        with self.truth.database.transaction(immediate=False) as conn:
            piece_count = int(
                conn.execute("SELECT COUNT(*) AS n FROM pieces").fetchone()["n"]
            )
            legacy_count = int(
                conn.execute(
                    "SELECT COUNT(*) AS n FROM pieces WHERE provenance_class LIKE 'legacy%'"
                ).fetchone()["n"]
            )
        recovery_candidates = self._recovery_candidates_public()
        return {
            "api_version": "v2",
            "server_started_at": self.started_at,
            "database_path": str(self.db_path),
            "asset_root": str(self.assets_root),
            "migrations": [
                {
                    "id": "runtime-truth-v1",
                    "status": "ready",
                    "detail": f"{piece_count} pieces; {legacy_count} legacy-preserved",
                },
                {
                    "id": "jsonl-source-preservation",
                    "status": "ready",
                    "detail": "Legacy JSONL and source assets remain read-only evidence.",
                },
            ],
            "recovery_candidate_count": len(recovery_candidates),
            "recovery_candidates": recovery_candidates,
            "legacy_routes_enabled": False,
            "legacy_api_enabled": False,
            "legacy_snapshot_available": True,
        }

    def _recovery_candidates_public(self) -> list[dict[str, Any]]:
        """Read the frozen reconciliation plan without importing its candidates."""

        plan_path = (
            self.repo_root
            / "archive"
            / "migrations"
            / "v3-legacy-plan-20260728.json"
        )
        if not plan_path.is_file():
            return []
        try:
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        if not isinstance(plan, Mapping):
            return []
        candidates = plan.get("recovery_candidates")
        if not isinstance(candidates, list):
            return []
        public: list[dict[str, Any]] = []
        for candidate in candidates:
            if (
                not isinstance(candidate, Mapping)
                or candidate.get("classification") != "recovery_candidate"
            ):
                continue
            files = candidate.get("files")
            files = files if isinstance(files, Mapping) else {}
            js_file = files.get("js")
            js_file = js_file if isinstance(js_file, Mapping) else {}
            mp3_file = files.get("mp3")
            mp3_file = mp3_file if isinstance(mp3_file, Mapping) else {}
            public.append(
                {
                    "task_id": str(candidate.get("task_id") or ""),
                    "source_line": int(candidate.get("source_line") or 0),
                    "js": str(candidate.get("js") or ""),
                    "mp3": str(candidate.get("mp3") or ""),
                    "code_sha": str(js_file.get("sha256") or ""),
                    "audio_sha": str(mp3_file.get("sha256") or ""),
                    "human_decision_required": bool(
                        candidate.get("human_decision_required")
                    ),
                }
            )
        return public

    def _piece_public(self, piece: Mapping[str, Any]) -> dict[str, Any]:
        versions = self.truth.store.list_versions(str(piece["id"]))
        active_id = str(piece.get("current_version_id") or "")
        active = next((row for row in versions if row["id"] == active_id), None)
        if active is None:
            raise V3Error(f"piece has no active revision: {piece['id']}")
        revisions = [self._revision_public(row, piece) for row in versions]
        active_public = next(row for row in revisions if row["id"] == active_id)
        duplicate_of = None
        for tag in piece.get("tags_json") or []:
            if str(tag).startswith("duplicate-of:"):
                duplicate_of = str(tag).split(":", 1)[1]
        legacy = dict(active.get("provenance_json") or {}).get("legacy")
        if not duplicate_of and isinstance(legacy, Mapping):
            duplicate_of = legacy.get("duplicate_of")
        return {
            "id": piece["id"],
            "name": piece["display_name"],
            "created_at": piece["created_at"],
            "updated_at": piece.get("updated_at"),
            "archived": bool(piece.get("archived_at")),
            "collection": piece.get("collection"),
            "tags": list(piece.get("tags_json") or []),
            "active_revision_id": active_id,
            "active_revision": active_public,
            "revisions": revisions,
            "duplicate_of": duplicate_of,
            "recovery": False,
        }

    def _revision_public(
        self, version: Mapping[str, Any], piece: Mapping[str, Any]
    ) -> dict[str, Any]:
        asset_dir = Path(str(version["asset_dir"]))
        if not asset_dir.is_absolute():
            asset_dir = self.repo_root / asset_dir
        usability = self.truth.revision_usability(version, action="list")
        code_path = asset_dir / "piece.js"
        if not usability.usable:
            # DT-003: an unusable revision stays listed with its reason, but
            # its unverified bytes are withheld — drifted code must not reach
            # the editor, CLI readers, or Brain context as if it were truth.
            code = ""
        else:
            try:
                code = code_path.read_text(encoding="utf-8")
            except OSError as exc:
                raise V3Error(
                    f"piece code asset is missing: {version['id']}"
                ) from exc
        try:
            relative_audio = (asset_dir / "audio.mp3").resolve().relative_to(
                self.repo_root
            )
        except ValueError as exc:
            raise V3Error("audio asset is outside the served product root") from exc
        with self.truth.database.transaction(immediate=False) as conn:
            rating = conn.execute(
                """
                SELECT score, note, created_at FROM ratings
                 WHERE piece_version_id=?
                 ORDER BY created_at DESC, rowid DESC LIMIT 1
                """,
                (version["id"],),
            ).fetchone()
        provenance = dict(version.get("provenance_json") or {})
        if "route" not in provenance and provenance.get("provider_route"):
            provenance["route"] = provenance["provider_route"]
        provenance["legacy"] = str(
            piece.get("provenance_class") or ""
        ).startswith("legacy")
        prompt_path = asset_dir / "prompt.json"
        receipt_path = asset_dir / "receipt.json"
        prompt_document: Mapping[str, Any] = {}
        if usability.usable and prompt_path.is_file():
            try:
                parsed_prompt = json.loads(prompt_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise V3Error(
                    f"prompt receipt is unreadable: {version['id']}"
                ) from exc
            if isinstance(parsed_prompt, Mapping):
                prompt_document = parsed_prompt
        prompt_model = prompt_document.get("model")
        prompt_model = prompt_model if isinstance(prompt_model, Mapping) else {}
        prompt_kernel = prompt_document.get("kernel")
        prompt_kernel = prompt_kernel if isinstance(prompt_kernel, Mapping) else {}
        prompt_summary: dict[str, Any] = {
            "mode": str(prompt_document.get("mode") or "unknown"),
            "kernel_hash": (
                prompt_kernel.get("hash") or provenance.get("kernel_hash")
            ),
            "model_id": (
                prompt_model.get("id") or provenance.get("model_id")
            ),
        }
        if prompt_document.get("producer_brief") is not None:
            prompt_summary["producer_brief"] = str(
                prompt_document.get("producer_brief") or ""
            )
        elif prompt_document.get("legacy_name") is not None:
            prompt_summary["legacy_name"] = str(
                prompt_document.get("legacy_name") or ""
            )

        result = {
            "id": version["id"],
            "piece_id": version["piece_id"],
            "label": (
                "Original"
                if version["kind"] == "original"
                else "Legacy import"
                if version["kind"] == "legacy"
                else "Preview B"
                if version["kind"] == "preview"
                else "Revision"
            ),
            "created_at": version["created_at"],
            "code": code,
            "js_url": "/" + str((asset_dir / "piece.js").relative_to(self.repo_root)),
            "audio_url": "/" + str(relative_audio),
            "audio_sha": version["audio_sha256"],
            "source_revision_id": version.get("parent_version_id"),
            "duration_seconds": version["duration_seconds"],
            "score": float(rating["score"]) if rating else None,
            "note": rating["note"] if rating else "",
            "provenance": provenance,
            "prompt_summary": prompt_summary,
            "promoted": version["id"] == piece.get("current_version_id"),
            "preview": version["kind"] == "preview"
            and version["id"] != piece.get("current_version_id"),
            "usable": usability.usable,
            "usability_reason": usability.reason,
        }
        for field, path in (
            ("prompt_url", prompt_path),
            ("receipt_url", receipt_path),
        ):
            if not path.is_file():
                continue
            try:
                relative = path.resolve().relative_to(self.repo_root)
            except ValueError as exc:
                raise V3Error(
                    f"{field.removesuffix('_url')} asset is outside the served product root"
                ) from exc
            result[field] = "/" + str(relative)
        return result

    def _generation_public(self, row: Mapping[str, Any]) -> dict[str, Any]:
        piece_ids = list(row.get("piece_ids") or [])
        completed = len(piece_ids)
        if row.get("child_job_ids") and row["status"] not in _TERMINAL_BATCH:
            dynamic_ids: list[str] = []
            for child_id in row["child_job_ids"]:
                try:
                    child = self.truth.get_job(str(child_id))
                    version_id = child.get("result_version_id")
                    if version_id:
                        version = self.truth.store.get_version(str(version_id))
                        dynamic_ids.append(str(version["piece_id"]))
                except Exception:
                    continue
            piece_ids = list(dict.fromkeys(dynamic_ids))
            completed = len(piece_ids)
        state = str(row["status"])
        receipt = None
        if state in _TERMINAL_BATCH:
            receipt = {
                "id": f"receipt-{row['id']}",
                "kind": "generation.batch",
                "status": state,
                "at": row.get("finished_at") or row["updated_at"],
                "summary": f"{completed}/{row['count']} immutable piece(s) committed",
                "details": {
                    "piece_ids": piece_ids,
                    "child_job_ids": row.get("child_job_ids") or [],
                    "error": row.get("error"),
                    "generation_config_revision_id": (
                        row.get("generation_config") or {}
                    ).get("revision_id"),
                    "kernel_hash": (row.get("kernel_snapshot") or {}).get("hash"),
                },
            }
        stage = {
            "queued": "Queued before any model work",
            "running": "Generating independent first shots",
            "cancelling": "Stopping model/render work",
            "done": "Immutable assets committed",
            "failed": "Generation stopped with an error",
            "cancelled": "Cancelled before commit",
            "cancelled_after_commit": "Cancelled after at least one commit",
            "interrupted": "Runtime restarted; no uncertain replay",
        }.get(state, state)
        return {
            "id": row["id"],
            "state": state,
            "created_at": row["created_at"],
            "updated_at": row.get("updated_at"),
            "progress": completed / int(row["count"]),
            "stage": stage,
            "count": int(row["count"]),
            "completed_count": completed,
            "prompt": row.get("prompt"),
            "profile_id": row.get("profile_id"),
            "piece_ids": piece_ids,
            "error": row.get("error"),
            "receipt": receipt,
        }

    @staticmethod
    def _brain_tool_summary(tool_name: str, result: Any) -> str:
        """One honest line about a tool outcome.

        Computed here because the display text is truncated for transport;
        a client can only re-derive this by parsing a string that may have
        been cut mid-JSON.
        """

        if isinstance(result, Mapping):
            pieces = result.get("pieces")
            if isinstance(pieces, list):
                return f"{len(pieces)} piece(s) read"
            if result.get("reconciled") is True:
                return "effect reconciled"
            identity = result.get("id")
            state = result.get("state") or result.get("status")
            if identity and state:
                return f"{str(identity)[:16]} · {state}"
            name = result.get("name") or result.get("display_name")
            if name:
                return str(name)
            if identity:
                return str(identity)[:24]
            keys = list(result.keys())
            return f"{len(keys)} field(s): {', '.join(keys[:3])}"
        if isinstance(result, list):
            return f"{len(result)} item(s)"
        text = str(result)
        return text[:70] + ("…" if len(text) > 70 else "")

    @staticmethod
    def _brain_tool_action(
        tool_name: str, result: Any
    ) -> dict[str, Any] | None:
        """Exact identities from a product tool's committed outcome."""

        if not isinstance(result, Mapping):
            return None
        if isinstance(result.get("identity"), Mapping):
            # A reconciled effect already names its durable identity.
            identity = dict(result["identity"])
            identity["kind"] = str(identity.get("kind") or "reconciled")
            return identity
        if tool_name == "render_piece_preview" and result.get("id"):
            return {
                "kind": "preview",
                "piece_id": result.get("piece_id"),
                "revision_id": result.get("id"),
                "audio_sha": result.get("audio_sha"),
            }
        if tool_name == "generate_first_shots" and result.get("id"):
            return {
                "kind": "generation",
                "job_id": result.get("id"),
                "state": result.get("state"),
            }
        return None

    def _brain_public(self, job: Mapping[str, Any]) -> dict[str, Any]:
        metadata = dict(job.get("metadata") or {})
        messages = [
            {
                "id": f"{job['job_id']}:user",
                "role": "user",
                "text": str(metadata.get("user_message") or job["input"]["text"]),
                "created_at": job["created_at"],
            }
        ]
        with closing(sqlite3.connect(self.db_path)) as conn:
            conn.row_factory = sqlite3.Row
            tool_rows = conn.execute(
                """
                SELECT call_id, tool_name, status, result_json, ended_at,
                       mutating, committed, effect_state
                  FROM brain_tool_calls
                 WHERE job_id=?
                 ORDER BY started_at, call_id
                """,
                (job["job_id"],),
            ).fetchall()
        for tool in tool_rows:
            summary = tool["status"]
            preview = tool["status"]
            action = None
            if tool["result_json"]:
                try:
                    result = json.loads(tool["result_json"])
                    preview = json.dumps(
                        result, ensure_ascii=False, indent=2
                    )[:4000]
                    summary = self._brain_tool_summary(
                        str(tool["tool_name"]), result
                    )
                    # A2: product-tool outcomes carry exact identities so the
                    # thread can act on them.
                    action = self._brain_tool_action(
                        str(tool["tool_name"]), result
                    )
                except json.JSONDecodeError:
                    pass
            entry = {
                "id": f"{job['job_id']}:tool:{tool['call_id']}",
                "role": "tool",
                "tool_name": tool["tool_name"],
                "summary": summary,
                "text": preview,
                "created_at": tool["ended_at"] or job["updated_at"],
                "mutating": bool(tool["mutating"]),
                "committed": bool(tool["committed"]),
                "effect_state": tool["effect_state"],
            }
            if action is not None:
                entry["action"] = action
            messages.append(entry)
        result = job.get("result") or {}
        if result.get("output_text"):
            messages.append(
                {
                    "id": f"{job['job_id']}:assistant",
                    "role": "assistant",
                    "text": result["output_text"],
                    "created_at": job.get("ended_at") or job["updated_at"],
                }
            )
        state = {
            "completed": "done",
            "cancel_requested": "cancelling",
        }.get(str(job["status"]), str(job["status"]))
        receipt = None
        if state in {"done", "failed", "cancelled", "cancelled_after_commit"}:
            receipts = self.brain_store.receipts(str(job["job_id"]))
            effect_summary = {
                "mutating_calls": sum(1 for t in tool_rows if t["mutating"]),
                "committed": sum(1 for t in tool_rows if t["committed"]),
                "effect_observed": sum(
                    1
                    for t in tool_rows
                    if t["effect_state"] == "effect_observed"
                ),
                "reconciliation_required": sum(
                    1
                    for t in tool_rows
                    if t["effect_state"] == "reconciliation_required"
                ),
            }
            receipt = {
                "id": receipts[-1]["receipt_id"] if receipts else f"receipt-{job['job_id']}",
                "kind": "brain.responses",
                "status": state,
                "at": job.get("ended_at") or job["updated_at"],
                "summary": (
                    f"{result.get('response_count', 0)} response turn(s), "
                    f"{result.get('tool_call_count', len(tool_rows))} tool call(s)"
                ),
                "details": {
                    "config_revision_id": job["config_revision_id"],
                    "model_id": result.get("model_id"),
                    "reasoning_effort": result.get("reasoning_effort"),
                    "wire_reasoning_effort": result.get("wire_reasoning_effort"),
                    "orchestration": result.get("orchestration"),
                    "effects": effect_summary,
                },
            }
        return {
            "id": job["job_id"],
            "state": state,
            "created_at": job["created_at"],
            "updated_at": job["updated_at"],
            "thread_id": metadata.get("thread_id"),
            "piece_id": metadata.get("piece_id"),
            "revision_id": metadata.get("revision_id"),
            "audio_sha": metadata.get("audio_sha256"),
            "score": metadata.get("score"),
            "config_revision_id": job["config_revision_id"],
            "messages": messages,
            "error": job.get("error"),
            "receipt": receipt,
        }

    # ------------------------------------------------------------------
    # Deterministic validation/render helpers

    def _validate_code(self, code: str) -> dict[str, Any]:
        if not str(code).strip():
            raise V3Error("Strudel code is empty")
        completed = subprocess.run(
            [
                "/usr/bin/env",
                "pnpm",
                "-C",
                "apps/render-worker",
                "-s",
                "exec",
                "tsx",
                "src/validate-strudel.ts",
                "--json",
                "--stdin",
            ],
            cwd=self.repo_root,
            input=code,
            text=True,
            capture_output=True,
            timeout=450,
            check=False,
        )
        try:
            report = json.loads(completed.stdout or "{}")
        except json.JSONDecodeError as exc:
            raise V3Error("deterministic validator returned invalid output") from exc
        if completed.returncode != 0 or not report.get("ok"):
            issues = report.get("issues") or []
            detail = "; ".join(
                str(issue.get("message") or issue.get("code") or "validation issue")
                for issue in issues[:6]
                if isinstance(issue, Mapping)
            )
            raise V3Error(f"deterministic Strudel validation failed: {detail or 'unknown issue'}")
        return report

    def _render_preflight(self) -> None:
        """Fail before spawning when the render environment cannot succeed."""

        missing = [
            binary
            for binary in ("ffmpeg", "ffprobe", "pnpm", "node")
            if shutil.which(binary) is None
        ]
        if missing:
            raise V3Error(
                "render environment is missing "
                + ", ".join(missing)
                + " — run the doctor for the exact fix"
            )

    def _render_code_with_retry(
        self,
        code: str,
        *,
        job_id: str,
        cancel_event: threading.Event,
    ) -> tuple[Path, Path, dict[str, Any] | None]:
        """One bounded retry for a failed render (B2).

        The first failure is recorded on the durable job before the retry,
        so a green second attempt never hides that the first one failed.
        """

        self._render_preflight()
        try:
            return self._render_code(
                code, job_id=job_id, cancel_event=cancel_event
            )
        except JobCancelled:
            raise
        except V3Error as exc:
            if cancel_event.is_set():
                raise
            try:
                self.truth.store.append_job_event(
                    job_id,
                    "render.retry",
                    {"first_error": (str(exc) or "render failed")[:600]},
                )
            except Exception:  # noqa: BLE001 - retry evidence is best-effort
                pass
            return self._render_code(
                code, job_id=job_id, cancel_event=cancel_event
            )

    def _render_code(
        self,
        code: str,
        *,
        job_id: str,
        cancel_event: threading.Event,
    ) -> tuple[Path, Path, dict[str, Any] | None]:
        if cancel_event.is_set():
            raise JobCancelled("render cancelled")
        wall_timeout = self._render_wall_timeout_seconds()
        work_root = self.state_root / "work"
        work_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        work_dir = Path(tempfile.mkdtemp(prefix=f"{job_id}-", dir=work_root))
        code_path = work_dir / "piece.js"
        stdout_path = work_dir / ".render.stdout.log"
        stderr_path = work_dir / ".render.stderr.log"
        command = [
            "/usr/bin/env",
            "pnpm",
            "-C",
            "apps/render-worker",
            "-s",
            "exec",
            "tsx",
            "src/auto-render.ts",
            str(code_path),
        ]
        process: subprocess.Popen[bytes] | None = None
        try:
            code_path.write_text(code, encoding="utf-8")
            with (
                stdout_path.open("w+b", buffering=0) as stdout_log,
                stderr_path.open("w+b", buffering=0) as stderr_log,
            ):
                started_at = time.monotonic()
                process = subprocess.Popen(
                    command,
                    cwd=self.repo_root,
                    stdout=stdout_log,
                    stderr=stderr_log,
                    start_new_session=True,
                )
                deadline = started_at + wall_timeout
                while True:
                    returncode = process.poll()
                    if returncode is not None:
                        # wait() is intentionally explicit even though poll()
                        # normally reaps on POSIX. Every lifecycle branch owns
                        # a final child-process wait.
                        process.wait()
                        break
                    if cancel_event.is_set():
                        self._stop_render_process(process)
                        raise JobCancelled("render cancelled")
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        self._stop_render_process(process)
                        raise V3Error(
                            "Strudel render exceeded "
                            f"{wall_timeout:g}s wall deadline"
                        )
                    try:
                        process.wait(timeout=min(_RENDER_POLL_SECONDS, remaining))
                        break
                    except subprocess.TimeoutExpired:
                        continue
                stdout = self._render_log_tail(stdout_log)
                stderr = self._render_log_tail(stderr_log)

            audio_path = work_dir / "piece.mp3"
            if (
                process.returncode != 0
                or not audio_path.is_file()
                or audio_path.stat().st_size <= 0
            ):
                detail = (stderr or stdout or f"exit {process.returncode}")[-1200:]
                raise V3Error(f"Strudel render failed: {detail}")
            features_path = work_dir / "piece.features.json"
            features = None
            if features_path.is_file():
                try:
                    loaded = json.loads(features_path.read_text(encoding="utf-8"))
                    if isinstance(loaded, dict):
                        features = loaded
                except (OSError, json.JSONDecodeError):
                    features = None
            return work_dir, audio_path, features
        except BaseException:
            if process is not None:
                if process.poll() is None:
                    self._stop_render_process(process)
                else:
                    process.wait()
            shutil.rmtree(work_dir, ignore_errors=True)
            raise
        finally:
            for log_path in (stdout_path, stderr_path):
                try:
                    log_path.unlink()
                except FileNotFoundError:
                    pass

    @staticmethod
    def _model_timeout_seconds() -> float:
        raw = os.environ.get("CACTUS_MODEL_TIMEOUT")
        try:
            value = float(raw) if raw else _DEFAULT_MODEL_TIMEOUT_SECONDS
        except ValueError:
            return _DEFAULT_MODEL_TIMEOUT_SECONDS
        return value if value > 0 else _DEFAULT_MODEL_TIMEOUT_SECONDS

    @staticmethod
    def _render_wall_timeout_seconds() -> float:
        raw = os.environ.get("CACTUS_RENDER_WALL_TIMEOUT_SECONDS")
        if raw is None:
            return _DEFAULT_RENDER_WALL_TIMEOUT_SECONDS
        try:
            timeout = float(raw)
        except ValueError as exc:
            raise V3Error(
                "CACTUS_RENDER_WALL_TIMEOUT_SECONDS must be a finite positive number"
            ) from exc
        if not math.isfinite(timeout) or timeout <= 0:
            raise V3Error(
                "CACTUS_RENDER_WALL_TIMEOUT_SECONDS must be a finite positive number"
            )
        return timeout

    @staticmethod
    def _stop_render_process(process: subprocess.Popen[bytes]) -> None:
        if process.poll() is not None:
            process.wait()
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=_RENDER_TERM_GRACE_SECONDS)
            return
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        # SIGKILL is terminal; a blocking wait here is the ownership boundary
        # that prevents a cancelled/timed-out render from becoming a zombie.
        process.wait()

    @staticmethod
    def _render_log_tail(log: Any, *, max_bytes: int = 16_384) -> str:
        log.flush()
        log.seek(0, os.SEEK_END)
        size = log.tell()
        log.seek(max(0, size - max_bytes), os.SEEK_SET)
        return log.read().decode("utf-8", errors="replace")

    @staticmethod
    def _extract_code(response_text: str) -> str:
        candidates = [
            match.group("code").strip()
            for match in _FENCE_RE.finditer(str(response_text or ""))
            if match.group("code").strip()
        ]
        if not candidates:
            raise V3Error("model response did not contain a fenced Strudel code block")
        return max(candidates, key=len) + "\n"

    @staticmethod
    def _profile_from_config(
        config: Mapping[str, Any], profile_id: str
    ) -> GenerationProfile:
        row = next(
            (
                item
                for item in config.get("profiles", [])
                if isinstance(item, Mapping) and item.get("id") == profile_id
            ),
            None,
        )
        if row is None:
            raise V3Error(f"generation profile not found: {profile_id}")
        return GenerationProfile(
            profile_id=str(row["id"]),
            label=str(row["label"]),
            model_id=str(row["model_id"]),
            reasoning_effort=(
                str(row["reasoning_effort"])
                if row.get("reasoning_effort") is not None
                else None
            ),
            orchestration=str(row.get("orchestration") or "standard"),
            description=str(row.get("description") or ""),
        )

    def _read_latest_catalog(self) -> dict[str, Any] | None:
        state = self.agent_settings.store.read_state()
        catalog_id = state.get("last_catalog_id")
        if not catalog_id:
            return None
        try:
            return self.agent_settings.store.read_catalog(str(catalog_id))
        except Exception:
            return None

    def _publish(self, event_type: str, data: Mapping[str, Any]) -> int:
        return self.events.append(event_type, data)

    def _activity(
        self,
        title: str,
        detail: str,
        status: str,
        *,
        job_id: str | None = None,
        piece_id: str | None = None,
    ) -> None:
        self._publish(
            "activity.created",
            {
                "seq": 0,
                "id": f"activity-{uuid4().hex}",
                "at": utc_now(),
                "kind": "operation",
                "title": title,
                "detail": detail,
                "status": status,
                "job_id": job_id,
                "piece_id": piece_id,
            },
        )


def _contains_secret_field(value: Any) -> bool:
    forbidden = {
        "api_key",
        "authorization",
        "secret",
        "access_token",
        "credential_value",
    }
    if isinstance(value, Mapping):
        return any(
            str(key).lower() in forbidden or _contains_secret_field(child)
            for key, child in value.items()
        )
    if isinstance(value, (list, tuple)):
        return any(_contains_secret_field(child) for child in value)
    return False
