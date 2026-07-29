"""Immutable render assets with staging, probing, receipts, and atomic promote."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

from .store import ReceiptConflict, canonical_json, json_sha256, utc_now


SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


class AssetError(RuntimeError):
    pass


@dataclass(frozen=True)
class StagedRender:
    job_id: str
    piece_id: str
    version_id: str
    path: Path
    duration_seconds: float
    files: dict[str, dict[str, Any]]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ffprobe_duration(path: Path, *, ffprobe_bin: str = "ffprobe") -> float:
    """Probe the file actually being promoted and require a successful result."""

    completed = subprocess.run(
        [
            ffprobe_bin,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise AssetError(f"ffprobe failed ({completed.returncode}): {detail}")
    try:
        duration = float(completed.stdout.strip())
    except ValueError as exc:
        raise AssetError("ffprobe returned a non-numeric duration") from exc
    if not math.isfinite(duration) or duration <= 0:
        raise AssetError("audio duration must be finite and greater than zero")
    return duration


class AssetStore:
    """Owns only `assets_root`, including its private `.staging` directory."""

    def __init__(
        self,
        *,
        repo_root: str | Path,
        assets_root: str | Path | None = None,
        duration_probe: Callable[[Path], float] | None = None,
        owner=None,
    ):
        self.repo_root = Path(repo_root).expanduser().resolve()
        self.assets_root = (
            Path(assets_root).expanduser().resolve()
            if assets_root is not None
            else self.repo_root / "producer-brain" / "assets"
        )
        self.staging_root = self.assets_root / ".staging"
        self.duration_probe = duration_probe or ffprobe_duration
        self._owner = owner
        self.staging_root.mkdir(parents=True, exist_ok=True)

    def stage_render(
        self,
        *,
        job_id: str,
        piece_id: str,
        version_id: str,
        code: str | bytes,
        audio_path: str | Path,
        prompt: Mapping[str, Any] | None = None,
        features: Mapping[str, Any] | None = None,
    ) -> StagedRender:
        """Build a complete staging directory without touching live assets."""

        for label, value in (
            ("job_id", job_id),
            ("piece_id", piece_id),
            ("version_id", version_id),
        ):
            self._validate_id(label, value)
        if not code.strip():
            raise AssetError("piece code is empty")
        source_audio = Path(audio_path).expanduser().resolve()
        if not source_audio.is_file() or source_audio.stat().st_size <= 0:
            raise AssetError(f"rendered audio is missing or empty: {source_audio}")

        stage_name = f"{job_id}--{version_id}"
        stage_path = self.staging_root / stage_name
        tmp_path = self.staging_root / f".tmp-{uuid.uuid4().hex}"
        tmp_path.mkdir(parents=False, exist_ok=False)
        try:
            if isinstance(code, bytes):
                self._write_bytes(tmp_path / "piece.js", code)
            else:
                self._write_text(tmp_path / "piece.js", code)
            shutil.copyfile(source_audio, tmp_path / "audio.mp3")
            if prompt is not None:
                self._write_json(tmp_path / "prompt.json", dict(prompt))
            if features is not None:
                self._write_json(tmp_path / "features.json", dict(features))

            duration = float(self.duration_probe(tmp_path / "audio.mp3"))
            if not math.isfinite(duration) or duration <= 0:
                raise AssetError("duration probe returned an invalid value")
            files = self._file_manifest(tmp_path)
            staging_meta = {
                "schema_version": 1,
                "job_id": job_id,
                "piece_id": piece_id,
                "version_id": version_id,
                "duration_seconds": duration,
                "files": files,
            }
            self._write_json(tmp_path / "staging.json", staging_meta)
            self._fsync_tree(tmp_path)

            if stage_path.exists():
                existing = self._load_json(stage_path / "staging.json")
                if self._same_staging(existing, staging_meta):
                    self._remove_owned_staging(tmp_path)
                    return self._staged_from_meta(stage_path, existing)
                raise ReceiptConflict(
                    f"staging slot already contains different bytes: {stage_name}"
                )
            os.replace(tmp_path, stage_path)
            self._fsync_dir(self.staging_root)
            return self._staged_from_meta(stage_path, staging_meta)
        except BaseException:
            if tmp_path.exists():
                self._remove_owned_staging(tmp_path)
            raise

    def build_receipt(
        self,
        staged: StagedRender,
        *,
        provenance: Mapping[str, Any],
        promoted_at: str | None = None,
    ) -> dict:
        """Compute the exact receipt a promote would write, without promoting.

        Deterministic given the staged bytes, provenance, and timestamp, so a
        commit intent can bind the receipt identity before the filesystem
        rename happens.
        """

        target = self.assets_root / staged.piece_id / staged.version_id
        receipt_without_sha = {
            "schema_version": 1,
            "job_id": staged.job_id,
            "piece_id": staged.piece_id,
            "version_id": staged.version_id,
            "asset_dir": self._display_path(target),
            "duration_seconds": staged.duration_seconds,
            "files": staged.files,
            "provenance": dict(provenance),
            "promoted_at": promoted_at or utc_now(),
        }
        receipt = dict(receipt_without_sha)
        receipt["receipt_sha256"] = json_sha256(receipt_without_sha)
        return receipt

    def promote(
        self,
        staged: StagedRender,
        *,
        provenance: Mapping[str, Any],
    ) -> dict:
        """Atomically rename one complete staging directory into live assets."""

        return self.promote_with_receipt(
            staged,
            receipt=self.build_receipt(staged, provenance=provenance),
        )

    def promote_with_receipt(
        self,
        staged: StagedRender,
        *,
        receipt: Mapping[str, Any],
    ) -> dict:
        """Promote the exact staged directory under a precomputed receipt."""

        if self._owner is not None:
            # The rename into live assets is a state-root publication: a
            # worker surviving bounded shutdown must fail closed here instead
            # of promoting an orphan under a released lease.
            self._owner.require("promote rendered assets")
        receipt = dict(receipt)
        for field, expected_value in (
            ("job_id", staged.job_id),
            ("piece_id", staged.piece_id),
            ("version_id", staged.version_id),
        ):
            if receipt.get(field) != expected_value:
                raise ReceiptConflict(f"receipt {field} does not match staging")
        body = dict(receipt)
        claimed_sha = str(body.pop("receipt_sha256", ""))
        if not claimed_sha or json_sha256(body) != claimed_sha:
            raise ReceiptConflict("receipt digest does not match its contents")
        target = self.assets_root / staged.piece_id / staged.version_id
        existing_receipt = target / "receipt.json"
        if existing_receipt.is_file():
            existing = self._load_json(existing_receipt)
            if (
                existing.get("job_id") == staged.job_id
                and existing.get("piece_id") == staged.piece_id
                and existing.get("version_id") == staged.version_id
            ):
                self.verify_receipt(existing)
                if existing.get("receipt_sha256") != receipt.get("receipt_sha256"):
                    # A retried promote may only differ in its promoted_at
                    # timestamp; any other divergence is a conflicting
                    # receipt, and the already-promoted one is the truth.
                    def _timeless(document: Mapping[str, Any]) -> dict:
                        projection = dict(document)
                        projection.pop("promoted_at", None)
                        projection.pop("receipt_sha256", None)
                        return projection

                    if _timeless(existing) != _timeless(receipt):
                        raise ReceiptConflict(
                            f"asset version already exists: {target}"
                        )
                if staged.path.exists():
                    staged_meta = self._load_json(staged.path / "staging.json")
                    if not self._same_staging(
                        staged_meta,
                        {
                            "job_id": existing["job_id"],
                            "piece_id": existing["piece_id"],
                            "version_id": existing["version_id"],
                            "duration_seconds": existing["duration_seconds"],
                            "files": existing["files"],
                        },
                    ):
                        raise ReceiptConflict(
                            "existing promoted receipt conflicts with staging bytes"
                        )
                    self._remove_owned_staging(staged.path)
                return existing
            raise ReceiptConflict(f"asset version already exists: {target}")

        if not staged.path.is_dir():
            raise AssetError(f"staging directory is missing: {staged.path}")
        live_meta = self._load_json(staged.path / "staging.json")
        expected = {
            "job_id": staged.job_id,
            "piece_id": staged.piece_id,
            "version_id": staged.version_id,
            "duration_seconds": staged.duration_seconds,
            "files": staged.files,
        }
        if not self._same_staging(live_meta, expected):
            raise ReceiptConflict("staging metadata changed before promote")
        if receipt.get("files") != staged.files or not math.isclose(
            float(receipt.get("duration_seconds") or 0.0),
            staged.duration_seconds,
            rel_tol=1e-9,
            abs_tol=1e-9,
        ):
            raise ReceiptConflict("receipt does not match the staged bytes")

        self._write_json(staged.path / "receipt.json", receipt)
        self._fsync_tree(staged.path)

        target.parent.mkdir(parents=True, exist_ok=True)
        # Same-filesystem directory rename: observers see either no version or
        # the complete version with receipt, never a partially copied version.
        os.replace(staged.path, target)
        self._fsync_dir(target.parent)
        self.verify_receipt(receipt)
        return receipt

    def load_receipt(self, piece_id: str, version_id: str) -> dict:
        self._validate_id("piece_id", piece_id)
        self._validate_id("version_id", version_id)
        path = self.assets_root / piece_id / version_id / "receipt.json"
        if not path.is_file():
            raise AssetError(f"asset receipt not found: {path}")
        receipt = self._load_json(path)
        self.verify_receipt(receipt)
        return receipt

    def verify_receipt(self, receipt: Mapping[str, Any]) -> None:
        """Mechanical integrity only; this is deliberately not a music gate."""

        body = dict(receipt)
        claimed = str(body.pop("receipt_sha256", ""))
        if not claimed or json_sha256(body) != claimed:
            raise ReceiptConflict("receipt digest does not match its contents")
        target = (
            self.assets_root / str(receipt["piece_id"]) / str(receipt["version_id"])
        )
        if self._display_path(target) != receipt["asset_dir"]:
            raise ReceiptConflict("receipt asset_dir does not match IDs")
        for name, metadata in dict(receipt["files"]).items():
            path = target / name
            if not path.is_file():
                raise ReceiptConflict(f"receipt file is missing: {name}")
            if sha256_file(path) != metadata["sha256"]:
                raise ReceiptConflict(f"receipt file hash drift: {name}")
            if path.stat().st_size != int(metadata["bytes"]):
                raise ReceiptConflict(f"receipt file size drift: {name}")

    def scan_receipts(self) -> list[dict]:
        receipts: list[dict] = []
        if not self.assets_root.exists():
            return receipts
        for path in sorted(self.assets_root.glob("*/*/receipt.json")):
            try:
                receipt = self._load_json(path)
                self.verify_receipt(receipt)
                receipts.append(receipt)
            except (AssetError, ReceiptConflict, KeyError, ValueError) as exc:
                receipts.append(
                    {
                        "asset_dir": self._display_path(path.parent),
                        "classification": "invalid_receipt",
                        "error": str(exc),
                    }
                )
        return receipts

    @staticmethod
    def _validate_id(label: str, value: str) -> None:
        if not SAFE_ID.fullmatch(value or ""):
            raise AssetError(f"{label} contains unsupported characters")

    @staticmethod
    def _write_text(path: Path, text: str) -> None:
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())

    @staticmethod
    def _write_bytes(path: Path, value: bytes) -> None:
        with path.open("wb") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())

    @classmethod
    def _write_json(cls, path: Path, value: Mapping[str, Any]) -> None:
        cls._write_text(path, canonical_json(dict(value)) + "\n")

    @staticmethod
    def _load_json(path: Path) -> dict:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise AssetError(f"cannot read asset metadata {path}: {exc}") from exc
        if not isinstance(value, dict):
            raise AssetError(f"asset metadata is not an object: {path}")
        return value

    @staticmethod
    def _file_manifest(directory: Path) -> dict[str, dict[str, Any]]:
        manifest: dict[str, dict[str, Any]] = {}
        for name in ("piece.js", "audio.mp3", "prompt.json", "features.json"):
            path = directory / name
            if path.is_file():
                manifest[name] = {
                    "sha256": sha256_file(path),
                    "bytes": path.stat().st_size,
                }
        return manifest

    @staticmethod
    def _same_staging(left: Mapping[str, Any], right: Mapping[str, Any]) -> bool:
        keys = ("job_id", "piece_id", "version_id", "duration_seconds", "files")
        return all(left.get(key) == right.get(key) for key in keys)

    @staticmethod
    def _staged_from_meta(path: Path, meta: Mapping[str, Any]) -> StagedRender:
        return StagedRender(
            job_id=str(meta["job_id"]),
            piece_id=str(meta["piece_id"]),
            version_id=str(meta["version_id"]),
            path=path,
            duration_seconds=float(meta["duration_seconds"]),
            files=dict(meta["files"]),
        )

    def _display_path(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.repo_root).as_posix()
        except ValueError:
            return str(path.resolve())

    def _remove_owned_staging(self, path: Path) -> None:
        resolved = path.resolve()
        try:
            resolved.relative_to(self.staging_root.resolve())
        except ValueError as exc:
            raise AssetError("refusing to remove path outside asset staging") from exc
        if resolved == self.staging_root.resolve():
            raise AssetError("refusing to remove the staging root")
        shutil.rmtree(resolved)

    @staticmethod
    def _fsync_dir(path: Path) -> None:
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    @classmethod
    def _fsync_tree(cls, directory: Path) -> None:
        for path in directory.iterdir():
            if path.is_file():
                descriptor = os.open(path, os.O_RDONLY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
        cls._fsync_dir(directory)
