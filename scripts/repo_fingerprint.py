#!/usr/bin/env python3
"""Commit-independent identity for the effective CactusStrudel source tree.

The source identity covers tracked working bytes, Git-exposed index entry
content plus raw entry flags, and all non-ignored untracked source paths/content.
Generated builds, runtime data, caches, and generated STATE/handoff readbacks are
excluded. HEAD and landing metadata are reported separately, so an intentionally
dirty cutover can be attested and rebuilt without first creating a commit.

This intentionally does not hash byte-for-byte index storage details such as the
stat cache or index extensions. ``index_tree_sha256`` names the material entry
identity exposed by ``git ls-files --stage --debug``: path, mode, object, stage,
and raw flags.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import tempfile
from typing import Any, Iterable

SCHEMA_VERSION = 2
STATE_PATH = "docs/STATE.md"
PACKAGE_MANIFEST = "SOURCE_BASELINE.json"
BUILD_RECEIPT_NAME = "cactus-build-receipt.json"

_EXCLUDED_DIRECTORY_NAMES = frozenset(
    {
        ".git",
        ".cache",
        ".playwright-cli",
        ".pytest_cache",
        ".ruff_cache",
        ".turbo",
        ".vscode",
        ".idea",
        "__pycache__",
        "coverage",
        "dist",
        "node_modules",
        "output",
        "playwright-report",
        "test-results",
    }
)
_EXCLUDED_SUFFIXES = (".pyc", ".pyo", ".tsbuildinfo", ".swp")


class FingerprintError(RuntimeError):
    """The repository could not be fingerprinted without guessing."""


def _git(root: Path, *args: str, allow_failure: bool = False) -> bytes:
    completed = subprocess.run(
        ("git", *args), cwd=root, capture_output=True, check=False
    )
    if completed.returncode != 0 and not allow_failure:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise FingerprintError(
            f"git {' '.join(args)} failed with {completed.returncode}: {detail}"
        )
    return completed.stdout if completed.returncode == 0 else b""


def _text(value: bytes) -> str:
    return value.decode("utf-8", errors="surrogateescape").strip()


def _paths(raw: bytes) -> list[str]:
    return [
        part.decode("utf-8", errors="surrogateescape")
        for part in raw.split(b"\0")
        if part
    ]


def is_source_path(relative_path: str) -> bool:
    """Return whether a repository path participates in source identity."""

    normalized = PurePosixPath(relative_path).as_posix()
    while normalized.startswith("./"):
        normalized = normalized[2:]
    if not normalized or normalized in {STATE_PATH, PACKAGE_MANIFEST}:
        return False
    path = PurePosixPath(normalized)
    if path.name in {BUILD_RECEIPT_NAME, ".DS_Store"}:
        return False
    if any(part in _EXCLUDED_DIRECTORY_NAMES for part in path.parts):
        return False
    if normalized == "runtime/app" or normalized.startswith("runtime/app/"):
        return False
    if normalized.startswith(("runtime/data/", "runtime/state/")):
        return False
    if normalized.startswith(("producer-brain/audio/", "producer-brain/assets/")):
        return False
    if normalized.startswith("archive/local/") and normalized != "archive/local/README.md":
        return False
    if normalized.startswith("handoffs/") and normalized != "handoffs/README.md":
        return False
    return not normalized.endswith(_EXCLUDED_SUFFIXES)


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8", errors="surrogateescape")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _path_mode(path: Path) -> str:
    mode = path.lstat().st_mode
    if stat.S_ISLNK(mode):
        return "120000"
    if not stat.S_ISREG(mode):
        raise FingerprintError(f"unsupported source path type: {path}")
    return "100755" if mode & stat.S_IXUSR else "100644"


def hash_path(path: Path) -> tuple[str, int]:
    if path.is_symlink():
        content = os.readlink(path).encode("utf-8", errors="surrogateescape")
        return sha256_bytes(content), len(content)
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
    except OSError as exc:
        raise FingerprintError(f"could not hash {path}: {exc}") from exc
    return digest.hexdigest(), size


def filesystem_entry(root: Path, relative_path: str) -> dict[str, Any] | None:
    path = root / relative_path
    try:
        path.lstat()
    except FileNotFoundError:
        return None
    content_sha256, size = hash_path(path)
    return {
        "path": relative_path,
        "mode": _path_mode(path),
        "bytes": size,
        "sha256": content_sha256,
    }


def tree_hash(entries: Iterable[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for entry in sorted(entries, key=lambda item: tuple(str(item.get(key, "")) for key in ("path", "stage"))):
        digest.update(canonical_json(entry))
        digest.update(b"\n")
    return digest.hexdigest()


def _parse_index(raw: bytes) -> list[dict[str, Any]]:
    """Parse material index entries, including every Git-exposed raw flag bit.

    ``git ls-files --debug`` also prints mutable filesystem stat-cache fields.
    Those are intentionally ignored: they are an acceleration detail, not staged
    source or checkout policy. The raw hexadecimal ``flags`` value is retained so
    known flags and future Git flags participate without silently narrowing the
    identity.
    """

    pattern = re.compile(
        rb"(?P<mode>[0-7]{6}) (?P<object>[0-9a-fA-F]+) (?P<stage>[0-3])\t"
        rb"(?P<path>[^\0]*)\0"
        rb"  ctime: [^\n]*\n"
        rb"  mtime: [^\n]*\n"
        rb"  dev: [^\n]*\n"
        rb"  uid: [^\n]*\n"
        rb"  size: [^\n]*\tflags: (?P<flags>[0-9a-fA-F]+)\n"
    )
    entries: list[dict[str, Any]] = []
    position = 0
    while position < len(raw):
        match = pattern.match(raw, position)
        if not match:
            preview = raw[position : position + 160].decode(
                "utf-8", errors="backslashreplace"
            )
            raise FingerprintError(
                f"unexpected git ls-files --stage --debug record near {preview!r}"
            )
        position = match.end()
        relative_path = match.group("path").decode(
            "utf-8", errors="surrogateescape"
        )
        if not is_source_path(relative_path):
            continue
        raw_flags = int(match.group("flags"), 16)
        entries.append(
            {
                "path": relative_path,
                "mode": match.group("mode").decode("ascii"),
                "object": match.group("object").decode("ascii").lower(),
                "stage": match.group("stage").decode("ascii"),
                "flags": {
                    "raw_hex": format(raw_flags, "x"),
                    "assume_unchanged": bool(raw_flags & 0x00008000),
                    "extended": bool(raw_flags & 0x00004000),
                    "intent_to_add": bool(raw_flags & 0x20000000),
                    "skip_worktree": bool(raw_flags & 0x40000000),
                },
            }
        )
    return sorted(entries, key=lambda item: (item["path"], item["stage"]))


def _parse_name_status(raw: bytes, prefix: str) -> list[str]:
    values = _paths(raw)
    if len(values) % 2:
        raise FingerprintError("unexpected git diff --name-status -z output")
    result: list[str] = []
    for index in range(0, len(values), 2):
        status_code, relative_path = values[index], values[index + 1]
        if is_source_path(relative_path):
            result.append(f"{prefix} {status_code} {relative_path}")
    return sorted(result)


def snapshot_repository(root: Path, *, include_paths: bool = False) -> dict[str, Any]:
    """Return source, Git-exposed index-entry, untracked, and landing identities.

    ``working_tree_sha256`` is commit-independent: committing an already staged
    tree leaves it unchanged. It is nevertheless stage-aware because it includes
    the material index-entry manifest in addition to current source bytes. The
    separate ``landing_state_sha256`` includes HEAD and relative status metadata.
    Git index stat-cache fields and extension serialization are deliberately not
    claimed; all raw per-entry flags exposed by Git are included.
    """

    root = root.expanduser().resolve()
    inside = _text(_git(root, "rev-parse", "--is-inside-work-tree", allow_failure=True))
    if inside != "true":
        return {
            "available": False,
            "schema_version": SCHEMA_VERSION,
            "error": "not a Git working tree",
        }

    head = _text(_git(root, "rev-parse", "HEAD", allow_failure=True)) or "unborn"
    branch = _text(_git(root, "branch", "--show-current", allow_failure=True)) or "(detached)"
    object_format = _text(
        _git(root, "rev-parse", "--show-object-format", allow_failure=True)
    ) or "unknown"

    index_entries = _parse_index(
        _git(root, "ls-files", "--stage", "--debug", "-z")
    )
    index_paths = {entry["path"] for entry in index_entries}
    untracked_paths = sorted(
        path
        for path in _paths(
            _git(root, "ls-files", "--others", "--exclude-standard", "-z")
        )
        if is_source_path(path)
    )

    tracked_worktree_entries: list[dict[str, Any]] = []
    for relative_path in sorted(index_paths):
        entry = filesystem_entry(root, relative_path)
        if entry is not None:
            tracked_worktree_entries.append(entry)
    untracked_entries = [
        entry
        for relative_path in untracked_paths
        if (entry := filesystem_entry(root, relative_path)) is not None
    ]
    effective_entries = sorted(
        tracked_worktree_entries + untracked_entries,
        key=lambda item: item["path"],
    )

    staged_preview = _parse_name_status(
        _git(root, "diff", "--cached", "--name-status", "-z", "--no-renames", "--"),
        "S",
    )
    unstaged_preview = _parse_name_status(
        _git(root, "diff", "--name-status", "-z", "--no-renames", "--"),
        "W",
    )
    untracked_preview = [f"? {path}" for path in untracked_paths]
    status_preview = sorted(staged_preview + unstaged_preview + untracked_preview)

    effective_tree_sha256 = tree_hash(effective_entries)
    tracked_worktree_sha256 = tree_hash(tracked_worktree_entries)
    index_tree_sha256 = tree_hash(index_entries)
    index_flags_manifest = [
        {
            "path": entry["path"],
            "stage": entry["stage"],
            "flags": entry["flags"],
        }
        for entry in index_entries
    ]
    index_flags_sha256 = tree_hash(index_flags_manifest)
    untracked_tree_sha256 = tree_hash(untracked_entries)
    staged_state_sha256 = sha256_bytes(
        canonical_json(
            {
                "schema_version": SCHEMA_VERSION,
                "object_format": object_format,
                "index_tree_sha256": index_tree_sha256,
                "index_flags_sha256": index_flags_sha256,
            }
        )
    )
    unstaged_state_sha256 = sha256_bytes(
        canonical_json(
            {
                "index_tree_sha256": index_tree_sha256,
                "index_flags_sha256": index_flags_sha256,
                "tracked_worktree_sha256": tracked_worktree_sha256,
            }
        )
    )

    working_tree_sha256 = sha256_bytes(
        canonical_json(
            {
                "schema_version": SCHEMA_VERSION,
                "object_format": object_format,
                "effective_tree_sha256": effective_tree_sha256,
                "index_tree_sha256": index_tree_sha256,
                "index_flags_sha256": index_flags_sha256,
                "tracked_worktree_sha256": tracked_worktree_sha256,
                "untracked_tree_sha256": untracked_tree_sha256,
            }
        )
    )
    landing_state_sha256 = sha256_bytes(
        canonical_json(
            {
                "schema_version": SCHEMA_VERSION,
                "head": head,
                "working_tree_sha256": working_tree_sha256,
                "staged_state_sha256": staged_state_sha256,
                "unstaged_state_sha256": unstaged_state_sha256,
                "status_entries": status_preview,
            }
        )
    )

    result: dict[str, Any] = {
        "available": True,
        "schema_version": SCHEMA_VERSION,
        "branch": branch,
        "head": head,
        "object_format": object_format,
        "working_tree_sha256": working_tree_sha256,
        "landing_state_sha256": landing_state_sha256,
        "effective_tree_sha256": effective_tree_sha256,
        "tracked_worktree_sha256": tracked_worktree_sha256,
        "index_tree_sha256": index_tree_sha256,
        "index_flags_sha256": index_flags_sha256,
        "untracked_tree_sha256": untracked_tree_sha256,
        "staged_state_sha256": staged_state_sha256,
        "unstaged_state_sha256": unstaged_state_sha256,
        "effective_files": len(effective_entries),
        "effective_bytes": sum(int(entry["bytes"]) for entry in effective_entries),
        "tracked_worktree_files": len(tracked_worktree_entries),
        "index_entries": len(index_entries),
        "untracked_files": len(untracked_entries),
        "untracked_bytes": sum(int(entry["bytes"]) for entry in untracked_entries),
        "staged_changes": len(staged_preview),
        "unstaged_changes": len(unstaged_preview),
        "dirty_entries": len(status_preview),
        "conflicted_paths": len(
            {entry["path"] for entry in index_entries if entry["stage"] != "0"}
        ),
        "status_preview": status_preview[:20],
    }
    if include_paths:
        result["effective_manifest"] = effective_entries
        result["tracked_worktree_manifest"] = tracked_worktree_entries
        result["index_manifest"] = index_entries
        result["index_flags_manifest"] = index_flags_manifest
        result["untracked_manifest"] = untracked_entries
        result["status_entries"] = status_preview
    return result


def atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--root", type=Path, default=Path.cwd())
    result.add_argument("--include-paths", action="store_true")
    result.add_argument("--pretty", action="store_true")
    result.add_argument(
        "--output",
        type=Path,
        help="write the JSON attestation atomically; use a source-excluded path or a path outside the repository",
    )
    return result


def main() -> int:
    args = parser().parse_args()
    root = args.root.expanduser().resolve()
    if args.output:
        output = args.output.expanduser().resolve()
        try:
            relative = output.relative_to(root).as_posix()
        except ValueError:
            relative = None
        if relative is not None and is_source_path(relative):
            print(
                "repo fingerprint output must be source-excluded or outside the repository",
                file=sys.stderr,
            )
            return 2
    try:
        value = snapshot_repository(root, include_paths=args.include_paths)
    except FingerprintError as exc:
        print(f"repo fingerprint failed: {exc}", file=sys.stderr)
        return 2
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        indent=2 if args.pretty else None,
    ).encode("utf-8", errors="surrogateescape") + b"\n"
    if args.output:
        atomic_write(args.output.expanduser().resolve(), payload)
        print(args.output)
    else:
        sys.stdout.buffer.write(payload)
    return 0 if value.get("available") else 1


if __name__ == "__main__":
    raise SystemExit(main())
