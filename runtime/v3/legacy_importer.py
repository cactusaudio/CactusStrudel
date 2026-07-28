"""Apply a frozen legacy reconciliation plan into an isolated v3 truth store."""

from __future__ import annotations

import base64
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Mapping

from .assets import sha256_file
from .legacy import deterministic_legacy_id
from .service import RuntimeTruth
from .store import InvalidTransition, json_sha256


class LegacyImportError(RuntimeError):
    pass


class LegacyImporter:
    """Copy importable corpus evidence; never consumes Recovery candidates."""

    WORKER_ID = "legacy-importer-v1"

    def __init__(
        self,
        *,
        repo_root: str | Path,
        db_path: str | Path,
        assets_root: str | Path,
        duration_probe=None,
    ):
        self.repo_root = Path(repo_root).expanduser().resolve()
        self.db_path = Path(db_path).expanduser().resolve()
        self.assets_root = Path(assets_root).expanduser().resolve()
        self.duration_probe = duration_probe

    def preflight(self, plan: Mapping[str, Any]) -> dict:
        if plan.get("schema_version") != 1 or plan.get("mode") != "dry-run":
            raise LegacyImportError("expected a schema_version=1 dry-run plan")
        entries = plan.get("corpus_entries")
        if not isinstance(entries, list):
            raise LegacyImportError("plan corpus_entries must be a list")

        snapshots = plan.get("source_snapshots")
        if not isinstance(snapshots, dict):
            raise LegacyImportError("plan source_snapshots are missing")
        for label in ("corpus", "revisions", "tasks"):
            snapshot = snapshots.get(label)
            if not isinstance(snapshot, dict):
                raise LegacyImportError(f"source snapshot is missing: {label}")
            path = Path(str(snapshot.get("path") or "")).expanduser().resolve()
            if bool(snapshot.get("exists")):
                if not path.is_file():
                    raise LegacyImportError(f"source snapshot disappeared: {path}")
                actual_sha = sha256_file(path)
                if actual_sha != snapshot.get("sha256"):
                    raise LegacyImportError(
                        f"source snapshot changed after dry-run: {label}"
                    )
            elif path.exists():
                raise LegacyImportError(
                    f"source snapshot appeared after dry-run: {label}"
                )

        planned = int((plan.get("summary") or {}).get("corpus_rows_planned", -1))
        if planned != len(entries):
            raise LegacyImportError("plan summary row count does not match entries")

        piece_ids: set[str] = set()
        version_ids: set[str] = set()
        names: set[str] = set()
        importable = 0
        for entry in entries:
            if not isinstance(entry, dict):
                raise LegacyImportError("corpus entry plan is not an object")
            spec = entry.get("import_spec")
            if not isinstance(spec, dict):
                raise LegacyImportError(
                    f"entry has no import_spec: {entry.get('legacy_name')}"
                )
            blocking = spec.get("blocking_reasons")
            if blocking:
                raise LegacyImportError(
                    f"plan contains blocked corpus row {entry.get('legacy_name')}: "
                    f"{blocking}"
                )
            piece_spec = spec.get("piece") or {}
            version_spec = spec.get("version") or {}
            piece_id = str(piece_spec.get("id") or "")
            version_id = str(version_spec.get("id") or "")
            display_name = str(piece_spec.get("display_name") or "")
            if not piece_id or not version_id or not display_name:
                raise LegacyImportError("import spec is missing stable identity")
            if (
                piece_id in piece_ids
                or version_id in version_ids
                or display_name in names
            ):
                raise LegacyImportError("plan contains duplicate stable identity")
            piece_ids.add(piece_id)
            version_ids.add(version_id)
            names.add(display_name)

            self._verify_planned_asset(entry, "js", required=True)
            self._verify_planned_asset(entry, "mp3", required=True)
            self._verify_planned_asset(entry, "prompt", required=False)
            self._verify_planned_asset(entry, "prompt_json", required=False)
            score = (entry.get("score_evidence") or {}).get("score")
            if score is not None:
                try:
                    numeric = float(score)
                except (TypeError, ValueError) as exc:
                    raise LegacyImportError(
                        f"non-numeric legacy score: {display_name}"
                    ) from exc
                if not math.isfinite(numeric) or not 0 <= numeric <= 10:
                    raise LegacyImportError(
                        f"legacy score outside 0..10: {display_name}"
                    )
            importable += 1

        expected_importable = int(
            (plan.get("summary") or {}).get("corpus_rows_importable", -1)
        )
        if expected_importable != importable:
            raise LegacyImportError(
                "plan importable count does not match preflight result"
            )
        return {
            "ok": True,
            "corpus_rows": len(entries),
            "importable_rows": importable,
            "recovery_candidates_excluded": len(plan.get("recovery_candidates") or []),
            "source_snapshots": snapshots,
        }

    def apply(self, plan: Mapping[str, Any]) -> dict:
        """Apply exactly `corpus_entries`; Recovery candidates are never read."""

        preflight = self.preflight(plan)
        truth = RuntimeTruth(
            repo_root=self.repo_root,
            db_path=self.db_path,
            assets_root=self.assets_root,
            duration_probe=self.duration_probe,
        )
        corpus_sha = str((plan["source_snapshots"]["corpus"] or {}).get("sha256") or "")
        imported: list[str] = []
        existing: list[str] = []
        ratings_imported = 0
        ratings_existing = 0

        for entry in plan["corpus_entries"]:
            spec = entry["import_spec"]
            piece_spec = dict(spec["piece"])
            version_spec = dict(spec["version"])
            piece_id = str(piece_spec["id"])
            version_id = str(version_spec["id"])
            display_name = str(piece_spec["display_name"])
            source_line = int(entry["source_line"])
            import_key = f"legacy-import:v1:{corpus_sha}:{source_line}"
            job_id = deterministic_legacy_id("job", import_key)
            job_payload = {
                "source": "legacy-corpus-jsonl",
                "source_snapshot_sha256": corpus_sha,
                "source_line": source_line,
                "legacy_name": display_name,
                "piece_id": piece_id,
                "version_id": version_id,
                "plan_entry_sha256": json_sha256(entry),
            }
            job, created = truth.store.create_job(
                kind="legacy_import",
                payload=job_payload,
                idempotency_key=import_key,
                job_id=job_id,
            )

            if job["status"] in {"succeeded", "cancelled_after_commit"}:
                version = truth.store.get_version(version_id)
                truth.assets.load_receipt(piece_id, version_id)
                existing.append(display_name)
            else:
                if job["status"] == "queued":
                    job = truth.start_job(job["id"], worker_id=self.WORKER_ID)
                elif job["status"] == "running" and job["worker_id"] == self.WORKER_ID:
                    pass
                else:
                    raise InvalidTransition(
                        f"legacy import job {job['id']} cannot resume from {job['status']}"
                    )

                code_bytes = self._verified_bytes(entry, "js")
                prompt_receipt = self._legacy_prompt_receipt(
                    entry=entry, corpus_sha=corpus_sha
                )
                staged = truth.stage_render(
                    job_id=job["id"],
                    piece_id=piece_id,
                    version_id=version_id,
                    code=code_bytes,
                    audio_path=Path(entry["files"]["mp3"]["path"]),
                    prompt=prompt_receipt,
                )
                if staged.files["piece.js"]["sha256"] != entry["files"]["js"]["sha256"]:
                    raise LegacyImportError(f"code changed during copy: {display_name}")
                if (
                    staged.files["audio.mp3"]["sha256"]
                    != entry["files"]["mp3"]["sha256"]
                ):
                    raise LegacyImportError(
                        f"audio changed during copy: {display_name}"
                    )

                provenance = self._provenance(
                    entry=entry,
                    corpus_sha=corpus_sha,
                )
                piece_fields = {
                    key: value
                    for key, value in piece_spec.items()
                    if key not in {"id", "display_name"} and value is not None
                }
                version_fields = {
                    key: value
                    for key, value in version_spec.items()
                    if key
                    in {
                        "parent_version_id",
                        "kind",
                        "state",
                        "created_at",
                    }
                    and value is not None
                }
                result = truth.commit_rendered_version(
                    staged=staged,
                    display_name=display_name,
                    provenance=provenance,
                    model_run={
                        "provider_route": "legacy_unknown",
                        "model_id": "legacy_unknown",
                        "reasoning_effort": None,
                        "orchestration": "legacy_import",
                        "kernel_hash": None,
                        "validator_mode": "not_recorded",
                        "request_receipt": job_payload,
                        "response_receipt": {
                            "classification": "legacy_unknown",
                            "source_label": entry["recorded"].get("source_label"),
                        },
                    },
                    piece_fields=piece_fields,
                    version_fields=version_fields,
                )
                version = result["version"]
                if version is None:
                    raise LegacyImportError(
                        f"legacy import was cancelled unexpectedly: {display_name}"
                    )
                imported.append(display_name)

            score_evidence = entry.get("score_evidence") or {}
            if score_evidence.get("score") is not None:
                rating_key = f"{import_key}:rating"
                before = self._rating_exists(truth, rating_key)
                # Historical score evidence is migrated at the store layer:
                # the RuntimeTruth usability gate governs NEW product scoring,
                # not the transfer of an already-recorded legacy rating.
                truth.store.rate_version(
                    piece_version_id=version_id,
                    audio_sha256=version["audio_sha256"],
                    score=float(score_evidence["score"]),
                    note=score_evidence.get("note"),
                    source_key=rating_key,
                    created_at=score_evidence.get("recorded_at"),
                )
                if before:
                    ratings_existing += 1
                else:
                    ratings_imported += 1

        reconciliation = truth.reconcile_receipts()
        return {
            "ok": True,
            "mode": "apply",
            "preflight": preflight,
            "db": str(self.db_path),
            "assets_root": str(self.assets_root),
            "pieces_imported": len(imported),
            "pieces_existing": len(existing),
            "ratings_imported": ratings_imported,
            "ratings_existing": ratings_existing,
            "imported_names": imported,
            "existing_names": existing,
            "recovery_candidates_excluded": len(plan.get("recovery_candidates") or []),
            "receipt_reconciliation": {
                "matched": len(reconciliation["matched"]),
                "orphan_promoted": len(reconciliation["orphan_promoted"]),
                "invalid": len(reconciliation["invalid"]),
                "registered_receipt_identity_mismatch": len(
                    reconciliation["registered_receipt_identity_mismatch"]
                ),
                "registered_without_valid_receipt": len(
                    reconciliation["registered_without_valid_receipt"]
                ),
            },
        }

    @staticmethod
    def _rating_exists(truth: RuntimeTruth, source_key: str) -> bool:
        with truth.database.transaction(immediate=False) as conn:
            return (
                conn.execute(
                    "SELECT 1 FROM ratings WHERE source_key = ?", (source_key,)
                ).fetchone()
                is not None
            )

    def _verify_planned_asset(
        self, entry: Mapping[str, Any], key: str, *, required: bool
    ) -> None:
        info = (entry.get("files") or {}).get(key)
        if not isinstance(info, dict):
            raise LegacyImportError(
                f"asset plan is missing {key}: {entry.get('legacy_name')}"
            )
        if not info.get("exists"):
            if required:
                raise LegacyImportError(
                    f"required asset is missing: {entry.get('legacy_name')}/{key}"
                )
            return
        path = Path(str(info.get("path") or "")).expanduser().resolve()
        if not path.is_file() or sha256_file(path) != info.get("sha256"):
            raise LegacyImportError(
                f"asset changed after dry-run: {entry.get('legacy_name')}/{key}"
            )

    @staticmethod
    def _verified_bytes(entry: Mapping[str, Any], key: str) -> bytes:
        info = entry["files"][key]
        path = Path(info["path"])
        value = path.read_bytes()

        if hashlib.sha256(value).hexdigest() != info["sha256"]:
            raise LegacyImportError(
                f"asset changed during import: {entry.get('legacy_name')}/{key}"
            )
        return value

    def _legacy_prompt_receipt(
        self, *, entry: Mapping[str, Any], corpus_sha: str
    ) -> dict:
        payload: dict[str, Any] = {
            "schema_version": 1,
            "mode": "legacy_import",
            "source_snapshot_sha256": corpus_sha,
            "source_line": entry["source_line"],
            "legacy_name": entry["legacy_name"],
            "recorded_paths": {
                "prompt": entry["recorded"].get("prompt"),
                "prompt_json": entry["recorded"].get("prompt_json"),
            },
        }
        for key in ("prompt", "prompt_json"):
            info = entry["files"][key]
            if not info.get("exists"):
                payload[key] = None
                continue
            raw = self._verified_bytes(entry, key)
            payload[f"{key}_sha256"] = info["sha256"]
            if key == "prompt":
                try:
                    payload["prompt_text"] = raw.decode("utf-8")
                except UnicodeDecodeError:
                    payload["prompt_base64"] = base64.b64encode(raw).decode("ascii")
            else:
                try:
                    decoded = raw.decode("utf-8")
                    payload["prompt_json_text"] = decoded
                    payload["prompt_json"] = json.loads(decoded)
                except (UnicodeDecodeError, json.JSONDecodeError):
                    payload["prompt_json_base64"] = base64.b64encode(raw).decode(
                        "ascii"
                    )
        return payload

    @staticmethod
    def _provenance(*, entry: Mapping[str, Any], corpus_sha: str) -> dict:
        return {
            "provider_route": "legacy_unknown",
            "model_id": "legacy_unknown",
            "reasoning_effort": None,
            "orchestration": "legacy_import",
            "kernel_hash": None,
            "validator_mode": "not_recorded",
            "legacy": {
                "source": "producer-brain/corpus.jsonl",
                "source_snapshot_sha256": corpus_sha,
                "source_line": entry["source_line"],
                "classifications": list(entry["classifications"]),
                "provenance_class": entry["provenance_class"],
                "duplicate_of": entry.get("duplicate_of"),
                "duplicate_group": entry.get("duplicate_group"),
                "recorded": dict(entry["recorded"]),
                "actual": {
                    "code_sha256": entry["files"]["js"].get("sha256"),
                    "audio_sha256": entry["files"]["mp3"].get("sha256"),
                },
                "source_row": dict(entry["source_row"]),
                "score_evidence": dict(entry.get("score_evidence") or {}),
            },
        }
