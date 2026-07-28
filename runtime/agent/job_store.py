"""SQLite operational truth for Agent Brain jobs and receipts."""

from __future__ import annotations

from collections.abc import Mapping
from contextlib import closing
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import threading
from typing import Any
from uuid import uuid4

from .errors import JobError, ToolExecutionError
from .models import canonical_json, json_fingerprint


DEFAULT_JOBS_DB = Path.home() / ".cactus-strudel" / "v3" / "runtime.sqlite3"
TERMINAL_STATUSES = frozenset(
    {"completed", "failed", "cancelled", "cancelled_after_commit"}
)


class BrainJobStore:
    def __init__(
        self,
        path: str | os.PathLike[str] = DEFAULT_JOBS_DB,
        *,
        owner=None,
    ):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._owner = owner
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if owner is not None:
            owner.require("initialize brain job schema")
        self._initialize()

    def _require_owner(self, action: str, *, new_work: bool = False) -> None:
        if self._owner is not None:
            self._owner.require(action, new_work=new_work)

    def create_job(
        self,
        *,
        config_revision_id: str,
        input_text: str,
        toolset_id: str,
        metadata: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        self._require_owner("create brain job", new_work=True)
        normalized_key = _optional_idempotency_key(idempotency_key)
        input_json = canonical_json({"text": input_text})
        metadata_json = canonical_json(dict(metadata or {}))
        job_id = f"brain-{uuid4().hex}"
        now = utc_now()
        with self._tx() as conn:
            if normalized_key:
                existing = conn.execute(
                    """
                    SELECT job_id, config_revision_id, toolset_id, input_json
                    FROM brain_jobs WHERE idempotency_key = ?
                    """,
                    (normalized_key,),
                ).fetchone()
                if existing:
                    if (
                        existing["config_revision_id"] != config_revision_id
                        or existing["toolset_id"] != toolset_id
                        or existing["input_json"] != input_json
                    ):
                        raise JobError(
                            "Brain idempotency key was reused with "
                            "different job input"
                        )
                    job_id = existing["job_id"]
                    return self.get_job(job_id)
            conn.execute(
                """
                INSERT INTO brain_jobs(
                    job_id, idempotency_key, config_revision_id, toolset_id, status,
                    input_json, metadata_json, result_json, error,
                    created_at, updated_at, started_at, ended_at
                ) VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL, NULL, ?, ?, NULL, NULL)
                """,
                (
                    job_id,
                    normalized_key,
                    config_revision_id,
                    toolset_id,
                    input_json,
                    metadata_json,
                    now,
                    now,
                ),
            )
            self._insert_event(
                conn,
                job_id,
                "queued",
                {
                    "config_revision_id": config_revision_id,
                    "toolset_id": toolset_id,
                    "idempotency_key": normalized_key,
                },
            )
        return self.get_job(job_id)

    def get_job(self, job_id: str) -> dict[str, Any]:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT * FROM brain_jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
        if row is None:
            raise JobError(f"Brain job not found: {job_id}")
        return _job_row(row)

    def list_jobs(self, *, limit: int = 100) -> list[dict[str, Any]]:
        bounded = max(1, min(int(limit), 500))
        with closing(self._connect()) as conn:
            rows = conn.execute(
                """
                SELECT * FROM brain_jobs
                ORDER BY created_at DESC, job_id DESC
                LIMIT ?
                """,
                (bounded,),
            ).fetchall()
        return [_job_row(row) for row in rows]

    def mark_running(self, job_id: str) -> bool:
        self._require_owner("start brain job", new_work=True)
        now = utc_now()
        with self._tx() as conn:
            changed = conn.execute(
                """
                UPDATE brain_jobs
                SET status = 'running', started_at = COALESCE(started_at, ?),
                    updated_at = ?
                WHERE job_id = ? AND status = 'queued'
                """,
                (now, now, job_id),
            ).rowcount
            if changed:
                self._insert_event(conn, job_id, "running", {})
        return bool(changed)

    def request_cancel(self, job_id: str) -> dict[str, Any]:
        self._require_owner("request brain job cancellation")
        now = utc_now()
        with self._tx() as conn:
            row = conn.execute(
                "SELECT status FROM brain_jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            if row is None:
                raise JobError(f"Brain job not found: {job_id}")
            status = row["status"]
            if status == "queued":
                next_status = "cancelled"
                ended_at = now
            elif status in ("running", "cancel_requested"):
                next_status = "cancel_requested"
                ended_at = None
            else:
                next_status = status
                ended_at = None
            if next_status != status:
                conn.execute(
                    """
                    UPDATE brain_jobs
                    SET status = ?, updated_at = ?, ended_at = COALESCE(?, ended_at)
                    WHERE job_id = ?
                    """,
                    (next_status, now, ended_at, job_id),
                )
                self._insert_event(
                    conn,
                    job_id,
                    "cancel_requested"
                    if next_status == "cancel_requested"
                    else "cancelled",
                    {},
                )
        return self.get_job(job_id)

    def cancellation_requested(self, job_id: str) -> bool:
        return self.get_job(job_id)["status"] in (
            "cancel_requested",
            "cancelled",
            "cancelled_after_commit",
        )

    def finish(
        self,
        job_id: str,
        *,
        status: str,
        result: Mapping[str, Any] | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        self._require_owner("finalize brain job")
        if status not in TERMINAL_STATUSES:
            raise JobError(f"invalid terminal job status: {status}")
        now = utc_now()
        with self._tx() as conn:
            row = conn.execute(
                "SELECT status FROM brain_jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            if row is None:
                raise JobError(f"Brain job not found: {job_id}")
            if row["status"] in TERMINAL_STATUSES:
                return self.get_job(job_id)
            conn.execute(
                """
                UPDATE brain_jobs
                SET status = ?, result_json = ?, error = ?,
                    updated_at = ?, ended_at = ?
                WHERE job_id = ?
                """,
                (
                    status,
                    canonical_json(dict(result)) if result is not None else None,
                    error,
                    now,
                    now,
                    job_id,
                ),
            )
            self._insert_event(
                conn,
                job_id,
                status,
                {"error": error} if error else {},
            )
        return self.get_job(job_id)

    def append_receipt(
        self,
        job_id: str,
        kind: str,
        payload: Mapping[str, Any],
    ) -> str:
        self._require_owner("append brain receipt")
        receipt_id = f"receipt-{uuid4().hex}"
        now = utc_now()
        with self._tx() as conn:
            conn.execute(
                """
                INSERT INTO brain_receipts(
                    receipt_id, job_id, kind, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    receipt_id,
                    job_id,
                    kind,
                    canonical_json(dict(payload)),
                    now,
                ),
            )
            self._insert_event(
                conn,
                job_id,
                "receipt",
                {"receipt_id": receipt_id, "kind": kind},
            )
        return receipt_id

    def receipts(self, job_id: str) -> list[dict[str, Any]]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                """
                SELECT * FROM brain_receipts
                WHERE job_id = ?
                ORDER BY seq
                """,
                (job_id,),
            ).fetchall()
        return [
            {
                "seq": row["seq"],
                "receipt_id": row["receipt_id"],
                "job_id": row["job_id"],
                "kind": row["kind"],
                "payload": json.loads(row["payload_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def begin_tool_call(
        self,
        *,
        job_id: str,
        call_id: str,
        tool_name: str,
        arguments: Mapping[str, Any],
        mutating: bool,
    ) -> tuple[bool, Any | None]:
        self._require_owner("begin brain tool call", new_work=True)
        args_hash = json_fingerprint(dict(arguments))
        now = utc_now()
        with self._tx() as conn:
            existing = conn.execute(
                """
                SELECT * FROM brain_tool_calls
                WHERE job_id = ? AND call_id = ?
                """,
                (job_id, call_id),
            ).fetchone()
            if existing is not None:
                if (
                    existing["tool_name"] != tool_name
                    or existing["args_hash"] != args_hash
                ):
                    raise ToolExecutionError(
                        f"tool call ID reused with different payload: {call_id}"
                    )
                if existing["status"] == "completed":
                    return True, json.loads(existing["result_json"])
                if existing["status"] == "abandoned" and not bool(
                    existing["mutating"]
                ):
                    conn.execute(
                        """
                        UPDATE brain_tool_calls
                        SET status = 'running', error = NULL, started_at = ?,
                            ended_at = NULL
                        WHERE job_id = ? AND call_id = ?
                        """,
                        (now, job_id, call_id),
                    )
                    return False, None
                raise ToolExecutionError(
                    f"tool call is not safely replayable: {call_id} "
                    f"({existing['status']})"
                )
            conn.execute(
                """
                INSERT INTO brain_tool_calls(
                    job_id, call_id, tool_name, args_hash, arguments_json,
                    mutating, status, result_json, error, committed,
                    effect_state, started_at, ended_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'running', NULL, NULL, 0, ?, ?, NULL)
                """,
                (
                    job_id,
                    call_id,
                    tool_name,
                    args_hash,
                    canonical_json(dict(arguments)),
                    int(mutating),
                    "executing" if mutating else "finalized",
                    now,
                ),
            )
            self._insert_event(
                conn,
                job_id,
                "tool_started",
                {
                    "call_id": call_id,
                    "tool_name": tool_name,
                    "mutating": bool(mutating),
                },
            )
        return False, None

    def complete_tool_call(
        self,
        *,
        job_id: str,
        call_id: str,
        result: Any,
        committed: bool,
    ) -> None:
        self._require_owner("finalize brain tool call")
        result_json = canonical_json(result)
        now = utc_now()
        with self._tx() as conn:
            changed = conn.execute(
                """
                UPDATE brain_tool_calls
                SET status = 'completed', result_json = ?, committed = ?,
                    effect_state = 'finalized', ended_at = ?
                WHERE job_id = ? AND call_id = ? AND status = 'running'
                """,
                (result_json, int(committed), now, job_id, call_id),
            ).rowcount
            if not changed:
                raise ToolExecutionError(
                    f"tool call cannot be completed: {call_id}"
                )
            self._insert_event(
                conn,
                job_id,
                "tool_completed",
                {"call_id": call_id, "committed": bool(committed)},
            )

    def fail_tool_call(
        self, *, job_id: str, call_id: str, error: str
    ) -> None:
        self._require_owner("fail brain tool call")
        now = utc_now()
        with self._tx() as conn:
            conn.execute(
                """
                UPDATE brain_tool_calls
                SET status = 'failed', error = ?, effect_state = 'finalized',
                    ended_at = ?
                WHERE job_id = ? AND call_id = ? AND status = 'running'
                """,
                (error[:1000], now, job_id, call_id),
            )
            self._insert_event(
                conn,
                job_id,
                "tool_failed",
                {"call_id": call_id, "error": error[:500]},
            )

    def has_committed_mutation(self, job_id: str) -> bool:
        with closing(self._connect()) as conn:
            row = conn.execute(
                """
                SELECT 1 FROM brain_tool_calls
                WHERE job_id = ? AND mutating = 1 AND committed = 1
                LIMIT 1
                """,
                (job_id,),
            ).fetchone()
        return row is not None

    def events(
        self,
        *,
        after_seq: int = 0,
        job_id: str | None = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        bounded = max(1, min(int(limit), 1000))
        with closing(self._connect()) as conn:
            if job_id:
                rows = conn.execute(
                    """
                    SELECT * FROM brain_job_events
                    WHERE seq > ? AND job_id = ?
                    ORDER BY seq LIMIT ?
                    """,
                    (int(after_seq), job_id, bounded),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM brain_job_events
                    WHERE seq > ? ORDER BY seq LIMIT ?
                    """,
                    (int(after_seq), bounded),
                ).fetchall()
        return [
            {
                "seq": row["seq"],
                "job_id": row["job_id"],
                "event_type": row["event_type"],
                "payload": json.loads(row["payload_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def recover_interrupted(
        self,
        *,
        effect_reconciler: Any | None = None,
    ) -> dict[str, list[str]]:
        """Recover after process loss without replaying an uncertain mutation.

        BJ-EFFECT-001: an in-flight mutating call is reconciled against its
        durable effect before any decision. `effect_reconciler(call)` may
        return {"observed": bool, "identity": {...}} — observed effects are
        recorded as committed reconciled receipts; a probe that proves no
        effect landed makes the job safely requeueable; an unknown outcome
        stays `reconciliation_required`.
        BJ-QUEUE-001: durably queued jobs that were never submitted are
        returned for redispatch instead of stranding forever.
        """

        self._require_owner("recover interrupted brain jobs")
        queued: list[str] = []
        failed: list[str] = []
        reconciled: list[str] = []
        now = utc_now()
        with self._tx() as conn:
            jobs = conn.execute(
                """
                SELECT job_id, status FROM brain_jobs
                WHERE status IN ('running', 'cancel_requested')
                """
            ).fetchall()
            for row in jobs:
                job_id = row["job_id"]
                in_flight = conn.execute(
                    """
                    SELECT call_id, tool_name, arguments_json
                    FROM brain_tool_calls
                    WHERE job_id = ? AND mutating = 1 AND status = 'running'
                    ORDER BY started_at, call_id
                    """,
                    (job_id,),
                ).fetchall()
                committed_before = conn.execute(
                    """
                    SELECT 1 FROM brain_tool_calls
                    WHERE job_id = ? AND mutating = 1 AND committed = 1
                        AND status != 'running'
                    LIMIT 1
                    """,
                    (job_id,),
                ).fetchone()
                unresolved = False
                observed_any = bool(committed_before)
                for call in in_flight:
                    verdict = None
                    if effect_reconciler is not None:
                        try:
                            verdict = effect_reconciler(
                                {
                                    "job_id": job_id,
                                    "call_id": call["call_id"],
                                    "tool_name": call["tool_name"],
                                    "arguments": json.loads(
                                        call["arguments_json"]
                                    ),
                                }
                            )
                        except Exception:  # noqa: BLE001 - probe stays advisory
                            verdict = None
                    if verdict is not None and verdict.get("observed") is True:
                        observed_any = True
                        conn.execute(
                            """
                            UPDATE brain_tool_calls
                            SET status = 'completed', committed = 1,
                                effect_state = 'effect_observed',
                                result_json = ?, ended_at = ?
                            WHERE job_id = ? AND call_id = ?
                            """,
                            (
                                canonical_json(
                                    {
                                        "reconciled": True,
                                        "identity": dict(
                                            verdict.get("identity") or {}
                                        ),
                                    }
                                ),
                                now,
                                job_id,
                                call["call_id"],
                            ),
                        )
                        self._insert_event(
                            conn,
                            job_id,
                            "tool_reconciled",
                            {
                                "call_id": call["call_id"],
                                "observed": True,
                                "identity": dict(verdict.get("identity") or {}),
                            },
                        )
                    elif verdict is not None and verdict.get("observed") is False:
                        conn.execute(
                            """
                            UPDATE brain_tool_calls
                            SET status = 'failed', effect_state = 'finalized',
                                error = ?, ended_at = ?
                            WHERE job_id = ? AND call_id = ?
                            """,
                            (
                                "no effect observed at recovery; "
                                "safe to retry as a new call",
                                now,
                                job_id,
                                call["call_id"],
                            ),
                        )
                        self._insert_event(
                            conn,
                            job_id,
                            "tool_reconciled",
                            {"call_id": call["call_id"], "observed": False},
                        )
                    else:
                        unresolved = True
                        conn.execute(
                            """
                            UPDATE brain_tool_calls
                            SET effect_state = 'reconciliation_required'
                            WHERE job_id = ? AND call_id = ?
                            """,
                            (job_id, call["call_id"]),
                        )
                if unresolved:
                    # An unresolved call never hides a known committed effect
                    # or a cancellation: the terminal state reports both.
                    if observed_any and row["status"] == "cancel_requested":
                        status = "cancelled_after_commit"
                        error = (
                            "cancelled after a mutating tool committed; "
                            "another call still requires manual reconciliation"
                        )
                    elif observed_any:
                        status = "failed"
                        error = (
                            "a mutating effect committed; another call still "
                            "requires manual reconciliation"
                        )
                    else:
                        status = "failed"
                        error = (
                            "process stopped during a mutating tool call; "
                            "manual reconciliation is required"
                        )
                    conn.execute(
                        """
                        UPDATE brain_jobs SET status = ?, error = ?,
                            updated_at = ?, ended_at = ?
                        WHERE job_id = ?
                        """,
                        (status, error, now, now, job_id),
                    )
                    self._insert_event(conn, job_id, status, {"error": error})
                    if status == "failed":
                        failed.append(job_id)
                    continue
                if observed_any:
                    if row["status"] == "cancel_requested":
                        status = "cancelled_after_commit"
                        error = "cancelled after a mutating tool committed"
                    else:
                        status = "failed"
                        error = (
                            "mutating effect observed and reconciled; "
                            "the model conversation is not resumable"
                        )
                    conn.execute(
                        """
                        UPDATE brain_jobs SET status = ?, error = ?,
                            updated_at = ?, ended_at = ?
                        WHERE job_id = ?
                        """,
                        (status, error, now, now, job_id),
                    )
                    self._insert_event(conn, job_id, status, {"error": error})
                    if status == "failed":
                        # `failed` stays the complete failure list;
                        # `reconciled` marks the subset whose effect was
                        # observed and recorded.
                        failed.append(job_id)
                        reconciled.append(job_id)
                    continue
                if row["status"] == "cancel_requested":
                    conn.execute(
                        """
                        UPDATE brain_jobs SET status = 'cancelled',
                            updated_at = ?, ended_at = ?
                        WHERE job_id = ?
                        """,
                        (now, now, job_id),
                    )
                    self._insert_event(conn, job_id, "cancelled", {})
                    continue
                conn.execute(
                    """
                    UPDATE brain_tool_calls SET status = 'abandoned'
                    WHERE job_id = ? AND status = 'running' AND mutating = 0
                    """,
                    (job_id,),
                )
                conn.execute(
                    """
                    UPDATE brain_jobs SET status = 'queued', updated_at = ?,
                        started_at = NULL
                    WHERE job_id = ?
                    """,
                    (now, job_id),
                )
                self._insert_event(conn, job_id, "recovered_queued", {})
                queued.append(job_id)
            # BJ-QUEUE-001: durably queued rows with no runner are stranded
            # dispatch intents; return them for redispatch under this owner.
            stranded = conn.execute(
                "SELECT job_id FROM brain_jobs WHERE status = 'queued'"
            ).fetchall()
            for row in stranded:
                if row["job_id"] not in queued:
                    self._insert_event(
                        conn,
                        row["job_id"],
                        "recovered_queued",
                        {"stranded": True},
                    )
                    queued.append(row["job_id"])
        return {"queued": queued, "failed": failed, "reconciled": reconciled}

    def _initialize(self) -> None:
        with closing(self._connect()) as conn:
            conn.executescript(
                """
                PRAGMA journal_mode = WAL;
                PRAGMA foreign_keys = ON;
                CREATE TABLE IF NOT EXISTS brain_jobs(
                    job_id TEXT PRIMARY KEY,
                    idempotency_key TEXT UNIQUE,
                    config_revision_id TEXT NOT NULL,
                    toolset_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    input_json TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    result_json TEXT,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    ended_at TEXT
                );
                CREATE TABLE IF NOT EXISTS brain_job_events(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(job_id) REFERENCES brain_jobs(job_id)
                );
                CREATE INDEX IF NOT EXISTS idx_brain_job_events_job_seq
                    ON brain_job_events(job_id, seq);
                CREATE TABLE IF NOT EXISTS brain_tool_calls(
                    job_id TEXT NOT NULL,
                    call_id TEXT NOT NULL,
                    tool_name TEXT NOT NULL,
                    args_hash TEXT NOT NULL,
                    arguments_json TEXT NOT NULL,
                    mutating INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    result_json TEXT,
                    error TEXT,
                    committed INTEGER NOT NULL DEFAULT 0,
                    effect_state TEXT NOT NULL DEFAULT 'finalized',
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    PRIMARY KEY(job_id, call_id),
                    FOREIGN KEY(job_id) REFERENCES brain_jobs(job_id)
                );
                CREATE TABLE IF NOT EXISTS brain_receipts(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    receipt_id TEXT NOT NULL UNIQUE,
                    job_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(job_id) REFERENCES brain_jobs(job_id)
                );
                CREATE INDEX IF NOT EXISTS idx_brain_receipts_job
                    ON brain_receipts(job_id, created_at);
                """
            )
            columns = {
                row["name"]
                for row in conn.execute("PRAGMA table_info(brain_jobs)")
            }
            if "idempotency_key" not in columns:
                conn.execute(
                    "ALTER TABLE brain_jobs ADD COLUMN idempotency_key TEXT"
                )
            call_columns = {
                row["name"]
                for row in conn.execute("PRAGMA table_info(brain_tool_calls)")
            }
            if "effect_state" not in call_columns:
                # BJ-EFFECT-001: pre-upgrade rows are terminal or will be
                # reclassified by recovery; 'finalized' is the safe backfill.
                conn.execute(
                    """
                    ALTER TABLE brain_tool_calls
                    ADD COLUMN effect_state TEXT NOT NULL DEFAULT 'finalized'
                    """
                )
            conn.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_brain_jobs_idempotency
                ON brain_jobs(idempotency_key)
                WHERE idempotency_key IS NOT NULL
                """
            )
        try:
            os.chmod(self.path, 0o600)
            os.chmod(self.path.parent, 0o700)
        except OSError:
            pass

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 10000")
        return conn

    class _Transaction:
        def __init__(self, store: "BrainJobStore"):
            self.store = store
            self.conn: sqlite3.Connection | None = None

        def __enter__(self) -> sqlite3.Connection:
            self.store._lock.acquire()
            self.conn = self.store._connect()
            self.conn.execute("BEGIN IMMEDIATE")
            return self.conn

        def __exit__(self, exc_type, exc, tb) -> None:
            assert self.conn is not None
            try:
                self.conn.execute("ROLLBACK" if exc_type else "COMMIT")
            finally:
                self.conn.close()
                self.store._lock.release()

    def _tx(self) -> "_Transaction":
        return self._Transaction(self)

    def _insert_event(
        self,
        conn: sqlite3.Connection,
        job_id: str,
        event_type: str,
        payload: Mapping[str, Any],
    ) -> None:
        body = dict(payload)
        if self._owner is not None:
            body.setdefault("owner_epoch", self._owner.epoch)
        conn.execute(
            """
            INSERT INTO brain_job_events(
                job_id, event_type, payload_json, created_at
            ) VALUES (?, ?, ?, ?)
            """,
            (job_id, event_type, canonical_json(body), utc_now()),
        )


def _job_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "job_id": row["job_id"],
        "idempotency_key": row["idempotency_key"],
        "config_revision_id": row["config_revision_id"],
        "toolset_id": row["toolset_id"],
        "status": row["status"],
        "input": json.loads(row["input_json"]),
        "metadata": json.loads(row["metadata_json"]),
        "result": json.loads(row["result_json"])
        if row["result_json"]
        else None,
        "error": row["error"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
    }


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _optional_idempotency_key(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or len(text) > 200:
        raise JobError("Brain idempotency key is invalid")
    if any(ord(char) < 32 for char in text):
        raise JobError("Brain idempotency key is invalid")
    return text
