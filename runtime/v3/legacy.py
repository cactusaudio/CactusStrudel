"""Read-only legacy inventory and reconciliation planning.

Nothing in this module rewrites JSONL, moves assets, invents provenance, or
decides whether recovery candidates belong in Bowei's active library.
"""

from __future__ import annotations

import json
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping

from .assets import sha256_file
from .store import utc_now


LEGACY_NAMESPACE = uuid.UUID("c704e167-5f08-4a72-b077-f483db43b26a")


def deterministic_legacy_id(kind: str, source: str) -> str:
    return f"{kind}_{uuid.uuid5(LEGACY_NAMESPACE, source).hex}"


def _file_snapshot(path: Path) -> dict:
    if not path.is_file():
        return {"path": str(path), "exists": False, "rows": 0, "sha256": None}
    rows = sum(
        1 for line in path.read_text(encoding="utf-8").splitlines() if line.strip()
    )
    return {
        "path": str(path),
        "exists": True,
        "rows": rows,
        "sha256": sha256_file(path),
    }


def _read_jsonl(path: Path) -> tuple[list[tuple[int, dict]], list[dict]]:
    rows: list[tuple[int, dict]] = []
    errors: list[dict] = []
    if not path.is_file():
        return rows, errors
    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            errors.append(
                {
                    "classification": "invalid_json",
                    "path": str(path),
                    "line": line_no,
                    "error": str(exc),
                }
            )
            continue
        if not isinstance(value, dict):
            errors.append(
                {
                    "classification": "invalid_json_shape",
                    "path": str(path),
                    "line": line_no,
                }
            )
            continue
        rows.append((line_no, value))
    return rows, errors


class LegacyReconcilePlanner:
    def __init__(
        self,
        *,
        repo_root: str | Path,
        corpus_path: str | Path | None = None,
        revisions_path: str | Path | None = None,
        tasks_path: str | Path | None = None,
    ):
        self.repo_root = Path(repo_root).expanduser().resolve()
        self.corpus_path = self._resolve(corpus_path or "producer-brain/corpus.jsonl")
        self.revisions_path = self._resolve(
            revisions_path or "producer-brain/revisions.jsonl"
        )
        self.tasks_path = self._resolve(
            tasks_path or "archive/runtime-v2/data/cc-bridge/tasks.jsonl"
        )

    def build_plan(self) -> dict:
        corpus_rows, corpus_errors = _read_jsonl(self.corpus_path)
        revision_rows, revision_errors = _read_jsonl(self.revisions_path)
        task_rows, task_errors = _read_jsonl(self.tasks_path)

        entries = [
            self._inspect_corpus_row(line_no, row) for line_no, row in corpus_rows
        ]
        duplicate_groups = self._mark_duplicates(entries)
        revisions = [
            self._inspect_revision_row(line_no, row) for line_no, row in revision_rows
        ]
        recovery = self._recovery_candidates(task_rows, entries)

        counts: dict[str, int] = defaultdict(int)
        for entry in entries:
            for classification in entry["classifications"]:
                counts[classification] += 1
        for revision in revisions:
            for classification in revision["classifications"]:
                counts[classification] += 1
        counts["recovery_candidate"] = len(recovery)
        counts["corpus_rows_planned"] = len(entries)
        counts["corpus_rows_importable"] = sum(
            not entry["import_spec"]["blocking_reasons"] for entry in entries
        )
        counts["invalid_json_or_shape"] = (
            len(corpus_errors) + len(revision_errors) + len(task_errors)
        )

        return {
            "schema_version": 1,
            "mode": "dry-run",
            "generated_at": utc_now(),
            "invariants": [
                "source JSONL files are read-only",
                "source assets are not moved or deleted",
                "legacy source labels never become exact model provenance",
                "duplicates remain evidence until a human chooses otherwise",
                "recovery candidates require an explicit human import decision",
                "hash drift is represented as legacy evidence, never normalized away",
            ],
            "source_snapshots": {
                "corpus": _file_snapshot(self.corpus_path),
                "revisions": _file_snapshot(self.revisions_path),
                "tasks": _file_snapshot(self.tasks_path),
            },
            "summary": dict(sorted(counts.items())),
            "duplicate_groups": duplicate_groups,
            "corpus_entries": entries,
            "revision_entries": revisions,
            "recovery_candidates": recovery,
            "parse_errors": corpus_errors + revision_errors + task_errors,
        }

    def _inspect_corpus_row(self, line_no: int, row: Mapping[str, Any]) -> dict:
        name = str(row.get("name") or f"line-{line_no}")
        js_path = self._asset_path(row.get("js"))
        audio_path = self._asset_path(row.get("mp3"))
        prompt_path = self._asset_path(row.get("prompt"))
        prompt_json_path = self._asset_path(row.get("prompt_json"))

        files = {
            "js": self._inspect_asset(js_path),
            "mp3": self._inspect_asset(audio_path),
            "prompt": self._inspect_asset(prompt_path, optional=True),
            "prompt_json": self._inspect_asset(prompt_json_path, optional=True),
        }
        classifications: list[str] = []
        missing_required = [
            key for key in ("js", "mp3") if not files[key].get("exists")
        ]
        if missing_required:
            classifications.append("missing_asset")

        recorded_sha = str(row.get("sha") or "").strip().lower()
        actual_audio_sha = files["mp3"].get("sha256")
        if (
            recorded_sha
            and actual_audio_sha
            and not str(actual_audio_sha).startswith(recorded_sha)
        ):
            classifications.append("hash_drift")
            classifications.append("legacy_partial")

        provenance_class = (
            "exact" if self._has_exact_provenance(row) else "legacy_unknown"
        )
        if provenance_class == "legacy_unknown":
            classifications.append("legacy_unknown")

        if not classifications:
            classifications.append("legacy_ready")
        if "missing_asset" in classifications:
            recommended_action = "quarantine_missing_asset_reference"
        elif "hash_drift" in classifications:
            recommended_action = "import_as_explicit_legacy_drift_version"
        else:
            recommended_action = "import_as_immutable_legacy_version"

        identity_source = (
            f"{self.corpus_path}:{line_no}:{name}:{row.get('js')}:{row.get('mp3')}"
        )
        return {
            "source_line": line_no,
            "legacy_name": name,
            "proposed_piece_id": deterministic_legacy_id("piece", identity_source),
            "proposed_version_id": deterministic_legacy_id("version", identity_source),
            "classifications": classifications,
            "provenance_class": provenance_class,
            "recorded": {
                "sha": row.get("sha"),
                "duration": row.get("dur"),
                "source_label": row.get("source"),
                "js": row.get("js"),
                "mp3": row.get("mp3"),
                "prompt": row.get("prompt"),
                "prompt_json": row.get("prompt_json"),
            },
            "source_row": dict(row),
            "score_evidence": {
                "score": row.get("score_bowei"),
                "note": row.get("note_bowei"),
                "recorded_at": row.get("note_ts") or row.get("ts"),
            },
            "files": files,
            "recommended_action": recommended_action,
            "human_decision_required": "missing_asset" in classifications,
            "import_spec": {
                "piece": {
                    "id": deterministic_legacy_id("piece", identity_source),
                    "display_name": name,
                    "legacy_name": name,
                    "collection": "active",
                    "genre_code": row.get("genre_code"),
                    "genre_preset": row.get("genre_preset"),
                    "genre_label": row.get("genre_label"),
                    "category": row.get("category"),
                    "tags": row.get("tags")
                    if isinstance(row.get("tags"), list)
                    else [],
                    "provenance_class": provenance_class,
                    "created_at": row.get("ts"),
                    "archived_at": row.get("archived_at"),
                },
                "version": {
                    "id": deterministic_legacy_id("version", identity_source),
                    "kind": "legacy",
                    "state": (
                        "legacy_partial"
                        if (
                            "hash_drift" in classifications
                            or "missing_asset" in classifications
                        )
                        else "ready"
                    ),
                    "source_js": row.get("js"),
                    "source_mp3": row.get("mp3"),
                    "source_prompt": row.get("prompt"),
                    "source_prompt_json": row.get("prompt_json"),
                    "actual_code_sha256": files["js"].get("sha256"),
                    "actual_audio_sha256": files["mp3"].get("sha256"),
                    "recorded_audio_sha": row.get("sha"),
                    "recorded_duration": row.get("dur"),
                    "created_at": row.get("ts"),
                },
                "blocking_reasons": (
                    ["missing_required_asset"] if missing_required else []
                ),
            },
        }

    def _mark_duplicates(self, entries: list[dict]) -> list[dict]:
        by_content: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for entry in entries:
            js_sha = entry["files"]["js"].get("sha256")
            mp3_sha = entry["files"]["mp3"].get("sha256")
            if js_sha and mp3_sha:
                by_content[(js_sha, mp3_sha)].append(entry)

        groups: list[dict] = []
        for (js_sha, mp3_sha), members in by_content.items():
            if len(members) < 2:
                continue
            canonical = members[0]
            member_names = [item["legacy_name"] for item in members]
            group = {
                "classification": "duplicate_evidence",
                "canonical_legacy_name": canonical["legacy_name"],
                "members": member_names,
                "code_sha256": js_sha,
                "audio_sha256": mp3_sha,
                "recommended_action": "preserve_canonical_and_duplicate_evidence_link",
                "human_decision_required": True,
            }
            groups.append(group)
            for member in members:
                member["duplicate_group"] = {
                    "canonical_legacy_name": canonical["legacy_name"],
                    "members": member_names,
                    "code_sha256": js_sha,
                    "audio_sha256": mp3_sha,
                }
            for duplicate in members[1:]:
                if "legacy_ready" in duplicate["classifications"]:
                    duplicate["classifications"].remove("legacy_ready")
                duplicate["classifications"].append("duplicate_evidence")
                duplicate["duplicate_of"] = canonical["legacy_name"]
                duplicate["recommended_action"] = "preserve_duplicate_evidence_link"
                duplicate["human_decision_required"] = True
        return groups

    def _inspect_revision_row(self, line_no: int, row: Mapping[str, Any]) -> dict:
        classifications: list[str] = []
        code = row.get("code") if isinstance(row.get("code"), dict) else {}
        delta = code.get("delta_chars")
        from_sha = row.get("from_sha")
        to_sha = row.get("to_sha")
        from_dur = row.get("from_dur")
        to_dur = row.get("to_dur")

        contradictory = bool(
            (delta not in (None, 0) and from_sha and to_sha and from_sha == to_sha)
            or (
                row.get("score_before") is not None
                and row.get("score_after") is not None
                and row.get("score_delta") is None
            )
        )
        incomplete = any(
            value is None for value in (from_sha, to_sha, from_dur, to_dur)
        )
        if contradictory or incomplete:
            classifications.append("legacy_partial")
        else:
            classifications.append("legacy_revision_ready")
        return {
            "source_line": line_no,
            "legacy_revision_id": row.get("id"),
            "piece": row.get("piece"),
            "classifications": classifications,
            "evidence": {
                "delta_chars": delta,
                "from_sha": from_sha,
                "to_sha": to_sha,
                "from_dur": from_dur,
                "to_dur": to_dur,
                "score_before": row.get("score_before"),
                "score_after": row.get("score_after"),
                "score_delta": row.get("score_delta"),
                "backup_dir": row.get("backup_dir"),
            },
            "recommended_action": (
                "import_revision_evidence_without_inventing_delta"
                if classifications == ["legacy_partial"]
                else "import_revision_evidence"
            ),
        }

    def _recovery_candidates(
        self,
        task_rows: Iterable[tuple[int, Mapping[str, Any]]],
        entries: Iterable[Mapping[str, Any]],
    ) -> list[dict]:
        registered_paths = {
            (
                entry["recorded"].get("js"),
                entry["recorded"].get("mp3"),
            )
            for entry in entries
        }
        content_to_piece = {
            (
                entry["files"]["js"].get("sha256"),
                entry["files"]["mp3"].get("sha256"),
            ): entry["legacy_name"]
            for entry in entries
            if entry["files"]["js"].get("sha256")
            and entry["files"]["mp3"].get("sha256")
        }
        recovery: list[dict] = []
        for line_no, task in task_rows:
            if task.get("status") != "done":
                continue
            result = task.get("result")
            if not isinstance(result, dict):
                continue
            js_rel, mp3_rel = result.get("js"), result.get("mp3")
            if not js_rel or not mp3_rel or (js_rel, mp3_rel) in registered_paths:
                continue
            js_info = self._inspect_asset(self._asset_path(js_rel))
            mp3_info = self._inspect_asset(self._asset_path(mp3_rel))
            if not js_info.get("exists") or not mp3_info.get("exists"):
                continue
            duplicate_of = content_to_piece.get(
                (js_info.get("sha256"), mp3_info.get("sha256"))
            )
            recovery.append(
                {
                    "classification": "recovery_candidate",
                    "source_line": line_no,
                    "task_id": task.get("id"),
                    "task_status": "done",
                    "js": js_rel,
                    "mp3": mp3_rel,
                    "files": {"js": js_info, "mp3": mp3_info},
                    "duplicate_content_of": duplicate_of,
                    "provenance_class": "legacy_unknown",
                    "recommended_action": "offer_human_import_to_recovery_collection",
                    "human_decision_required": True,
                }
            )
        return recovery

    def _resolve(self, value: str | Path) -> Path:
        path = Path(value).expanduser()
        return (
            path.resolve() if path.is_absolute() else (self.repo_root / path).resolve()
        )

    def _asset_path(self, value: Any) -> Path | None:
        if not value:
            return None
        return self._resolve(str(value))

    @staticmethod
    def _inspect_asset(path: Path | None, *, optional: bool = False) -> dict:
        if path is None:
            return {
                "path": None,
                "exists": False,
                "optional": optional,
                "sha256": None,
                "bytes": None,
            }
        if not path.is_file():
            return {
                "path": str(path),
                "exists": False,
                "optional": optional,
                "sha256": None,
                "bytes": None,
            }
        return {
            "path": str(path),
            "exists": True,
            "optional": optional,
            "sha256": sha256_file(path),
            "bytes": path.stat().st_size,
        }

    @staticmethod
    def _has_exact_provenance(row: Mapping[str, Any]) -> bool:
        provenance = row.get("provenance")
        if not isinstance(provenance, dict):
            return False
        return all(
            isinstance(provenance.get(key), str) and provenance.get(key)
            for key in ("provider_route", "model_id", "orchestration")
        )
