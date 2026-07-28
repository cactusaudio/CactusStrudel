"""Integration-facing domain service for the v3 server/API layer."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Mapping

from .assets import AssetStore, StagedRender
from .db import Database
from .store import (
    InvalidTransition,
    NotFound,
    TruthStore,
    stable_id,
)


class RuntimeTruth:
    """Facade used by the v3 application and its workers.

    It intentionally contains no HTTP concerns. The application maps these
    methods to REST/SSE while workers call the same methods directly.
    """

    def __init__(
        self,
        *,
        repo_root: str | Path,
        db_path: str | Path | None = None,
        assets_root: str | Path | None = None,
        duration_probe=None,
        owner=None,
    ):
        self.repo_root = Path(repo_root).expanduser().resolve()
        effective_db = (
            Path(db_path).expanduser().resolve()
            if db_path is not None
            else (
                Path(
                    os.environ.get("CACTUS_V3_STATE_ROOT")
                    or Path.home() / ".cactus-strudel" / "v3"
                )
                .expanduser()
                .resolve()
                / "runtime.sqlite3"
            )
        )
        self.database = Database(effective_db)
        self.store = TruthStore(self.database, owner=owner)
        self.assets = AssetStore(
            repo_root=self.repo_root,
            assets_root=assets_root,
            duration_probe=duration_probe,
        )

    @staticmethod
    def allocate_render_identity(
        *, piece_id: str | None = None, version_id: str | None = None
    ) -> dict[str, str]:
        return {
            "piece_id": piece_id or stable_id("piece"),
            "version_id": version_id or stable_id("version"),
        }

    def create_job(
        self,
        *,
        kind: str,
        payload: Mapping[str, Any],
        idempotency_key: str,
        config_revision_id: str | None = None,
    ) -> tuple[dict, bool]:
        return self.store.create_job(
            kind=kind,
            payload=payload,
            idempotency_key=idempotency_key,
            config_revision_id=config_revision_id,
        )

    def start_job(self, job_id: str, *, worker_id: str) -> dict:
        return self.store.start_job(job_id, worker_id=worker_id)

    def request_cancel(self, job_id: str) -> dict:
        return self.store.request_cancel(job_id)

    def get_job(self, job_id: str) -> dict:
        return self.store.get_job(job_id)

    def list_jobs(
        self, *, status: str | None = None, kind: str | None = None, limit: int = 100
    ) -> list[dict]:
        return self.store.list_jobs(status=status, kind=kind, limit=limit)

    def events_after(
        self, after_seq: int = 0, *, limit: int = 500, job_id: str | None = None
    ) -> list[dict]:
        return self.store.events_after(after_seq, limit=limit, job_id=job_id)

    def finish_cancel(self, job_id: str) -> dict:
        job = self.store.get_job(job_id)
        if job["status"] == "cancelled":
            return job
        if job["status"] != "cancel_requested":
            raise InvalidTransition(
                f"cannot acknowledge cancellation while job is {job['status']}"
            )
        return self.store.finish_job(job_id, status="cancelled")

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
        job = self.store.get_job(job_id)
        if job["status"] not in {"running", "cancel_requested"}:
            raise InvalidTransition(f"cannot stage render while job is {job['status']}")
        return self.assets.stage_render(
            job_id=job_id,
            piece_id=piece_id,
            version_id=version_id,
            code=code,
            audio_path=audio_path,
            prompt=prompt,
            features=features,
        )

    def commit_rendered_version(
        self,
        *,
        staged: StagedRender,
        display_name: str,
        provenance: Mapping[str, Any],
        model_run: Mapping[str, Any],
        piece_fields: Mapping[str, Any] | None = None,
        version_fields: Mapping[str, Any] | None = None,
    ) -> dict:
        """Promote immutable bytes, then register the receipt transactionally."""

        job = self.store.get_job(staged.job_id)
        if job["status"] == "cancel_requested":
            # Cancellation won before the filesystem commit barrier.
            return {
                "job": self.store.finish_job(staged.job_id, status="cancelled"),
                "version": None,
                "receipt": None,
            }
        if job["status"] not in {
            "running",
            "succeeded",
            "cancelled_after_commit",
        }:
            raise InvalidTransition(
                f"cannot commit rendered version while job is {job['status']}"
            )

        exact_provenance = dict(provenance)
        receipt = self.assets.promote(staged, provenance=exact_provenance)
        piece_spec = dict(piece_fields or {})
        piece_spec.update(
            {
                "id": staged.piece_id,
                "display_name": display_name,
            }
        )
        version_spec = dict(version_fields or {})
        version_spec.update(
            {
                "id": staged.version_id,
                "provenance": exact_provenance,
            }
        )
        registered = self.store.register_render_success(
            job_id=staged.job_id,
            receipt=receipt,
            piece=piece_spec,
            version=version_spec,
            model_run=model_run,
        )
        return {
            "job": self.store.get_job(staged.job_id),
            "version": registered,
            "receipt": receipt,
        }

    def rate(
        self,
        *,
        piece_version_id: str,
        audio_sha256: str,
        score: float,
        note: str | None = None,
        source_key: str | None = None,
        created_at: str | None = None,
    ) -> dict:
        return self.store.rate_version(
            piece_version_id=piece_version_id,
            audio_sha256=audio_sha256,
            score=score,
            note=note,
            source_key=source_key,
            created_at=created_at,
        )

    def get_piece(self, piece_id: str) -> dict:
        piece = self.store.get_piece(piece_id)
        piece["versions"] = self.store.list_versions(piece_id)
        return piece

    def list_pieces(
        self,
        *,
        collection: str | None = None,
        include_archived: bool = False,
        limit: int = 100,
        before_created_at: str | None = None,
    ) -> list[dict]:
        return self.store.list_pieces(
            collection=collection,
            include_archived=include_archived,
            limit=limit,
            before_created_at=before_created_at,
        )

    def archive_piece(self, piece_id: str) -> dict:
        return self.store.set_piece_archived(piece_id, archived=True)

    def restore_piece(self, piece_id: str) -> dict:
        return self.store.set_piece_archived(piece_id, archived=False)

    def promote_version(self, *, piece_id: str, version_id: str) -> dict:
        return self.store.promote_version(piece_id=piece_id, version_id=version_id)

    def recover_after_restart(self) -> dict:
        interrupted = self.store.recover_interrupted_jobs()
        receipt_reconciliation = self.reconcile_receipts()
        return {
            "interrupted_job_ids": interrupted,
            "receipt_reconciliation": receipt_reconciliation,
        }

    def reconcile_receipts(self) -> dict:
        """Read-only DB/filesystem comparison; never auto-imports orphan assets."""

        scanned = self.assets.scan_receipts()
        with self.database.transaction(immediate=False) as conn:
            registered = {
                row["receipt_sha256"]: dict(row)
                for row in conn.execute(
                    """
                    SELECT id, piece_id, receipt_sha256, asset_dir, created_by_job_id
                      FROM piece_versions
                    """
                )
            }
        matched: list[dict] = []
        matched_receipt_shas: set[str] = set()
        orphan_promoted: list[dict] = []
        invalid: list[dict] = []
        identity_mismatches: list[dict] = []
        for receipt in scanned:
            if receipt.get("classification") == "invalid_receipt":
                invalid.append(receipt)
                continue
            receipt_sha = receipt["receipt_sha256"]
            if receipt_sha in registered:
                row = registered[receipt_sha]
                registered_identity = {
                    "piece_id": row["piece_id"],
                    "version_id": row["id"],
                    "asset_dir": row["asset_dir"],
                    "created_by_job_id": row["created_by_job_id"],
                }
                receipt_identity = {
                    "piece_id": receipt["piece_id"],
                    "version_id": receipt["version_id"],
                    "asset_dir": receipt["asset_dir"],
                    "job_id": receipt["job_id"],
                }
                mismatched_fields = [
                    field
                    for field, receipt_field in (
                        ("piece_id", "piece_id"),
                        ("version_id", "version_id"),
                        ("asset_dir", "asset_dir"),
                        ("created_by_job_id", "job_id"),
                    )
                    if registered_identity[field] != receipt_identity[receipt_field]
                ]
                if mismatched_fields:
                    identity_mismatches.append(
                        {
                            "classification": (
                                "registered_receipt_identity_mismatch"
                            ),
                            "human_decision_required": True,
                            "receipt_sha256": receipt_sha,
                            "mismatched_fields": mismatched_fields,
                            "registered_identity": registered_identity,
                            "receipt_identity": receipt_identity,
                        }
                    )
                else:
                    matched_receipt_shas.add(receipt_sha)
                    matched.append(
                        {
                            "receipt_sha256": receipt_sha,
                            "version_id": row["id"],
                            "asset_dir": receipt["asset_dir"],
                        }
                    )
            else:
                orphan_promoted.append(
                    {
                        "classification": "orphan_promoted_receipt",
                        "human_decision_required": True,
                        "receipt": receipt,
                    }
                )
        registered_without_valid_receipt = [
            {
                "classification": "registered_without_valid_receipt",
                "human_decision_required": True,
                "receipt_sha256": receipt_sha,
                "version_id": row["id"],
                "piece_id": row["piece_id"],
                "asset_dir": row["asset_dir"],
                "created_by_job_id": row["created_by_job_id"],
            }
            for receipt_sha, row in sorted(registered.items())
            if receipt_sha not in matched_receipt_shas
        ]
        return {
            "matched": matched,
            "orphan_promoted": orphan_promoted,
            "invalid": invalid,
            "registered_receipt_identity_mismatch": identity_mismatches,
            "registered_without_valid_receipt": registered_without_valid_receipt,
        }

    def get_version_asset_paths(self, version_id: str) -> dict[str, Path]:
        version = self.store.get_version(version_id)
        base = Path(version["asset_dir"])
        if not base.is_absolute():
            base = self.repo_root / base
        if not base.is_dir():
            raise NotFound(f"asset directory missing for version: {version_id}")
        return {
            name: base / name
            for name in ("piece.js", "audio.mp3", "prompt.json", "features.json")
            if (base / name).is_file()
        }
