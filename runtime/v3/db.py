"""SQLite foundation for the CactusStrudel v3 operational truth layer.

The live v2 JSONL files remain untouched.  This database owns mutable runtime
state; immutable musical assets continue to live on disk and are referenced by
content receipts.
"""

from __future__ import annotations

import contextlib
import sqlite3
from pathlib import Path
from typing import Iterator


SCHEMA_VERSION = 3


MIGRATION_1 = r"""
CREATE TABLE IF NOT EXISTS pieces (
    id                  TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL UNIQUE,
    legacy_name         TEXT,
    collection          TEXT NOT NULL DEFAULT 'active',
    genre_code          TEXT,
    genre_preset        TEXT,
    genre_label         TEXT,
    category            TEXT,
    tags_json           TEXT NOT NULL DEFAULT '[]',
    current_version_id  TEXT,
    provenance_class    TEXT NOT NULL DEFAULT 'native',
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    archived_at         TEXT,
    FOREIGN KEY (current_version_id) REFERENCES piece_versions(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS piece_versions (
    id                  TEXT PRIMARY KEY,
    piece_id            TEXT NOT NULL REFERENCES pieces(id) ON DELETE RESTRICT,
    parent_version_id   TEXT REFERENCES piece_versions(id) ON DELETE RESTRICT,
    kind                TEXT NOT NULL CHECK (
                            kind IN ('original', 'preview', 'revision', 'legacy')
                        ),
    state               TEXT NOT NULL DEFAULT 'ready'
                            CHECK (state IN ('ready', 'superseded', 'legacy_partial')),
    asset_dir           TEXT NOT NULL UNIQUE,
    code_sha256         TEXT NOT NULL,
    audio_sha256        TEXT NOT NULL,
    duration_seconds    REAL NOT NULL CHECK (duration_seconds > 0),
    prompt_sha256       TEXT,
    features_sha256     TEXT,
    receipt_sha256      TEXT NOT NULL UNIQUE,
    provenance_json     TEXT NOT NULL,
    created_by_job_id   TEXT UNIQUE,
    created_at          TEXT NOT NULL,
    promoted_at         TEXT NOT NULL,
    FOREIGN KEY (created_by_job_id) REFERENCES jobs(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS ratings (
    id                  TEXT PRIMARY KEY,
    piece_version_id    TEXT NOT NULL REFERENCES piece_versions(id) ON DELETE RESTRICT,
    audio_sha256        TEXT NOT NULL,
    score               REAL NOT NULL CHECK (score >= 0.0 AND score <= 10.0),
    note                TEXT,
    created_at          TEXT NOT NULL,
    supersedes_id       TEXT REFERENCES ratings(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS settings_revisions (
    id                  TEXT PRIMARY KEY,
    fingerprint         TEXT NOT NULL UNIQUE,
    config_json         TEXT NOT NULL,
    source              TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'tested', 'active', 'retired')),
    created_at          TEXT NOT NULL,
    activated_at        TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS settings_tests (
    id                  TEXT PRIMARY KEY,
    settings_revision_id TEXT NOT NULL
                            REFERENCES settings_revisions(id) ON DELETE RESTRICT,
    fingerprint         TEXT NOT NULL,
    model_id            TEXT NOT NULL,
    effort              TEXT,
    orchestration       TEXT NOT NULL DEFAULT 'standard',
    ok                  INTEGER NOT NULL CHECK (ok IN (0, 1)),
    latency_ms          INTEGER,
    response_receipt_json TEXT NOT NULL,
    created_at          TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS jobs (
    id                  TEXT PRIMARY KEY,
    kind                TEXT NOT NULL,
    idempotency_key     TEXT NOT NULL UNIQUE,
    request_sha256      TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (
                            status IN (
                                'queued', 'running', 'cancel_requested',
                                'succeeded', 'failed', 'cancelled',
                                'interrupted', 'cancelled_after_commit'
                            )
                        ),
    payload_json        TEXT NOT NULL,
    config_revision_id  TEXT REFERENCES settings_revisions(id) ON DELETE RESTRICT,
    worker_id           TEXT,
    attempt             INTEGER NOT NULL DEFAULT 0,
    heartbeat_at        TEXT,
    cancel_requested_at TEXT,
    started_at          TEXT,
    finished_at         TEXT,
    result_version_id   TEXT,
    terminal_receipt_sha256 TEXT,
    error_json          TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    FOREIGN KEY (result_version_id) REFERENCES piece_versions(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS job_events (
    seq                 INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id              TEXT REFERENCES jobs(id) ON DELETE CASCADE,
    event_type          TEXT NOT NULL,
    payload_json        TEXT NOT NULL,
    created_at          TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS model_runs (
    id                  TEXT PRIMARY KEY,
    job_id              TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
    provider_route      TEXT NOT NULL,
    model_id            TEXT NOT NULL,
    reasoning_effort    TEXT,
    orchestration       TEXT NOT NULL DEFAULT 'standard',
    kernel_hash         TEXT,
    validator_mode      TEXT NOT NULL DEFAULT 'deterministic',
    request_receipt_json TEXT NOT NULL,
    response_receipt_json TEXT NOT NULL,
    started_at          TEXT,
    finished_at         TEXT,
    created_at          TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS brain_sessions (
    id                  TEXT PRIMARY KEY,
    title               TEXT,
    piece_id            TEXT REFERENCES pieces(id) ON DELETE SET NULL,
    pinned_version_id   TEXT REFERENCES piece_versions(id) ON DELETE SET NULL,
    config_revision_id  TEXT REFERENCES settings_revisions(id) ON DELETE RESTRICT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    closed_at           TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS brain_turns (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL REFERENCES brain_sessions(id) ON DELETE CASCADE,
    job_id              TEXT REFERENCES jobs(id) ON DELETE SET NULL,
    role                TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content_json        TEXT NOT NULL,
    ordinal             INTEGER NOT NULL,
    created_at          TEXT NOT NULL,
    UNIQUE (session_id, ordinal)
) STRICT;

CREATE TABLE IF NOT EXISTS tool_calls (
    id                  TEXT PRIMARY KEY,
    turn_id             TEXT NOT NULL REFERENCES brain_turns(id) ON DELETE CASCADE,
    upstream_call_id    TEXT,
    idempotency_key     TEXT NOT NULL UNIQUE,
    tool_name           TEXT NOT NULL,
    arguments_json      TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (
                            status IN ('proposed', 'running', 'succeeded', 'failed', 'cancelled')
                        ),
    result_json         TEXT,
    committed_at        TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_piece_versions_piece_created
    ON piece_versions(piece_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ratings_version_created
    ON ratings(piece_version_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created
    ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_job_events_job_seq
    ON job_events(job_id, seq);
CREATE INDEX IF NOT EXISTS idx_job_events_created
    ON job_events(created_at);
CREATE INDEX IF NOT EXISTS idx_brain_turns_session_ordinal
    ON brain_turns(session_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_settings_tests_revision_created
    ON settings_tests(settings_revision_id, created_at);

CREATE TRIGGER IF NOT EXISTS trg_piece_current_version_belongs_to_piece
BEFORE UPDATE OF current_version_id ON pieces
WHEN NEW.current_version_id IS NOT NULL
 AND NOT EXISTS (
    SELECT 1 FROM piece_versions
     WHERE id = NEW.current_version_id AND piece_id = NEW.id
 )
BEGIN
    SELECT RAISE(ABORT, 'current version does not belong to piece');
END;

CREATE TRIGGER IF NOT EXISTS trg_rating_audio_matches_version
BEFORE INSERT ON ratings
WHEN NOT EXISTS (
    SELECT 1 FROM piece_versions
     WHERE id = NEW.piece_version_id AND audio_sha256 = NEW.audio_sha256
)
BEGIN
    SELECT RAISE(ABORT, 'rating audio sha does not match piece version');
END;
"""

MIGRATION_2 = r"""
ALTER TABLE ratings ADD COLUMN source_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_source_key
    ON ratings(source_key) WHERE source_key IS NOT NULL;
"""

MIGRATION_3 = r"""
CREATE TABLE IF NOT EXISTS render_commit_intents (
    job_id              TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE RESTRICT,
    piece_id            TEXT NOT NULL,
    version_id          TEXT NOT NULL UNIQUE,
    asset_dir           TEXT NOT NULL,
    receipt_sha256      TEXT NOT NULL UNIQUE,
    registration_json   TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (
                            status IN ('pending', 'promoted', 'registered', 'abandoned')
                        ),
    owner_epoch         INTEGER,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_render_commit_intents_status
    ON render_commit_intents(status, created_at);
"""


MIGRATIONS: tuple[tuple[int, str], ...] = (
    (1, MIGRATION_1),
    (2, MIGRATION_2),
    (3, MIGRATION_3),
)


class Database:
    """Connection factory plus ordered, idempotent schema migrations."""

    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser().resolve()

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(
            self.path,
            timeout=10.0,
            isolation_level=None,
            check_same_thread=False,
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 10000")
        try:
            conn.execute("PRAGMA journal_mode = WAL")
        except sqlite3.OperationalError as exc:
            # A sibling process may be the one switching a fresh database to
            # WAL. The exclusive migration lock below is the authority; this
            # connection can continue in the already-active journal mode.
            if "locked" not in str(exc).lower():
                conn.close()
                raise
        conn.execute("PRAGMA synchronous = FULL")
        return conn

    def initialize(self) -> int:
        with contextlib.closing(self.connect()) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version     INTEGER PRIMARY KEY,
                    applied_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) STRICT
                """
            )
            # Read the migration ledger only after taking the exclusive lock.
            # This prevents two fresh server processes from both attempting a
            # non-repeatable ALTER TABLE migration.
            conn.execute("BEGIN EXCLUSIVE")
            try:
                applied = {
                    int(row["version"])
                    for row in conn.execute("SELECT version FROM schema_migrations")
                }
                for version, sql in MIGRATIONS:
                    if version in applied:
                        continue
                    for statement in self._statements(sql):
                        conn.execute(statement)
                    conn.execute(
                        "INSERT INTO schema_migrations(version) VALUES (?)",
                        (version,),
                    )
                    applied.add(version)
                row = conn.execute(
                    "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
                ).fetchone()
                conn.execute("COMMIT")
                return int(row["version"])
            except BaseException:
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise

    @contextlib.contextmanager
    def transaction(self, *, immediate: bool = True) -> Iterator[sqlite3.Connection]:
        conn = self.connect()
        try:
            conn.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
            yield conn
            conn.execute("COMMIT")
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()

    def schema_version(self) -> int:
        with contextlib.closing(self.connect()) as conn:
            try:
                row = conn.execute(
                    "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
                ).fetchone()
            except sqlite3.OperationalError:
                return 0
            return int(row["version"])

    @staticmethod
    def _statements(script: str) -> Iterator[str]:
        """Yield complete SQLite statements, including multi-line triggers."""

        buffer: list[str] = []
        for line in script.splitlines():
            buffer.append(line)
            candidate = "\n".join(buffer).strip()
            if candidate and sqlite3.complete_statement(candidate):
                yield candidate
                buffer.clear()
        if "\n".join(buffer).strip():
            raise RuntimeError("incomplete SQLite migration statement")
