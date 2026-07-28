"""Transactional repositories and state machines for CactusStrudel v3."""

from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

from .db import Database


TERMINAL_JOB_STATES = frozenset(
    {"succeeded", "failed", "cancelled", "interrupted", "cancelled_after_commit"}
)

ALLOWED_JOB_TRANSITIONS: dict[str, frozenset[str]] = {
    "queued": frozenset({"running", "cancelled", "failed"}),
    "running": frozenset({"cancel_requested", "succeeded", "failed", "interrupted"}),
    "cancel_requested": frozenset(
        {"cancelled", "cancelled_after_commit", "failed", "interrupted"}
    ),
    "succeeded": frozenset(),
    "failed": frozenset(),
    "cancelled": frozenset(),
    "interrupted": frozenset(),
    "cancelled_after_commit": frozenset(),
}


class TruthError(RuntimeError):
    pass


class NotFound(TruthError):
    pass


class InvalidTransition(TruthError):
    pass


class IdempotencyConflict(TruthError):
    pass


class ReceiptConflict(TruthError):
    pass


def utc_now() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def stable_id(prefix: str) -> str:
    """Collision-resistant IDs without millisecond timestamp races."""

    return f"{prefix}_{uuid.uuid4().hex}"


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def json_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _decode_json_fields(row: sqlite3.Row | None, fields: Iterable[str]) -> dict | None:
    if row is None:
        return None
    data = dict(row)
    for field in fields:
        if field in data and data[field] is not None:
            data[field] = json.loads(data[field])
    return data


class TruthStore:
    """Small domain-oriented API over the v3 SQLite database.

    Callers never mutate rows directly.  State changes and their corresponding
    `job_events` are committed in one SQLite transaction.
    """

    def __init__(self, database: Database, *, owner=None):
        self.db = database
        self._owner = owner
        if owner is not None:
            owner.require("run schema migrations")
        self.db.initialize()

    def _require_owner(self, action: str, *, new_work: bool = False) -> None:
        """Fence mutations behind the state-root owner lease when one exists.

        A store constructed without an owner (unit tests, read-only tools) is
        outside the runtime-owner boundary; the live application always
        constructs its stores with the lease.
        """

        if self._owner is not None:
            self._owner.require(action, new_work=new_work)

    # ------------------------------------------------------------------
    # Jobs + monotonic event stream

    def create_job(
        self,
        *,
        kind: str,
        payload: Mapping[str, Any],
        idempotency_key: str,
        config_revision_id: str | None = None,
        job_id: str | None = None,
    ) -> tuple[dict, bool]:
        self._require_owner("create job", new_work=True)
        if not kind.strip():
            raise ValueError("job kind is required")
        if not idempotency_key.strip():
            raise ValueError("idempotency_key is required")
        request_sha = json_sha256(
            {
                "kind": kind,
                "payload": payload,
                "config_revision_id": config_revision_id,
            }
        )
        payload_json = canonical_json(dict(payload))
        now = utc_now()
        with self.db.transaction() as conn:
            existing = conn.execute(
                "SELECT * FROM jobs WHERE idempotency_key = ?", (idempotency_key,)
            ).fetchone()
            if existing:
                if existing["request_sha256"] != request_sha:
                    raise IdempotencyConflict(
                        "idempotency key already belongs to a different request"
                    )
                return self._job_dict(existing), False

            new_id = job_id or stable_id("job")
            conn.execute(
                """
                INSERT INTO jobs(
                    id, kind, idempotency_key, request_sha256, status,
                    payload_json, config_revision_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)
                """,
                (
                    new_id,
                    kind,
                    idempotency_key,
                    request_sha,
                    payload_json,
                    config_revision_id,
                    now,
                    now,
                ),
            )
            self._append_event(
                conn,
                job_id=new_id,
                event_type="job.created",
                payload={"kind": kind, "request_sha256": request_sha},
                now=now,
            )
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (new_id,)).fetchone()
            return self._job_dict(row), True

    def get_job(self, job_id: str) -> dict:
        with self.db.transaction(immediate=False) as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                raise NotFound(f"job not found: {job_id}")
            return self._job_dict(row)

    def list_jobs(
        self, *, status: str | None = None, kind: str | None = None, limit: int = 100
    ) -> list[dict]:
        safe_limit = min(max(int(limit), 1), 1000)
        clauses: list[str] = []
        params: list[Any] = []
        if status is not None:
            clauses.append("status = ?")
            params.append(status)
        if kind is not None:
            clauses.append("kind = ?")
            params.append(kind)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(safe_limit)
        with self.db.transaction(immediate=False) as conn:
            rows = conn.execute(
                f"""
                SELECT * FROM jobs {where}
                 ORDER BY created_at DESC, id DESC LIMIT ?
                """,
                params,
            ).fetchall()
            return [self._job_dict(row) for row in rows]

    def start_job(self, job_id: str, *, worker_id: str) -> dict:
        self._require_owner("start job", new_work=True)
        if not worker_id.strip():
            raise ValueError("worker_id is required")
        now = utc_now()
        with self.db.transaction() as conn:
            row = self._job_row(conn, job_id)
            if row["status"] == "running" and row["worker_id"] == worker_id:
                return self._job_dict(row)
            self._require_transition(row["status"], "running")
            conn.execute(
                """
                UPDATE jobs
                   SET status = 'running', worker_id = ?, attempt = attempt + 1,
                       started_at = COALESCE(started_at, ?), heartbeat_at = ?,
                       updated_at = ?
                 WHERE id = ?
                """,
                (worker_id, now, now, now, job_id),
            )
            self._append_event(
                conn,
                job_id=job_id,
                event_type="job.started",
                payload={"worker_id": worker_id, "attempt": int(row["attempt"]) + 1},
                now=now,
            )
            return self._job_dict(self._job_row(conn, job_id))

    def heartbeat(self, job_id: str, *, worker_id: str) -> dict:
        self._require_owner("heartbeat job")
        now = utc_now()
        with self.db.transaction() as conn:
            row = self._job_row(conn, job_id)
            if row["status"] not in {"running", "cancel_requested"}:
                raise InvalidTransition(
                    f"cannot heartbeat terminal/non-running job in {row['status']}"
                )
            if row["worker_id"] != worker_id:
                raise InvalidTransition("worker does not own this job")
            conn.execute(
                "UPDATE jobs SET heartbeat_at = ?, updated_at = ? WHERE id = ?",
                (now, now, job_id),
            )
            return self._job_dict(self._job_row(conn, job_id))

    def request_cancel(self, job_id: str) -> dict:
        self._require_owner("request job cancellation")
        now = utc_now()
        with self.db.transaction() as conn:
            row = self._job_row(conn, job_id)
            status = row["status"]
            if status == "queued":
                conn.execute(
                    """
                    UPDATE jobs
                       SET status = 'cancelled', cancel_requested_at = ?,
                           finished_at = ?, updated_at = ?
                     WHERE id = ?
                    """,
                    (now, now, now, job_id),
                )
                self._append_event(
                    conn,
                    job_id=job_id,
                    event_type="job.cancelled",
                    payload={"before_start": True},
                    now=now,
                )
            elif status == "running":
                conn.execute(
                    """
                    UPDATE jobs
                       SET status = 'cancel_requested', cancel_requested_at = ?,
                           updated_at = ?
                     WHERE id = ?
                    """,
                    (now, now, job_id),
                )
                self._append_event(
                    conn,
                    job_id=job_id,
                    event_type="job.cancel_requested",
                    payload={},
                    now=now,
                )
            # Repeated or late cancellation is a truthful no-op.  A completed
            # result is not retroactively relabelled as cancelled.
            return self._job_dict(self._job_row(conn, job_id))

    def cancel_requested(self, job_id: str) -> bool:
        return self.get_job(job_id)["status"] in {"cancel_requested", "cancelled"}

    def finish_job(
        self,
        job_id: str,
        *,
        status: str,
        error: Mapping[str, Any] | None = None,
    ) -> dict:
        self._require_owner("finalize job")
        if status not in {"failed", "cancelled", "interrupted"}:
            raise ValueError("finish_job only accepts failed/cancelled/interrupted")
        now = utc_now()
        with self.db.transaction() as conn:
            row = self._job_row(conn, job_id)
            if row["status"] == status:
                return self._job_dict(row)
            self._require_transition(row["status"], status)
            conn.execute(
                """
                UPDATE jobs
                   SET status = ?, error_json = ?, finished_at = ?, updated_at = ?
                 WHERE id = ?
                """,
                (
                    status,
                    canonical_json(dict(error)) if error is not None else None,
                    now,
                    now,
                    job_id,
                ),
            )
            self._append_event(
                conn,
                job_id=job_id,
                event_type=f"job.{status}",
                payload=dict(error or {}),
                now=now,
            )
            return self._job_dict(self._job_row(conn, job_id))

    def recover_interrupted_jobs(self, *, reason: str = "runtime_restart") -> list[str]:
        """Terminally mark workers that vanished across a process restart.

        Queued jobs remain runnable.  Running/cancel-requested jobs require an
        explicit retry as a new job, avoiding accidental double execution.
        """

        self._require_owner("recover interrupted jobs")
        now = utc_now()
        recovered: list[str] = []
        with self.db.transaction() as conn:
            rows = conn.execute(
                """
                SELECT * FROM jobs
                 WHERE status IN ('running', 'cancel_requested')
                 ORDER BY created_at, id
                """
            ).fetchall()
            for row in rows:
                job_id = row["id"]
                error = {
                    "reason": reason,
                    "previous_status": row["status"],
                    "worker_id": row["worker_id"],
                }
                conn.execute(
                    """
                    UPDATE jobs
                       SET status = 'interrupted', error_json = ?,
                           finished_at = ?, updated_at = ?
                     WHERE id = ?
                    """,
                    (canonical_json(error), now, now, job_id),
                )
                self._append_event(
                    conn,
                    job_id=job_id,
                    event_type="job.interrupted",
                    payload=error,
                    now=now,
                )
                recovered.append(job_id)
        return recovered

    def events_after(
        self, after_seq: int = 0, *, limit: int = 500, job_id: str | None = None
    ) -> list[dict]:
        safe_limit = min(max(int(limit), 1), 5000)
        sql = "SELECT * FROM job_events WHERE seq > ?"
        params: list[Any] = [int(after_seq)]
        if job_id is not None:
            sql += " AND job_id = ?"
            params.append(job_id)
        sql += " ORDER BY seq LIMIT ?"
        params.append(safe_limit)
        with self.db.transaction(immediate=False) as conn:
            rows = conn.execute(sql, params).fetchall()
            return [
                _decode_json_fields(row, ("payload_json",))  # type: ignore[arg-type]
                for row in rows
            ]

    def append_job_event(
        self, job_id: str, event_type: str, payload: Mapping[str, Any]
    ) -> int:
        self._require_owner("append job event")
        now = utc_now()
        with self.db.transaction() as conn:
            self._job_row(conn, job_id)
            return self._append_event(
                conn,
                job_id=job_id,
                event_type=event_type,
                payload=dict(payload),
                now=now,
            )

    # ------------------------------------------------------------------
    # Immutable piece/version registration

    def register_render_success(
        self,
        *,
        job_id: str,
        receipt: Mapping[str, Any],
        piece: Mapping[str, Any],
        version: Mapping[str, Any],
        model_run: Mapping[str, Any],
    ) -> dict:
        """Register one promoted asset receipt exactly once.

        The filesystem receipt is the commit token.  Repeating the call with
        the same job and receipt returns the existing version.  A different
        receipt for the same job is rejected instead of silently double-
        registering a piece.
        """

        self._require_owner("register rendered version")
        receipt_sha = str(receipt.get("receipt_sha256") or "")
        if len(receipt_sha) != 64:
            raise ValueError("receipt_sha256 is required")
        if str(receipt.get("job_id")) != job_id:
            raise ReceiptConflict("receipt job_id does not match registration job")
        now = utc_now()

        with self.db.transaction() as conn:
            job = self._job_row(conn, job_id)
            if job["terminal_receipt_sha256"]:
                if job["terminal_receipt_sha256"] != receipt_sha:
                    raise ReceiptConflict(
                        "job is already registered with a different receipt"
                    )
                existing = conn.execute(
                    "SELECT * FROM piece_versions WHERE id = ?",
                    (job["result_version_id"],),
                ).fetchone()
                if existing is None:
                    raise TruthError("terminal job points to a missing piece version")
                return self._version_dict(existing)

            if job["status"] not in {"running", "cancel_requested"}:
                raise InvalidTransition(
                    f"cannot register render while job is {job['status']}"
                )

            piece_id = str(piece["id"])
            version_id = str(version["id"])
            if str(receipt.get("piece_id")) != piece_id:
                raise ReceiptConflict("receipt piece_id mismatch")
            if str(receipt.get("version_id")) != version_id:
                raise ReceiptConflict("receipt version_id mismatch")

            existing_piece = conn.execute(
                "SELECT * FROM pieces WHERE id = ?", (piece_id,)
            ).fetchone()
            if existing_piece is None:
                conn.execute(
                    """
                    INSERT INTO pieces(
                        id, display_name, legacy_name, collection,
                        genre_code, genre_preset, genre_label, category,
                        tags_json, provenance_class, created_at, updated_at,
                        archived_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        piece_id,
                        piece["display_name"],
                        piece.get("legacy_name"),
                        piece.get("collection", "active"),
                        piece.get("genre_code"),
                        piece.get("genre_preset"),
                        piece.get("genre_label"),
                        piece.get("category"),
                        canonical_json(piece.get("tags", [])),
                        piece.get("provenance_class", "native"),
                        piece.get("created_at", now),
                        now,
                        piece.get("archived_at"),
                    ),
                )
            elif existing_piece["display_name"] != piece["display_name"]:
                raise ReceiptConflict("piece id already has a different display name")

            files = receipt.get("files") or {}
            audio_meta = files.get("audio.mp3") or {}
            code_meta = files.get("piece.js") or {}
            prompt_meta = files.get("prompt.json") or {}
            features_meta = files.get("features.json") or {}
            provenance = dict(version.get("provenance") or {})
            if dict(receipt.get("provenance") or {}) != provenance:
                raise ReceiptConflict(
                    "database provenance does not match the immutable asset receipt"
                )
            for field in (
                "provider_route",
                "model_id",
                "reasoning_effort",
                "orchestration",
                "kernel_hash",
                "validator_mode",
            ):
                if (
                    field in provenance
                    and field in model_run
                    and provenance[field] != model_run[field]
                ):
                    raise ReceiptConflict(
                        f"model run {field} does not match version provenance"
                    )

            conn.execute(
                """
                INSERT INTO piece_versions(
                    id, piece_id, parent_version_id, kind, state, asset_dir,
                    code_sha256, audio_sha256, duration_seconds,
                    prompt_sha256, features_sha256, receipt_sha256,
                    provenance_json, created_by_job_id, created_at, promoted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    version_id,
                    piece_id,
                    version.get("parent_version_id"),
                    version.get("kind", "original"),
                    version.get("state", "ready"),
                    receipt["asset_dir"],
                    code_meta["sha256"],
                    audio_meta["sha256"],
                    float(receipt["duration_seconds"]),
                    prompt_meta.get("sha256"),
                    features_meta.get("sha256"),
                    receipt_sha,
                    canonical_json(provenance),
                    job_id,
                    version.get("created_at", now),
                    receipt.get("promoted_at", now),
                ),
            )
            if version.get("kind", "original") != "preview":
                previous_current = (
                    existing_piece["current_version_id"] if existing_piece else None
                )
                if previous_current and previous_current != version_id:
                    conn.execute(
                        """
                        UPDATE piece_versions
                           SET state = 'superseded'
                         WHERE id = ? AND state = 'ready'
                        """,
                        (previous_current,),
                    )
                conn.execute(
                    """
                    UPDATE pieces
                       SET current_version_id = ?, updated_at = ?
                     WHERE id = ?
                    """,
                    (version_id, now, piece_id),
                )

            conn.execute(
                """
                INSERT INTO model_runs(
                    id, job_id, provider_route, model_id, reasoning_effort,
                    orchestration, kernel_hash, validator_mode,
                    request_receipt_json, response_receipt_json,
                    started_at, finished_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    model_run.get("id", stable_id("run")),
                    job_id,
                    model_run["provider_route"],
                    model_run["model_id"],
                    model_run.get("reasoning_effort"),
                    model_run.get("orchestration", "standard"),
                    model_run.get("kernel_hash"),
                    model_run.get("validator_mode", "deterministic"),
                    canonical_json(model_run.get("request_receipt", {})),
                    canonical_json(model_run.get("response_receipt", {})),
                    model_run.get("started_at"),
                    model_run.get("finished_at", now),
                    model_run.get("created_at", now),
                ),
            )

            terminal_status = (
                "cancelled_after_commit"
                if job["status"] == "cancel_requested"
                else "succeeded"
            )
            conn.execute(
                """
                UPDATE jobs
                   SET status = ?, result_version_id = ?,
                       terminal_receipt_sha256 = ?, finished_at = ?,
                       updated_at = ?
                 WHERE id = ?
                """,
                (
                    terminal_status,
                    version_id,
                    receipt_sha,
                    now,
                    now,
                    job_id,
                ),
            )
            self._append_event(
                conn,
                job_id=job_id,
                event_type=f"job.{terminal_status}",
                payload={
                    "piece_id": piece_id,
                    "version_id": version_id,
                    "receipt_sha256": receipt_sha,
                },
                now=now,
            )
            # Finalize only the intent that names this exact receipt; a
            # mismatched intent stays pending and is judged (abandoned with
            # evidence) by the next adoption pass instead of being silently
            # blessed by a different registration.
            conn.execute(
                """
                UPDATE render_commit_intents
                   SET status = 'registered', updated_at = ?
                 WHERE job_id = ? AND receipt_sha256 = ?
                   AND status IN ('pending', 'promoted')
                """,
                (now, job_id, receipt_sha),
            )
            row = conn.execute(
                "SELECT * FROM piece_versions WHERE id = ?", (version_id,)
            ).fetchone()
            return self._version_dict(row)

    # ------------------------------------------------------------------
    # Render commit intents (DT-001)

    def create_commit_intent(
        self,
        *,
        job_id: str,
        receipt: Mapping[str, Any],
        registration: Mapping[str, Any],
        owner_epoch: int | None = None,
    ) -> dict:
        """Persist the exact receipt/registration a promote is about to commit.

        The intent is the durable bridge across the filesystem-promote /
        database-register boundary: recovery adopts a promoted directory only
        when its receipt matches this intent byte-for-byte.
        """

        self._require_owner("persist render commit intent")
        receipt_sha = str(receipt.get("receipt_sha256") or "")
        if len(receipt_sha) != 64:
            raise ValueError("commit intent requires the exact receipt_sha256")
        if str(receipt.get("job_id")) != job_id:
            raise ReceiptConflict("commit intent receipt job_id mismatch")
        recorded_receipt = (
            registration.get("receipt")
            if isinstance(registration, Mapping)
            else None
        )
        if not isinstance(recorded_receipt, Mapping) or canonical_json(
            dict(recorded_receipt)
        ) != canonical_json(dict(receipt)):
            raise ReceiptConflict(
                "commit intent registration must embed the exact receipt"
            )
        now = utc_now()
        with self.db.transaction() as conn:
            job = self._job_row(conn, job_id)
            if job["status"] not in {"running", "cancel_requested"}:
                raise InvalidTransition(
                    f"cannot persist commit intent while job is {job['status']}"
                )
            existing = conn.execute(
                "SELECT * FROM render_commit_intents WHERE job_id = ?",
                (job_id,),
            ).fetchone()
            if existing is not None:
                if existing["receipt_sha256"] != receipt_sha:
                    raise ReceiptConflict(
                        "job already has a commit intent for a different receipt"
                    )
                return _decode_json_fields(existing, ("registration_json",))  # type: ignore[return-value]
            conn.execute(
                """
                INSERT INTO render_commit_intents(
                    job_id, piece_id, version_id, asset_dir, receipt_sha256,
                    registration_json, status, owner_epoch, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
                """,
                (
                    job_id,
                    str(receipt["piece_id"]),
                    str(receipt["version_id"]),
                    str(receipt["asset_dir"]),
                    receipt_sha,
                    canonical_json(dict(registration)),
                    owner_epoch,
                    now,
                    now,
                ),
            )
            self._append_event(
                conn,
                job_id=job_id,
                event_type="render.commit_intent",
                payload={
                    "receipt_sha256": receipt_sha,
                    "piece_id": str(receipt["piece_id"]),
                    "version_id": str(receipt["version_id"]),
                },
                now=now,
            )
            row = conn.execute(
                "SELECT * FROM render_commit_intents WHERE job_id = ?",
                (job_id,),
            ).fetchone()
            return _decode_json_fields(row, ("registration_json",))  # type: ignore[return-value]

    def mark_commit_intent(self, job_id: str, *, status: str) -> None:
        if status not in {"promoted", "abandoned"}:
            raise ValueError("commit intent may only be marked promoted/abandoned")
        self._require_owner("update render commit intent")
        now = utc_now()
        with self.db.transaction() as conn:
            allowed_from = "'pending'" if status == "promoted" else "'pending', 'promoted'"
            conn.execute(
                f"""
                UPDATE render_commit_intents
                   SET status = ?, updated_at = ?
                 WHERE job_id = ? AND status IN ({allowed_from})
                """,
                (status, now, job_id),
            )

    def list_commit_intents(
        self, *, statuses: tuple[str, ...] = ("pending", "promoted")
    ) -> list[dict]:
        placeholders = ",".join("?" for _ in statuses)
        with self.db.transaction(immediate=False) as conn:
            rows = conn.execute(
                f"""
                SELECT * FROM render_commit_intents
                 WHERE status IN ({placeholders})
                 ORDER BY created_at, job_id
                """,
                tuple(statuses),
            ).fetchall()
            return [
                _decode_json_fields(row, ("registration_json",))  # type: ignore[misc]
                for row in rows
            ]

    def get_piece(self, piece_id: str) -> dict:
        with self.db.transaction(immediate=False) as conn:
            row = conn.execute(
                "SELECT * FROM pieces WHERE id = ?", (piece_id,)
            ).fetchone()
            if row is None:
                raise NotFound(f"piece not found: {piece_id}")
            return _decode_json_fields(row, ("tags_json",))  # type: ignore[return-value]

    def get_piece_by_name(self, display_name: str) -> dict:
        with self.db.transaction(immediate=False) as conn:
            row = conn.execute(
                "SELECT * FROM pieces WHERE display_name = ?", (display_name,)
            ).fetchone()
            if row is None:
                raise NotFound(f"piece not found: {display_name}")
            return _decode_json_fields(row, ("tags_json",))  # type: ignore[return-value]

    def list_pieces(
        self,
        *,
        collection: str | None = None,
        include_archived: bool = False,
        limit: int = 100,
        before_created_at: str | None = None,
    ) -> list[dict]:
        safe_limit = min(max(int(limit), 1), 1000)
        clauses: list[str] = []
        params: list[Any] = []
        if collection is not None:
            clauses.append("p.collection = ?")
            params.append(collection)
        if not include_archived:
            clauses.append("p.archived_at IS NULL")
        if before_created_at is not None:
            clauses.append("p.created_at < ?")
            params.append(before_created_at)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(safe_limit)
        with self.db.transaction(immediate=False) as conn:
            rows = conn.execute(
                f"""
                SELECT p.*,
                       v.audio_sha256 AS current_audio_sha256,
                       v.duration_seconds AS current_duration_seconds,
                       v.asset_dir AS current_asset_dir,
                       (
                         SELECT r.score FROM ratings r
                          WHERE r.piece_version_id = p.current_version_id
                          ORDER BY r.rowid DESC LIMIT 1
                       ) AS current_score
                  FROM pieces p
                  LEFT JOIN piece_versions v ON v.id = p.current_version_id
                  {where}
                 ORDER BY p.created_at DESC, p.id DESC
                 LIMIT ?
                """,
                params,
            ).fetchall()
            return [
                _decode_json_fields(row, ("tags_json",))  # type: ignore[arg-type]
                for row in rows
            ]

    def list_versions(self, piece_id: str) -> list[dict]:
        with self.db.transaction(immediate=False) as conn:
            if (
                conn.execute(
                    "SELECT 1 FROM pieces WHERE id = ?", (piece_id,)
                ).fetchone()
                is None
            ):
                raise NotFound(f"piece not found: {piece_id}")
            rows = conn.execute(
                """
                SELECT v.*,
                       (
                         SELECT r.score FROM ratings r
                          WHERE r.piece_version_id = v.id
                          ORDER BY r.rowid DESC LIMIT 1
                       ) AS current_score
                  FROM piece_versions v
                 WHERE v.piece_id = ?
                 ORDER BY v.created_at, v.id
                """,
                (piece_id,),
            ).fetchall()
            return [self._version_dict(row) for row in rows]

    def set_piece_archived(self, piece_id: str, *, archived: bool) -> dict:
        self._require_owner("archive piece")
        now = utc_now()
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM pieces WHERE id = ?", (piece_id,)
            ).fetchone()
            if row is None:
                raise NotFound(f"piece not found: {piece_id}")
            archived_at = now if archived else None
            if row["archived_at"] == archived_at or (
                archived and row["archived_at"] is not None
            ):
                return _decode_json_fields(row, ("tags_json",))  # type: ignore[return-value]
            conn.execute(
                "UPDATE pieces SET archived_at = ?, updated_at = ? WHERE id = ?",
                (archived_at, now, piece_id),
            )
            self._append_event(
                conn,
                job_id=None,
                event_type="piece.archived" if archived else "piece.restored",
                payload={"piece_id": piece_id},
                now=now,
            )
            updated = conn.execute(
                "SELECT * FROM pieces WHERE id = ?", (piece_id,)
            ).fetchone()
            return _decode_json_fields(updated, ("tags_json",))  # type: ignore[return-value]

    def promote_version(self, *, piece_id: str, version_id: str) -> dict:
        """Make an immutable preview/revision the piece's audible current version."""

        self._require_owner("promote version")
        now = utc_now()
        with self.db.transaction() as conn:
            piece = conn.execute(
                "SELECT * FROM pieces WHERE id = ?", (piece_id,)
            ).fetchone()
            if piece is None:
                raise NotFound(f"piece not found: {piece_id}")
            version = conn.execute(
                """
                SELECT * FROM piece_versions
                 WHERE id = ? AND piece_id = ?
                """,
                (version_id, piece_id),
            ).fetchone()
            if version is None:
                raise NotFound(
                    f"piece version not found for piece: {piece_id}/{version_id}"
                )
            if piece["current_version_id"] == version_id:
                return self._version_dict(version)
            if piece["current_version_id"]:
                conn.execute(
                    """
                    UPDATE piece_versions
                       SET state = 'superseded'
                     WHERE id = ? AND state = 'ready'
                    """,
                    (piece["current_version_id"],),
                )
            conn.execute(
                """
                UPDATE piece_versions
                   SET kind = CASE WHEN kind = 'preview' THEN 'revision' ELSE kind END,
                       state = CASE WHEN state = 'superseded' THEN 'ready' ELSE state END
                 WHERE id = ?
                """,
                (version_id,),
            )
            conn.execute(
                """
                UPDATE pieces
                   SET current_version_id = ?, updated_at = ?
                 WHERE id = ?
                """,
                (version_id, now, piece_id),
            )
            self._append_event(
                conn,
                job_id=None,
                event_type="piece.version_promoted",
                payload={"piece_id": piece_id, "version_id": version_id},
                now=now,
            )
            return self._version_dict(
                conn.execute(
                    "SELECT * FROM piece_versions WHERE id = ?", (version_id,)
                ).fetchone()
            )

    def get_version(self, version_id: str) -> dict:
        with self.db.transaction(immediate=False) as conn:
            row = conn.execute(
                "SELECT * FROM piece_versions WHERE id = ?", (version_id,)
            ).fetchone()
            if row is None:
                raise NotFound(f"piece version not found: {version_id}")
            return self._version_dict(row)

    def rate_version(
        self,
        *,
        piece_version_id: str,
        audio_sha256: str,
        score: float,
        note: str | None = None,
        source_key: str | None = None,
        created_at: str | None = None,
    ) -> dict:
        self._require_owner("rate version")
        numeric = float(score)
        if not math.isfinite(numeric) or not 0.0 <= numeric <= 10.0:
            raise ValueError("score must be a finite number from 0 to 10")
        now = utc_now()
        with self.db.transaction() as conn:
            version = conn.execute(
                "SELECT * FROM piece_versions WHERE id = ?", (piece_version_id,)
            ).fetchone()
            if version is None:
                raise NotFound(f"piece version not found: {piece_version_id}")
            if version["audio_sha256"] != audio_sha256:
                raise ReceiptConflict(
                    "rating audio sha does not match the selected piece version"
                )
            if source_key is not None:
                existing = conn.execute(
                    "SELECT * FROM ratings WHERE source_key = ?", (source_key,)
                ).fetchone()
                if existing:
                    if (
                        existing["piece_version_id"] != piece_version_id
                        or existing["audio_sha256"] != audio_sha256
                        or float(existing["score"]) != numeric
                        or existing["note"] != note
                    ):
                        raise IdempotencyConflict(
                            "rating source key belongs to different evidence"
                        )
                    return dict(existing)
            previous = conn.execute(
                """
                SELECT id FROM ratings
                 WHERE piece_version_id = ?
                 ORDER BY rowid DESC LIMIT 1
                """,
                (piece_version_id,),
            ).fetchone()
            rating_id = stable_id("rating")
            conn.execute(
                """
                INSERT INTO ratings(
                    id, piece_version_id, audio_sha256, score, note,
                    created_at, supersedes_id, source_key
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rating_id,
                    piece_version_id,
                    audio_sha256,
                    numeric,
                    note,
                    created_at or now,
                    previous["id"] if previous else None,
                    source_key,
                ),
            )
            row = conn.execute(
                "SELECT * FROM ratings WHERE id = ?", (rating_id,)
            ).fetchone()
            self._append_event(
                conn,
                job_id=None,
                event_type="rating.created",
                payload={
                    "rating_id": rating_id,
                    "piece_version_id": piece_version_id,
                    "audio_sha256": audio_sha256,
                    "score": numeric,
                },
                now=now,
            )
            return dict(row)

    # ------------------------------------------------------------------
    # Settings history / tested apply contract

    def create_settings_revision(
        self,
        *,
        config: Mapping[str, Any],
        source: str,
        fingerprint: str | None = None,
    ) -> tuple[dict, bool]:
        self._require_owner("create settings revision")
        config_dict = dict(config)
        actual_fingerprint = fingerprint or json_sha256(config_dict)
        revision_id = stable_id("settings")
        now = utc_now()
        with self.db.transaction() as conn:
            existing = conn.execute(
                "SELECT * FROM settings_revisions WHERE fingerprint = ?",
                (actual_fingerprint,),
            ).fetchone()
            if existing:
                if json.loads(existing["config_json"]) != config_dict:
                    raise IdempotencyConflict(
                        "settings fingerprint belongs to different config"
                    )
                return _decode_json_fields(existing, ("config_json",)), False  # type: ignore[return-value]
            conn.execute(
                """
                INSERT INTO settings_revisions(
                    id, fingerprint, config_json, source, status, created_at
                ) VALUES (?, ?, ?, ?, 'draft', ?)
                """,
                (
                    revision_id,
                    actual_fingerprint,
                    canonical_json(config_dict),
                    source,
                    now,
                ),
            )
            self._append_event(
                conn,
                job_id=None,
                event_type="settings.revision_created",
                payload={
                    "settings_revision_id": revision_id,
                    "fingerprint": actual_fingerprint,
                },
                now=now,
            )
            row = conn.execute(
                "SELECT * FROM settings_revisions WHERE id = ?", (revision_id,)
            ).fetchone()
            return _decode_json_fields(row, ("config_json",)), True  # type: ignore[return-value]

    def record_settings_test(
        self,
        *,
        settings_revision_id: str,
        fingerprint: str,
        model_id: str,
        effort: str | None,
        orchestration: str,
        ok: bool,
        response_receipt: Mapping[str, Any],
        latency_ms: int | None = None,
    ) -> dict:
        self._require_owner("record settings test")
        now = utc_now()
        with self.db.transaction() as conn:
            revision = conn.execute(
                "SELECT * FROM settings_revisions WHERE id = ?",
                (settings_revision_id,),
            ).fetchone()
            if revision is None:
                raise NotFound(f"settings revision not found: {settings_revision_id}")
            if revision["fingerprint"] != fingerprint:
                raise ReceiptConflict("settings test fingerprint is stale")
            test_id = stable_id("settings_test")
            conn.execute(
                """
                INSERT INTO settings_tests(
                    id, settings_revision_id, fingerprint, model_id, effort,
                    orchestration, ok, latency_ms, response_receipt_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    test_id,
                    settings_revision_id,
                    fingerprint,
                    model_id,
                    effort,
                    orchestration,
                    int(bool(ok)),
                    latency_ms,
                    canonical_json(dict(response_receipt)),
                    now,
                ),
            )
            if ok:
                conn.execute(
                    """
                    UPDATE settings_revisions
                       SET status = CASE WHEN status = 'draft' THEN 'tested' ELSE status END
                     WHERE id = ?
                    """,
                    (settings_revision_id,),
                )
            self._append_event(
                conn,
                job_id=None,
                event_type="settings.test_completed",
                payload={
                    "settings_revision_id": settings_revision_id,
                    "test_id": test_id,
                    "fingerprint": fingerprint,
                    "ok": bool(ok),
                },
                now=now,
            )
            row = conn.execute(
                "SELECT * FROM settings_tests WHERE id = ?", (test_id,)
            ).fetchone()
            return _decode_json_fields(row, ("response_receipt_json",))  # type: ignore[return-value]

    def activate_settings_revision(
        self, *, settings_revision_id: str, test_id: str
    ) -> dict:
        self._require_owner("activate settings revision")
        now = utc_now()
        with self.db.transaction() as conn:
            revision = conn.execute(
                "SELECT * FROM settings_revisions WHERE id = ?",
                (settings_revision_id,),
            ).fetchone()
            if revision is None:
                raise NotFound(f"settings revision not found: {settings_revision_id}")
            test = conn.execute(
                """
                SELECT * FROM settings_tests
                 WHERE id = ? AND settings_revision_id = ?
                """,
                (test_id, settings_revision_id),
            ).fetchone()
            if test is None or not bool(test["ok"]):
                raise ReceiptConflict("a passing test for this revision is required")
            if test["fingerprint"] != revision["fingerprint"]:
                raise ReceiptConflict(
                    "settings test does not match revision fingerprint"
                )
            conn.execute(
                """
                UPDATE settings_revisions
                   SET status = 'retired'
                 WHERE status = 'active' AND id <> ?
                """,
                (settings_revision_id,),
            )
            conn.execute(
                """
                UPDATE settings_revisions
                   SET status = 'active', activated_at = ?
                 WHERE id = ?
                """,
                (now, settings_revision_id),
            )
            self._append_event(
                conn,
                job_id=None,
                event_type="settings.activated",
                payload={
                    "settings_revision_id": settings_revision_id,
                    "test_id": test_id,
                    "fingerprint": revision["fingerprint"],
                },
                now=now,
            )
            row = conn.execute(
                "SELECT * FROM settings_revisions WHERE id = ?",
                (settings_revision_id,),
            ).fetchone()
            return _decode_json_fields(row, ("config_json",))  # type: ignore[return-value]

    def active_settings_revision(self) -> dict | None:
        with self.db.transaction(immediate=False) as conn:
            row = conn.execute(
                """
                SELECT * FROM settings_revisions
                 WHERE status = 'active'
                 ORDER BY activated_at DESC, id DESC LIMIT 1
                """
            ).fetchone()
            return _decode_json_fields(row, ("config_json",))

    # ------------------------------------------------------------------
    # Brain transcript + idempotent tool calls

    def create_brain_session(
        self,
        *,
        title: str | None = None,
        piece_id: str | None = None,
        pinned_version_id: str | None = None,
        config_revision_id: str | None = None,
    ) -> dict:
        self._require_owner("create brain session", new_work=True)
        session_id = stable_id("brain_session")
        now = utc_now()
        with self.db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO brain_sessions(
                    id, title, piece_id, pinned_version_id, config_revision_id,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    title,
                    piece_id,
                    pinned_version_id,
                    config_revision_id,
                    now,
                    now,
                ),
            )
            self._append_event(
                conn,
                job_id=None,
                event_type="brain.session_created",
                payload={"session_id": session_id, "piece_id": piece_id},
                now=now,
            )
            return dict(
                conn.execute(
                    "SELECT * FROM brain_sessions WHERE id = ?", (session_id,)
                ).fetchone()
            )

    def append_brain_turn(
        self,
        *,
        session_id: str,
        role: str,
        content: Mapping[str, Any] | list[Any] | str,
        job_id: str | None = None,
    ) -> dict:
        self._require_owner("append brain turn")
        if role not in {"user", "assistant", "tool"}:
            raise ValueError("invalid brain turn role")
        now = utc_now()
        turn_id = stable_id("brain_turn")
        with self.db.transaction() as conn:
            session = conn.execute(
                "SELECT id FROM brain_sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if session is None:
                raise NotFound(f"brain session not found: {session_id}")
            row = conn.execute(
                """
                SELECT COALESCE(MAX(ordinal), 0) + 1 AS next_ordinal
                  FROM brain_turns WHERE session_id = ?
                """,
                (session_id,),
            ).fetchone()
            ordinal = int(row["next_ordinal"])
            conn.execute(
                """
                INSERT INTO brain_turns(
                    id, session_id, job_id, role, content_json, ordinal, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    turn_id,
                    session_id,
                    job_id,
                    role,
                    canonical_json(content),
                    ordinal,
                    now,
                ),
            )
            conn.execute(
                "UPDATE brain_sessions SET updated_at = ? WHERE id = ?",
                (now, session_id),
            )
            self._append_event(
                conn,
                job_id=job_id,
                event_type="brain.turn_created",
                payload={
                    "session_id": session_id,
                    "turn_id": turn_id,
                    "role": role,
                    "ordinal": ordinal,
                },
                now=now,
            )
            turn = conn.execute(
                "SELECT * FROM brain_turns WHERE id = ?", (turn_id,)
            ).fetchone()
            return _decode_json_fields(turn, ("content_json",))  # type: ignore[return-value]

    def list_brain_turns(
        self, session_id: str, *, after_ordinal: int = 0
    ) -> list[dict]:
        with self.db.transaction(immediate=False) as conn:
            if (
                conn.execute(
                    "SELECT 1 FROM brain_sessions WHERE id = ?", (session_id,)
                ).fetchone()
                is None
            ):
                raise NotFound(f"brain session not found: {session_id}")
            rows = conn.execute(
                """
                SELECT * FROM brain_turns
                 WHERE session_id = ? AND ordinal > ?
                 ORDER BY ordinal
                """,
                (session_id, int(after_ordinal)),
            ).fetchall()
            return [
                _decode_json_fields(row, ("content_json",))  # type: ignore[arg-type]
                for row in rows
            ]

    def create_tool_call(
        self,
        *,
        turn_id: str,
        idempotency_key: str,
        tool_name: str,
        arguments: Mapping[str, Any],
        upstream_call_id: str | None = None,
    ) -> tuple[dict, bool]:
        self._require_owner("create tool call", new_work=True)
        args_json = canonical_json(dict(arguments))
        now = utc_now()
        with self.db.transaction() as conn:
            existing = conn.execute(
                "SELECT * FROM tool_calls WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if existing:
                if (
                    existing["tool_name"] != tool_name
                    or existing["arguments_json"] != args_json
                ):
                    raise IdempotencyConflict(
                        "tool idempotency key belongs to another call"
                    )
                return self._tool_call_dict(existing), False
            call_id = stable_id("tool_call")
            conn.execute(
                """
                INSERT INTO tool_calls(
                    id, turn_id, upstream_call_id, idempotency_key, tool_name,
                    arguments_json, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
                """,
                (
                    call_id,
                    turn_id,
                    upstream_call_id,
                    idempotency_key,
                    tool_name,
                    args_json,
                    now,
                    now,
                ),
            )
            self._append_event(
                conn,
                job_id=None,
                event_type="brain.tool_call_created",
                payload={
                    "tool_call_id": call_id,
                    "turn_id": turn_id,
                    "tool_name": tool_name,
                },
                now=now,
            )
            row = conn.execute(
                "SELECT * FROM tool_calls WHERE id = ?", (call_id,)
            ).fetchone()
            return self._tool_call_dict(row), True

    def start_tool_call(self, call_id: str) -> dict:
        self._require_owner("start tool call", new_work=True)
        now = utc_now()
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM tool_calls WHERE id = ?", (call_id,)
            ).fetchone()
            if row is None:
                raise NotFound(f"tool call not found: {call_id}")
            if row["status"] == "running":
                return self._tool_call_dict(row)
            if row["status"] != "proposed":
                raise InvalidTransition(
                    f"cannot start tool call while it is {row['status']}"
                )
            conn.execute(
                "UPDATE tool_calls SET status = 'running', updated_at = ? WHERE id = ?",
                (now, call_id),
            )
            self._append_event(
                conn,
                job_id=None,
                event_type="brain.tool_call_started",
                payload={"tool_call_id": call_id},
                now=now,
            )
            return self._tool_call_dict(
                conn.execute(
                    "SELECT * FROM tool_calls WHERE id = ?", (call_id,)
                ).fetchone()
            )

    def complete_tool_call(
        self,
        call_id: str,
        *,
        status: str,
        result: Mapping[str, Any],
        committed: bool = False,
    ) -> dict:
        self._require_owner("finalize tool call")
        if status not in {"succeeded", "failed", "cancelled"}:
            raise ValueError("invalid terminal tool-call status")
        now = utc_now()
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM tool_calls WHERE id = ?", (call_id,)
            ).fetchone()
            if row is None:
                raise NotFound(f"tool call not found: {call_id}")
            if row["status"] in {"succeeded", "failed", "cancelled"}:
                existing_result = (
                    json.loads(row["result_json"]) if row["result_json"] else {}
                )
                if row["status"] != status or existing_result != dict(result):
                    raise IdempotencyConflict(
                        "tool call is already terminal with another result"
                    )
                return self._tool_call_dict(row)
            conn.execute(
                """
                UPDATE tool_calls
                   SET status = ?, result_json = ?, committed_at = ?, updated_at = ?
                 WHERE id = ?
                """,
                (
                    status,
                    canonical_json(dict(result)),
                    now if committed else None,
                    now,
                    call_id,
                ),
            )
            self._append_event(
                conn,
                job_id=None,
                event_type=f"brain.tool_call_{status}",
                payload={
                    "tool_call_id": call_id,
                    "committed": bool(committed),
                },
                now=now,
            )
            return self._tool_call_dict(
                conn.execute(
                    "SELECT * FROM tool_calls WHERE id = ?", (call_id,)
                ).fetchone()
            )

    # ------------------------------------------------------------------
    # Internals

    @staticmethod
    def _require_transition(current: str, target: str) -> None:
        if target not in ALLOWED_JOB_TRANSITIONS.get(current, frozenset()):
            raise InvalidTransition(f"invalid job transition: {current} -> {target}")

    def _append_event(
        self,
        conn: sqlite3.Connection,
        *,
        job_id: str | None,
        event_type: str,
        payload: Mapping[str, Any],
        now: str,
    ) -> int:
        body = dict(payload)
        if self._owner is not None:
            # Durable attribution: which owner epoch performed this transition.
            body.setdefault("owner_epoch", self._owner.epoch)
        cursor = conn.execute(
            """
            INSERT INTO job_events(job_id, event_type, payload_json, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (job_id, event_type, canonical_json(body), now),
        )
        return int(cursor.lastrowid)

    @staticmethod
    def _job_row(conn: sqlite3.Connection, job_id: str) -> sqlite3.Row:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise NotFound(f"job not found: {job_id}")
        return row

    @staticmethod
    def _job_dict(row: sqlite3.Row) -> dict:
        return _decode_json_fields(row, ("payload_json", "error_json"))  # type: ignore[return-value]

    @staticmethod
    def _version_dict(row: sqlite3.Row) -> dict:
        return _decode_json_fields(row, ("provenance_json",))  # type: ignore[return-value]

    @staticmethod
    def _tool_call_dict(row: sqlite3.Row) -> dict:
        return _decode_json_fields(row, ("arguments_json", "result_json"))  # type: ignore[return-value]
