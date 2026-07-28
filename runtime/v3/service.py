"""Integration-facing domain service for the v3 server/API layer."""

from __future__ import annotations

from dataclasses import dataclass
import math
import os
from pathlib import Path
import threading
from typing import Any, Mapping

from .assets import AssetError, AssetStore, StagedRender
from .db import Database
from .store import (
    InvalidTransition,
    NotFound,
    ReceiptConflict,
    TruthError,
    TruthStore,
    stable_id,
)


USABILITY_ACTIONS = frozenset({"list", "play", "score", "promote", "brain"})


@dataclass(frozen=True)
class RevisionUsability:
    """One shared verdict for every product read or mutation (DT-003/004).

    usable =
      database revision exists
      AND receipt parses
      AND receipt identity matches database identity
      AND source/audio bytes match receipt
      AND revision lifecycle permits the requested action
    """

    version_id: str
    action: str
    usable: bool
    reason: str | None
    audio_sha256: str | None


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
            owner=owner,
        )
        self._owner = owner
        self._usability_lock = threading.Lock()
        self._usability_cache: dict[str, tuple[tuple, tuple[bool, str | None]]] = {}

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
        receipt = self.assets.build_receipt(staged, provenance=exact_provenance)
        if job["status"] == "running":
            # DT-001: bind the exact receipt and full registration payload
            # durably before the filesystem rename, so a crash between
            # promote and register is adopted exactly at the next start.
            self.store.create_commit_intent(
                job_id=staged.job_id,
                receipt=receipt,
                registration={
                    "receipt": receipt,
                    "piece": piece_spec,
                    "version": version_spec,
                    "model_run": dict(model_run),
                },
                owner_epoch=(
                    self._owner.epoch if self._owner is not None else None
                ),
            )
        promoted = self.assets.promote_with_receipt(staged, receipt=receipt)
        self.store.mark_commit_intent(staged.job_id, status="promoted")
        registered = self.store.register_render_success(
            job_id=staged.job_id,
            receipt=promoted,
            piece=piece_spec,
            version=version_spec,
            model_run=model_run,
        )
        return {
            "job": self.store.get_job(staged.job_id),
            "version": registered,
            "receipt": promoted,
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
        verdict = self.revision_usability(piece_version_id, action="score")
        if not verdict.usable:
            raise ReceiptConflict(
                f"revision is not usable for scoring: {verdict.reason}"
            )
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
        verdict = self.revision_usability(version_id, action="promote")
        if not verdict.usable:
            raise ReceiptConflict(
                f"revision is not usable for promotion: {verdict.reason}"
            )
        return self.store.promote_version(piece_id=piece_id, version_id=version_id)

    # ------------------------------------------------------------------
    # Revision usability (DT-003/DT-004)

    def revision_usability(
        self,
        version: str | Mapping[str, Any],
        *,
        action: str = "list",
    ) -> RevisionUsability:
        """One verdict consumed by list, playback, scoring, promotion, Brain."""

        if action not in USABILITY_ACTIONS:
            raise ValueError(f"unknown usability action: {action}")
        row = (
            dict(version)
            if isinstance(version, Mapping)
            else self.store.get_version(str(version))
        )
        version_id = str(row["id"])
        # DT-004 rejects targets whose exact rendered identity is not
        # available. That is a receipt/byte criterion, not a state label: a
        # legacy_partial revision with fully verified bytes is real heard
        # truth, while any revision with missing or drifted assets fails
        # below regardless of state.
        ok, reason = self._verify_revision_bytes(row)
        return RevisionUsability(
            version_id=version_id,
            action=action,
            usable=ok,
            reason=reason,
            audio_sha256=str(row["audio_sha256"]) if ok else None,
        )

    def asset_request_gate(
        self, file_path: Path
    ) -> tuple[int, dict[str, Any]] | None:
        """Decide whether a static asset request may serve bytes (DT-003).

        Returns None to allow, or an (HTTP status, JSON payload) refusal.
        receipt.json stays readable as drift evidence; staging directories
        and unregistered asset paths are never served.
        """

        try:
            relative = Path(file_path).resolve().relative_to(
                self.assets.assets_root.resolve()
            )
        except ValueError:
            return None
        parts = relative.parts
        if not parts or parts[0] == ".staging" or len(parts) != 3:
            return 404, {"error": "asset not found"}
        piece_id, version_id, name = parts
        if name == "receipt.json":
            return None
        if name not in {"audio.mp3", "piece.js", "prompt.json", "features.json"}:
            return 404, {"error": "asset not found"}
        try:
            version = self.store.get_version(version_id)
        except NotFound:
            return 404, {"error": "asset is not a registered revision"}
        if str(version.get("piece_id")) != piece_id:
            return 404, {"error": "asset is not a registered revision"}
        verdict = self.revision_usability(version, action="play")
        if not verdict.usable:
            return 409, {
                "error": "revision is not usable for playback",
                "detail": verdict.reason,
                "revision_id": version_id,
            }
        return None

    def invalidate_usability(self, version_id: str | None = None) -> None:
        with self._usability_lock:
            if version_id is None:
                self._usability_cache.clear()
            else:
                self._usability_cache.pop(str(version_id), None)

    def _verify_revision_bytes(
        self, row: Mapping[str, Any]
    ) -> tuple[bool, str | None]:
        """Receipt/identity/byte verification with a stat-keyed cache.

        The cache key covers mtime/size of every receipt-relevant file, so a
        drifted or replaced file re-verifies on the next check while steady
        assets are not re-hashed on every listing.
        """

        version_id = str(row["id"])
        asset_dir = Path(str(row["asset_dir"]))
        if not asset_dir.is_absolute():
            asset_dir = self.repo_root / asset_dir
        key_parts: list[tuple[str, int, int, int, int]] = []
        for name in (
            "receipt.json",
            "piece.js",
            "audio.mp3",
            "prompt.json",
            "features.json",
        ):
            try:
                stat = (asset_dir / name).stat()
                # inode and ctime catch an accidental same-size replacement
                # that preserved mtime (for example `cp -p` of stale bytes).
                key_parts.append(
                    (
                        name,
                        stat.st_mtime_ns,
                        stat.st_size,
                        stat.st_ino,
                        stat.st_ctime_ns,
                    )
                )
            except OSError:
                key_parts.append((name, -1, -1, -1, -1))
        cache_key = tuple(key_parts)
        with self._usability_lock:
            cached = self._usability_cache.get(version_id)
            if cached is not None and cached[0] == cache_key:
                return cached[1]
        verdict = self._verify_revision_bytes_uncached(row, asset_dir)
        with self._usability_lock:
            self._usability_cache[version_id] = (cache_key, verdict)
        return verdict

    def _verify_revision_bytes_uncached(
        self, row: Mapping[str, Any], asset_dir: Path
    ) -> tuple[bool, str | None]:
        try:
            receipt = self.assets.load_receipt(
                str(row["piece_id"]), str(row["id"])
            )
        except (AssetError, ReceiptConflict) as exc:
            return False, str(exc)
        checks: tuple[tuple[str, Any, Any], ...] = (
            ("piece_id", receipt.get("piece_id"), row.get("piece_id")),
            ("version_id", receipt.get("version_id"), row.get("id")),
            ("asset_dir", receipt.get("asset_dir"), row.get("asset_dir")),
            (
                "job_id",
                receipt.get("job_id"),
                row.get("created_by_job_id"),
            ),
            (
                "receipt_sha256",
                receipt.get("receipt_sha256"),
                row.get("receipt_sha256"),
            ),
            (
                "audio_sha256",
                (receipt.get("files") or {}).get("audio.mp3", {}).get("sha256"),
                row.get("audio_sha256"),
            ),
            (
                "code_sha256",
                (receipt.get("files") or {}).get("piece.js", {}).get("sha256"),
                row.get("code_sha256"),
            ),
        )
        for field, receipt_value, database_value in checks:
            if receipt_value != database_value:
                return (
                    False,
                    f"receipt {field} does not match the registered revision",
                )
        if not math.isclose(
            float(receipt.get("duration_seconds") or 0.0),
            float(row.get("duration_seconds") or 0.0),
            rel_tol=1e-9,
            abs_tol=1e-9,
        ):
            return False, "receipt duration does not match the registered revision"
        return True, None

    # ------------------------------------------------------------------
    # Restart recovery

    def adopt_commit_intents(self) -> dict:
        """Complete or abandon interrupted render commits exactly (DT-001).

        Adoption happens before interrupted-job marking, so a job whose
        promote landed but whose registration was lost finishes as the
        succeeded work it truthfully was. Anything that does not match its
        recorded intent byte-for-byte is abandoned and retained as explicit
        orphan evidence.
        """

        adopted: list[dict] = []
        abandoned: list[dict] = []
        for intent in self.store.list_commit_intents(
            statuses=("pending", "promoted")
        ):
            entry = {
                "job_id": intent["job_id"],
                "piece_id": intent["piece_id"],
                "version_id": intent["version_id"],
                "receipt_sha256": intent["receipt_sha256"],
            }
            registration = intent.get("registration_json")
            adoptable = False
            reason = ""
            try:
                live_receipt = self.assets.load_receipt(
                    str(intent["piece_id"]), str(intent["version_id"])
                )
            except (AssetError, ReceiptConflict) as exc:
                reason = f"no adoptable promoted receipt: {exc}"
            else:
                if live_receipt.get("receipt_sha256") == intent["receipt_sha256"]:
                    adoptable = True
                else:
                    reason = "promoted receipt does not match the recorded intent"
            if adoptable and isinstance(registration, Mapping):
                try:
                    self.store.register_render_success(
                        job_id=str(intent["job_id"]),
                        receipt=live_receipt,
                        piece=registration["piece"],
                        version=registration["version"],
                        model_run=registration["model_run"],
                    )
                except Exception as exc:  # noqa: BLE001
                    # Adoption must never abort startup: any registration
                    # failure (including SQLite constraint conflicts from a
                    # payload recorded before the crash) abandons this one
                    # intent and keeps the promoted directory as orphan
                    # evidence for reconciliation.
                    reason = (
                        "adoption registration failed: "
                        f"{type(exc).__name__}: {exc}"
                    )
                else:
                    entry["outcome"] = "registered"
                    adopted.append(entry)
                    continue
            self.store.mark_commit_intent(
                str(intent["job_id"]), status="abandoned"
            )
            entry["outcome"] = "abandoned"
            entry["reason"] = reason
            abandoned.append(entry)
        return {"adopted": adopted, "abandoned": abandoned}

    def recover_after_restart(self) -> dict:
        adoption = self.adopt_commit_intents()
        interrupted = self.store.recover_interrupted_jobs()
        receipt_reconciliation = self.reconcile_receipts()
        return {
            "commit_intent_adoption": adoption,
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
            "abandoned_commit_intents": [
                {
                    "job_id": intent["job_id"],
                    "piece_id": intent["piece_id"],
                    "version_id": intent["version_id"],
                    "receipt_sha256": intent["receipt_sha256"],
                }
                for intent in self.store.list_commit_intents(
                    statuses=("abandoned",)
                )
            ],
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
