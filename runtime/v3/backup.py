"""Repo-owned backup/restore for the complete CactusStrudel truth (B4).

One dated archive captures everything a machine needs to become this
workspace again: the canonical SQLite database (WAL-checkpointed first),
Agent state, generation configuration and its immutable revisions, the
owner epoch record, and the immutable rendered assets. A manifest with
per-file SHA-256 makes restore verify-before-adopt: nothing is unpacked
onto live state unless every archived byte matches its manifest entry.

Portability contract: receipts record repo-relative asset paths, so a
restored machine must keep the same repo-relative layout (assets under the
repo's producer-brain/assets). Restoring assets to an arbitrary location
correctly FAILS receipt verification afterwards — that is the usability
seam doing its job, not a backup defect.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import tarfile
import tempfile
from contextlib import closing
from pathlib import Path
from typing import Any

from .store import utc_now


MANIFEST_NAME = "cactus-backup-manifest.json"
SCHEMA_VERSION = 1

# State-root entries owned by the backup. owner.lock/owner.json are runtime
# liveness, deliberately excluded; `backups/` must never nest itself.
STATE_ENTRIES = (
    "runtime.sqlite3",
    "generation.json",
    "generation-revisions",
    "agent",
)


class BackupError(RuntimeError):
    pass


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _walk_files(base: Path) -> list[Path]:
    if base.is_file():
        return [base]
    if not base.is_dir():
        return []
    return sorted(p for p in base.rglob("*") if p.is_file())


def create_backup(
    *,
    state_root: str | Path,
    assets_root: str | Path,
    output_dir: str | Path | None = None,
    include_assets: bool = True,
) -> dict[str, Any]:
    """Snapshot state root + assets into one verifiable tar.gz."""

    state = Path(state_root).expanduser().resolve()
    assets = Path(assets_root).expanduser().resolve()
    database = state / "runtime.sqlite3"
    if not database.is_file():
        raise BackupError(f"no database at {database}")
    target_dir = (
        Path(output_dir).expanduser().resolve()
        if output_dir is not None
        else state / "backups"
    )
    target_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = utc_now().replace(":", "").replace("-", "").split(".")[0]
    archive_path = target_dir / f"cactus-backup-{stamp}.tar.gz"
    if archive_path.exists():
        raise BackupError(f"backup already exists: {archive_path}")

    with tempfile.TemporaryDirectory(prefix="cactus-backup-") as tmp:
        staging = Path(tmp)
        # A consistent database copy: checkpoint WAL, then use the SQLite
        # backup API so a live writer cannot tear the copied pages.
        db_copy = staging / "state" / "runtime.sqlite3"
        db_copy.parent.mkdir(parents=True)
        with closing(sqlite3.connect(database)) as source:
            source.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            with closing(sqlite3.connect(db_copy)) as destination:
                source.backup(destination)
        for name in STATE_ENTRIES[1:]:
            source_path = state / name
            if source_path.is_dir():
                shutil.copytree(source_path, staging / "state" / name)
            elif source_path.is_file():
                shutil.copy2(source_path, staging / "state" / name)
        if include_assets and assets.is_dir():
            shutil.copytree(
                assets,
                staging / "assets",
                ignore=shutil.ignore_patterns(".staging"),
            )

        files: dict[str, dict[str, Any]] = {}
        for file_path in _walk_files(staging):
            relative = file_path.relative_to(staging).as_posix()
            files[relative] = {
                "sha256": _sha256_file(file_path),
                "bytes": file_path.stat().st_size,
            }
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "created_at": utc_now(),
            "state_root": str(state),
            "assets_root": str(assets),
            "include_assets": bool(include_assets),
            "files": files,
        }
        manifest_path = staging / MANIFEST_NAME
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True)
            + "\n",
            encoding="utf-8",
        )
        with tarfile.open(archive_path, "w:gz") as archive:
            archive.add(manifest_path, arcname=MANIFEST_NAME)
            for relative in sorted(files):
                archive.add(staging / relative, arcname=relative)
    return {
        "archive": str(archive_path),
        "bytes": archive_path.stat().st_size,
        "files": len(files),
        "include_assets": bool(include_assets),
        "created_at": manifest["created_at"],
    }


def _safe_extract_root(archive: tarfile.TarFile, destination: Path) -> None:
    for member in archive.getmembers():
        member_path = (destination / member.name).resolve()
        if not str(member_path).startswith(str(destination.resolve())):
            raise BackupError(f"archive path escapes destination: {member.name}")
    archive.extractall(destination, filter="data")


def restore_backup(
    *,
    archive: str | Path,
    state_root: str | Path,
    assets_root: str | Path,
    force: bool = False,
) -> dict[str, Any]:
    """Verify every archived byte against the manifest, then adopt.

    Refuses to overwrite an existing database unless force=True; the live
    runtime must be stopped (the restored state root has no owner.lock and
    the next start recovers under a fresh epoch).
    """

    archive_path = Path(archive).expanduser().resolve()
    state = Path(state_root).expanduser().resolve()
    assets = Path(assets_root).expanduser().resolve()
    if (state / "runtime.sqlite3").exists() and not force:
        raise BackupError(
            "state root already has a database; pass force=True to replace it"
        )
    with tempfile.TemporaryDirectory(prefix="cactus-restore-") as tmp:
        staging = Path(tmp)
        with tarfile.open(archive_path, "r:gz") as tar:
            _safe_extract_root(tar, staging)
        manifest_path = staging / MANIFEST_NAME
        if not manifest_path.is_file():
            raise BackupError("archive has no manifest")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("schema_version") != SCHEMA_VERSION:
            raise BackupError("unsupported backup schema version")
        files = manifest.get("files") or {}
        if not files:
            raise BackupError("manifest lists no files")
        extracted = {
            path.relative_to(staging).as_posix()
            for path in staging.rglob("*")
            if path.is_file()
        } - {MANIFEST_NAME}
        unmanifested = extracted - set(files)
        if unmanifested:
            raise BackupError(
                "archive contains unmanifested file(s): "
                + ", ".join(sorted(unmanifested)[:5])
            )
        verified = 0
        for relative, expected in files.items():
            candidate = staging / relative
            if not candidate.is_file():
                raise BackupError(f"archive is missing {relative}")
            if _sha256_file(candidate) != expected["sha256"]:
                raise BackupError(f"archive byte drift in {relative}")
            verified += 1
        extracted_state = staging / "state"
        state.mkdir(parents=True, exist_ok=True, mode=0o700)
        # force never deletes: replaced state moves aside to a timestamped
        # sibling so a bad restore is one rename away from rollback.
        aside_stamp = utc_now().replace(":", "").replace("-", "").split(".")[0]
        aside_root = state / f".pre-restore-{aside_stamp}"
        for name in STATE_ENTRIES:
            source_path = extracted_state / name
            target_path = state / name
            if not source_path.exists():
                continue
            if target_path.exists():
                aside_root.mkdir(parents=True, exist_ok=True, mode=0o700)
                shutil.move(str(target_path), str(aside_root / name))
            if source_path.is_dir():
                shutil.copytree(source_path, target_path)
            else:
                shutil.copy2(source_path, target_path)
        restored_assets = False
        extracted_assets = staging / "assets"
        if extracted_assets.is_dir():
            if assets.exists() and force:
                aside_assets = assets.parent / (
                    assets.name + f".pre-restore-{aside_stamp}"
                )
                shutil.move(str(assets), str(aside_assets))
            if not assets.exists():
                shutil.copytree(extracted_assets, assets)
                restored_assets = True
            else:
                raise BackupError(
                    "assets root already exists; pass force=True to replace it"
                )
    return {
        "archive": str(archive_path),
        "verified_files": verified,
        "restored_assets": restored_assets,
        "restored_at": utc_now(),
    }
