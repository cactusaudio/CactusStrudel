#!/usr/bin/env python3
"""Bounded live context, generated state, and handoff support."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from repo_fingerprint import FingerprintError, snapshot_repository


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("CACTUS_BASE", "http://127.0.0.1:8765").rstrip("/")
STATE_PATH = ROOT / "docs" / "STATE.md"
HANDOFF_PATH = ROOT / "handoffs" / "HANDOFF.latest.md"
AREAS_PATH = ROOT / "docs" / "areas.json"


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def run(*args: str) -> str:
    completed = subprocess.run(
        args,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return completed.stdout.strip()


def git_info() -> dict[str, Any]:
    try:
        snapshot = snapshot_repository(ROOT)
    except FingerprintError as exc:
        return {
            "available": False,
            "branch": "unknown",
            "head": "unknown",
            "error": str(exc),
            "status_preview": [],
        }
    if not snapshot.get("available"):
        return {
            "available": False,
            "branch": "unknown",
            "head": "unknown",
            "error": snapshot.get("error") or "Git unavailable",
            "status_preview": [],
        }
    return snapshot


def canonical_db_path() -> Path:
    state_root = os.environ.get("CACTUS_V3_STATE_ROOT")
    if state_root:
        return Path(state_root).expanduser() / "runtime.sqlite3"
    return Path.home() / ".cactus-strudel" / "v3" / "runtime.sqlite3"


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


def grouped_counts(
    conn: sqlite3.Connection, table: str, columns: tuple[str, ...]
) -> list[dict[str, Any]]:
    if not table_exists(conn, table):
        return []
    select = ", ".join(columns)
    group = ", ".join(columns)
    rows = conn.execute(
        f"SELECT {select}, COUNT(*) AS count FROM {table} "
        f"GROUP BY {group} ORDER BY {group}"
    ).fetchall()
    return [dict(row) for row in rows]


def database_info() -> dict[str, Any]:
    path = canonical_db_path()
    result: dict[str, Any] = {
        "path": str(path),
        "exists": path.is_file(),
    }
    if not path.is_file():
        return result
    result["mtime"] = dt.datetime.fromtimestamp(
        path.stat().st_mtime, dt.timezone.utc
    ).isoformat(timespec="seconds")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        tables = {}
        for name in (
            "pieces",
            "piece_versions",
            "ratings",
            "jobs",
            "model_runs",
            "brain_jobs",
            "api_events",
        ):
            if table_exists(conn, name):
                tables[name] = conn.execute(
                    f"SELECT COUNT(*) AS count FROM {name}"
                ).fetchone()["count"]
        result["tables"] = tables
        result["piece_provenance"] = grouped_counts(
            conn, "pieces", ("provenance_class",)
        )
        result["version_states"] = grouped_counts(
            conn, "piece_versions", ("kind", "state")
        )
        result["job_statuses"] = grouped_counts(conn, "jobs", ("kind", "status"))
        if table_exists(conn, "api_events"):
            result["api_cursor"] = conn.execute(
                "SELECT COALESCE(MAX(seq), 0) AS cursor FROM api_events"
            ).fetchone()["cursor"]
        if table_exists(conn, "pieces"):
            row = conn.execute(
                "SELECT id, display_name, created_at FROM pieces "
                "ORDER BY created_at DESC, id DESC LIMIT 1"
            ).fetchone()
            result["latest_piece"] = dict(row) if row else None
    finally:
        conn.close()
    return result


def request_json(path: str) -> dict[str, Any] | None:
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=1.2) as response:
            loaded = json.load(response)
            return loaded if isinstance(loaded, dict) else None
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return None


def masked_server_info() -> dict[str, Any]:
    health = request_json("/api/v2/health")
    bootstrap = request_json("/api/v2/bootstrap") if health else None
    result: dict[str, Any] = {
        "online": health is not None,
        "base_url": BASE_URL,
        "health": health,
    }
    if not bootstrap:
        return result
    settings = bootstrap.get("settings") or {}
    agent = settings.get("agent") or {}
    test = agent.get("test") or {}
    generation = settings.get("generation") or {}
    result["server_time"] = bootstrap.get("server_time")
    result["agent"] = {
        "ready": bool((agent.get("status") or {}).get("ready")),
        "revision_id": agent.get("revision_id"),
        "active_model": (agent.get("active") or {}).get("model_id") or None,
        "draft_model": (agent.get("draft") or {}).get("model_id") or None,
        "draft_key_present": bool((agent.get("draft") or {}).get("key_present")),
        "test_id": test.get("id"),
        "test_ok": bool(test.get("ok")),
        "test_stale": test.get("stale"),
        "catalog_count": len(agent.get("catalog") or []),
    }
    result["generation"] = {
        "revision_id": generation.get("revision_id"),
        "default_profile_id": generation.get("default_profile_id"),
        "profile_ids": [
            profile.get("id")
            for profile in generation.get("profiles") or []
            if isinstance(profile, dict) and profile.get("id")
        ],
        "kernel_hash": generation.get("kernel_hash"),
        "validator_mode": generation.get("validator_mode"),
    }
    return result


def kernel_info() -> dict[str, Any]:
    path = ROOT / "producer-brain" / "kernel.lock.json"
    if not path.is_file():
        return {"path": str(path.relative_to(ROOT)), "exists": False}
    loaded = json.loads(path.read_text(encoding="utf-8"))
    return {
        "path": str(path.relative_to(ROOT)),
        "exists": True,
        "hash": loaded.get("hash"),
        "fragments": len(loaded.get("fragments_used") or []),
        "text_length": loaded.get("text_length"),
    }


def ui_info() -> dict[str, Any]:
    root = ROOT / "runtime" / "app"
    assets = []
    if root.is_dir():
        for path in sorted(root.rglob("*")):
            if path.is_file():
                assets.append(
                    {
                        "path": str(path.relative_to(ROOT)),
                        "bytes": path.stat().st_size,
                    }
                )
    return {"index_present": (root / "index.html").is_file(), "assets": assets}


def command_json(*args: str) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            args,
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError as exc:
        return {
            "available": False,
            "valid": None,
            "reasons": [f"command unavailable: {exc}"],
        }
    try:
        loaded = json.loads(completed.stdout)
    except json.JSONDecodeError:
        detail = completed.stderr.strip() or completed.stdout.strip()
        return {
            "available": False,
            "valid": None,
            "returncode": completed.returncode,
            "reasons": [detail or "command returned no JSON"],
        }
    if not isinstance(loaded, dict):
        return {
            "available": False,
            "valid": None,
            "returncode": completed.returncode,
            "reasons": ["command JSON was not an object"],
        }
    loaded["available"] = True
    loaded["returncode"] = completed.returncode
    return loaded


def build_info(server: dict[str, Any]) -> dict[str, Any]:
    producer = command_json(
        "node",
        "scripts/build-receipt.mjs",
        "check",
        "producer-ui",
        "--json",
    )
    renderer = command_json(
        "node",
        "scripts/build-receipt.mjs",
        "check",
        "renderer-page",
        "--json",
    )
    if server.get("online"):
        producer_served = command_json(
            "node",
            "scripts/build-receipt.mjs",
            "verify-served",
            "producer-ui",
            "--base-url",
            BASE_URL,
            "--json",
        )
    else:
        producer_served = {
            "available": False,
            "valid": None,
            "surface": "producer-ui",
            "reasons": [f"runtime server offline at {BASE_URL}"],
        }
    return {
        "producer_ui": producer,
        "renderer_page": renderer,
        "producer_ui_served": producer_served,
        "renderer_page_served": {
            "available": False,
            "valid": None,
            "surface": "renderer-page",
            "reasons": [
                "renderer page is ephemeral; packages/renderer verifies served bytes at each preview boot"
            ],
        },
    }


def handoff_info() -> dict[str, Any]:
    if not HANDOFF_PATH.is_file():
        return {"exists": False, "path": str(HANDOFF_PATH.relative_to(ROOT))}
    text = HANDOFF_PATH.read_text(encoding="utf-8")
    status = "unknown"
    for line in text.splitlines():
        if line.startswith("Status:"):
            status = line.partition(":")[2].strip()
            break
    return {
        "exists": True,
        "path": str(HANDOFF_PATH.relative_to(ROOT)),
        "status": status,
        "lines": len(text.splitlines()),
        "mtime": dt.datetime.fromtimestamp(
            HANDOFF_PATH.stat().st_mtime, dt.timezone.utc
        ).isoformat(timespec="seconds"),
    }


def collect() -> dict[str, Any]:
    server = masked_server_info()
    return {
        "observed_at": utc_now(),
        "git": git_info(),
        "server": server,
        "database": database_info(),
        "kernel": kernel_info(),
        "ui": ui_info(),
        "builds": build_info(server),
        "handoff": handoff_info(),
    }


def load_areas() -> dict[str, dict[str, Any]]:
    loaded = json.loads(AREAS_PATH.read_text(encoding="utf-8"))
    return {area["id"]: area for area in loaded["areas"]}


def format_group(rows: list[dict[str, Any]], keys: tuple[str, ...]) -> str:
    parts = []
    for row in rows:
        label = "/".join(str(row.get(key)) for key in keys)
        parts.append(f"{label}={row.get('count')}")
    return ", ".join(parts) or "none"


def short_hash(value: Any) -> str:
    return str(value)[:12] if value else "unavailable"


def reason_text(value: dict[str, Any]) -> str:
    return "; ".join(str(item) for item in value.get("reasons") or []) or "none"


def build_line(label: str, value: dict[str, Any]) -> str:
    if value.get("valid") is True:
        return (
            f"{label}: valid input={short_hash(value.get('input_sha256'))} "
            f"output={short_hash(value.get('output_sha256'))} "
            f"receipt={short_hash(value.get('receipt_sha256'))}"
        )
    if value.get("valid") is False:
        return f"{label}: stale/invalid ({reason_text(value)})"
    return f"{label}: unavailable ({reason_text(value)})"


def served_line(label: str, value: dict[str, Any]) -> str:
    if value.get("valid") is True:
        return (
            f"{label}: matching generated output "
            f"{short_hash(value.get('served_output_sha256'))}"
        )
    if value.get("valid") is False:
        return f"{label}: mismatch ({reason_text(value)})"
    return f"{label}: unavailable ({reason_text(value)})"


def catch_up_text(context: dict[str, Any], area_id: str | None) -> str:
    git = context["git"]
    server = context["server"]
    db = context["database"]
    kernel = context["kernel"]
    handoff = context["handoff"]
    builds = context.get("builds") or {}
    lines = [
        "CactusStrudel catch-up",
        f"observed: {context['observed_at']}",
    ]
    if git.get("available"):
        lines.extend(
            [
                (
                    f"git: {git['branch']} @ {git['head'][:12]} "
                    f"dirty={git.get('dirty_entries', 0)} "
                    f"staged={git.get('staged_changes', 0)} "
                    f"unstaged={git.get('unstaged_changes', 0)} "
                    f"untracked={git.get('untracked_files', 0)}"
                ),
                (
                    f"source: effective={short_hash(git.get('effective_tree_sha256'))} "
                    f"working={short_hash(git.get('working_tree_sha256'))} "
                    f"landing={short_hash(git.get('landing_state_sha256'))} "
                    f"files={git.get('effective_files', 0)} "
                    f"bytes={git.get('effective_bytes', 0)}"
                ),
            ]
        )
    else:
        lines.append(f"git/source: unavailable ({git.get('error') or 'unknown error'})")
    lines.extend(
        [
            build_line("producer-ui generated build", builds.get("producer_ui") or {}),
            build_line("renderer-page generated build", builds.get("renderer_page") or {}),
            served_line(
                "producer-ui actually served bytes",
                builds.get("producer_ui_served") or {},
            ),
            served_line(
                "renderer-page actually served bytes",
                builds.get("renderer_page_served") or {},
            ),
        ]
    )
    if server["online"]:
        health = server.get("health") or {}
        lines.append(
            "server: online "
            f"pieces={health.get('pieces')} "
            f"generation-jobs={health.get('generation_jobs')} "
            f"brain-jobs={health.get('brain_jobs')} "
            f"cursor={health.get('cursor')}"
        )
    else:
        lines.append(f"server: offline at {server['base_url']}")
    if db.get("exists"):
        tables = db.get("tables") or {}
        lines.extend(
            [
                f"database: {db['path']}",
                (
                    "truth: "
                    f"pieces={tables.get('pieces', 0)} "
                    f"revisions={tables.get('piece_versions', 0)} "
                    f"ratings={tables.get('ratings', 0)} "
                    f"jobs={tables.get('jobs', 0)}"
                ),
                "provenance: "
                + format_group(db.get("piece_provenance") or [], ("provenance_class",)),
                "jobs: "
                + format_group(db.get("job_statuses") or [], ("kind", "status")),
            ]
        )
    else:
        lines.append(f"database: missing at {db['path']}")
    lines.append(
        f"kernel: {kernel.get('hash') or 'missing'} fragments={kernel.get('fragments', 0)}"
    )
    agent = server.get("agent")
    if agent:
        lines.append(
            "agent: "
            f"active={agent.get('active_model') or 'none'} "
            f"draft={agent.get('draft_model') or 'none'} "
            f"test={'pass' if agent.get('test_ok') else 'none/fail'} "
            f"stale={agent.get('test_stale')} "
            f"Applied-ready={agent.get('ready')}"
        )
    generation = server.get("generation")
    if generation:
        lines.append(
            "generation: "
            f"default={generation.get('default_profile_id') or 'none'} "
            f"profiles={','.join(generation.get('profile_ids') or []) or 'none'}"
        )
    lines.append(
        "handoff: "
        + (
            f"{handoff['status']} at {handoff['path']}"
            if handoff.get("exists")
            else "none"
        )
    )
    if git.get("status_preview"):
        lines.append("dirty preview:")
        lines.extend(f"  {line}" for line in git["status_preview"])
    if area_id:
        areas = load_areas()
        area = areas.get(area_id)
        if not area:
            known = ", ".join(sorted(areas))
            raise SystemExit(f"unknown area {area_id!r}; choose: {known}")
        lines.extend(
            [
                "",
                f"area: {area['id']} — {area['purpose']}",
                "read first:",
                *[f"  {path}" for path in area["read_first"]],
                "entrypoints:",
                *[f"  {path}" for path in area["entrypoints"]],
                "focused tests:",
                *[f"  {path}" for path in area["tests"]],
            ]
        )
    return "\n".join(lines) + "\n"


def build_state_rows(label: str, value: dict[str, Any]) -> list[str]:
    receipt = value.get("receipt") if isinstance(value.get("receipt"), dict) else {}
    task = receipt.get("task") if isinstance(receipt.get("task"), dict) else {}
    builder = receipt.get("builder") if isinstance(receipt.get("builder"), dict) else {}
    environment = builder.get("environment") if isinstance(builder.get("environment"), dict) else {}
    lock = receipt.get("lock") if isinstance(receipt.get("lock"), dict) else {}
    inputs = receipt.get("inputs") if isinstance(receipt.get("inputs"), dict) else {}
    outputs = receipt.get("outputs") if isinstance(receipt.get("outputs"), dict) else {}
    output_files = outputs.get("files") if isinstance(outputs.get("files"), list) else []
    input_files = inputs.get("files") if isinstance(inputs.get("files"), list) else []
    status = "valid" if value.get("valid") is True else (
        "stale/invalid" if value.get("valid") is False else "unavailable"
    )
    return [
        f"- {label} status: `{status}`",
        f"- {label} reasons: `{reason_text(value)}`",
        f"- {label} receipt SHA-256: `{value.get('receipt_sha256') or 'unavailable'}`",
        f"- {label} task input SHA-256: `{value.get('input_sha256') or inputs.get('sha256') or 'unavailable'}`",
        f"- {label} lock SHA-256: `{lock.get('sha256') or 'unavailable'}`",
        f"- {label} task: `{task.get('command') or 'unavailable'}`",
        f"- {label} package build script: `{task.get('package_script') or 'unavailable'}`",
        (
            f"- {label} builder: identity=`{builder.get('sha256') or 'unavailable'}` node=`{builder.get('node') or 'unavailable'}` "
            f"platform=`{builder.get('platform') or 'unavailable'}` "
            f"arch=`{builder.get('arch') or 'unavailable'}` "
            f"package-manager=`{builder.get('package_manager_user_agent') or builder.get('package_manager_declared') or 'unavailable'}`"
        ),
        f"- {label} build environment: keys=`{','.join(environment.get('keys') or []) or 'none'}` hash=`{environment.get('sha256') or 'unavailable'}`",
        f"- {label} inputs: `{len(input_files)}` files; aggregate=`{inputs.get('sha256') or 'unavailable'}`",
        f"- {label} generated outputs: `{len(output_files)}` files; aggregate=`{value.get('output_sha256') or outputs.get('sha256') or 'unavailable'}`",
    ]


def state_markdown(context: dict[str, Any]) -> str:
    git = context["git"]
    server = context["server"]
    db = context["database"]
    kernel = context["kernel"]
    builds = context.get("builds") or {}
    producer_build = builds.get("producer_ui") or {}
    renderer_build = builds.get("renderer_page") or {}
    producer_served = builds.get("producer_ui_served") or {}
    renderer_served = builds.get("renderer_page_served") or {}
    tables = db.get("tables") or {}
    health = server.get("health") or {}
    agent = server.get("agent") or {}
    generation = server.get("generation") or {}
    latest = db.get("latest_piece") or {}
    build_rows = "\n".join(
        build_state_rows("producer-ui", producer_build)
        + build_state_rows("renderer-page", renderer_build)
    )
    return f"""# Current generated state

> GENERATED by `bin/state-refresh` — do not edit by hand.
>
> observed_at: `{context['observed_at']}`
> observed_head: `{git.get('head') or 'unknown'}`
> branch: `{git.get('branch') or 'unknown'}`
> landing_state_sha256: `{git.get('landing_state_sha256') or 'unavailable'}`
> landing staged/unstaged/untracked: `{git.get('staged_changes', 0)}/{git.get('unstaged_changes', 0)}/{git.get('untracked_files', 0)}`
> database_path: `{db['path']}`
> database_mtime: `{db.get('mtime') or 'missing'}`

`observed_head`, branch and landing counts are readback metadata, not the
freshness authority. The source fingerprint excludes this generated file and
handoff snapshots, so refreshing or committing STATE cannot invalidate itself.
Live readback wins if runtime state has changed since `observed_at`.

## Source bytes

- source identity available: `{git.get('available', False)}`
- effective source SHA-256: `{git.get('effective_tree_sha256') or 'unavailable'}`
- stage-aware working-tree SHA-256: `{git.get('working_tree_sha256') or 'unavailable'}`
- tracked working bytes SHA-256: `{git.get('tracked_worktree_sha256') or 'unavailable'}`
- Git-exposed index-entry SHA-256: `{git.get('index_tree_sha256') or 'unavailable'}`
- Git-exposed index-flags SHA-256: `{git.get('index_flags_sha256') or 'unavailable'}`
- staged-state SHA-256: `{git.get('staged_state_sha256') or 'unavailable'}`
- unstaged-state SHA-256: `{git.get('unstaged_state_sha256') or 'unavailable'}`
- untracked paths/content SHA-256: `{git.get('untracked_tree_sha256') or 'unavailable'}`
- effective files/bytes: `{git.get('effective_files', 0)}` / `{git.get('effective_bytes', 0)}`
- untracked files/bytes: `{git.get('untracked_files', 0)}` / `{git.get('untracked_bytes', 0)}`

For a portable dirty-cutover attestation, run
`bin/source-attest --include-paths --pretty --output <source-excluded-or-external-path>`.
The full manifest records every effective and untracked path/content hash plus
every index object/stage/raw flag exposed by Git. Index stat-cache fields and
serialization extensions are outside this claim. No new commit is required.

## Generated build bytes

{build_rows}

A valid build receipt proves the exact task inputs, lock bytes, builder identity
and generated output bytes. It does not prove that a server is serving them.

## Actually served bytes

- Producer UI served status: `{'matching' if producer_served.get('valid') is True else ('mismatch' if producer_served.get('valid') is False else 'unavailable')}`
- Producer UI served reasons: `{reason_text(producer_served)}`
- Producer UI served output SHA-256: `{producer_served.get('served_output_sha256') or 'unavailable'}`
- Renderer page served status: `{'matching' if renderer_served.get('valid') is True else ('mismatch' if renderer_served.get('valid') is False else 'unavailable')}`
- Renderer page served reasons: `{reason_text(renderer_served)}`

Producer served proof fetches the served receipt, every generated file and the
`/studio` SPA entry. Renderer-page has no persistent server to poll; the
renderer boot path must verify preview bytes against the receipt before use and
fall back to current source when that proof fails.

## Served product and runtime readback

- server: `{'online' if server['online'] else 'offline'}`
- API: `{health.get('api_version') or 'unavailable'}`
- served pieces: `{health.get('pieces') if server['online'] else 'unavailable'}`
- generation batches in bootstrap: `{health.get('generation_jobs') if server['online'] else 'unavailable'}`
- Brain jobs in bootstrap: `{health.get('brain_jobs') if server['online'] else 'unavailable'}`
- UI cursor: `{health.get('cursor') if server['online'] else db.get('api_cursor', 'unavailable')}`
- Agent ready/Applied: `{agent.get('ready', False)}`

## Canonical truth

- pieces: `{tables.get('pieces', 0)}`
- immutable revisions: `{tables.get('piece_versions', 0)}`
- ratings: `{tables.get('ratings', 0)}`
- truth jobs: `{tables.get('jobs', 0)}`
- model runs: `{tables.get('model_runs', 0)}`
- latest piece: `{latest.get('display_name') or 'none'}` (`{latest.get('id') or 'none'}`)
- provenance: `{format_group(db.get('piece_provenance') or [], ('provenance_class',))}`
- version states: `{format_group(db.get('version_states') or [], ('kind', 'state'))}`
- job states: `{format_group(db.get('job_statuses') or [], ('kind', 'status'))}`

## Prompt, generation and Agent

- kernel hash: `{kernel.get('hash') or 'missing'}`
- kernel fragments: `{kernel.get('fragments', 0)}`
- validator mode: `{generation.get('validator_mode') or 'unavailable'}`
- generation revision: `{generation.get('revision_id') or 'none'}`
- Studio default profile: `{generation.get('default_profile_id') or 'none'}`
- configured profiles: `{', '.join(generation.get('profile_ids') or []) or 'none'}`
- Agent active model: `{agent.get('active_model') or 'none'}`
- Agent draft model: `{agent.get('draft_model') or 'none'}`
- Agent Test: `{'pass' if agent.get('test_ok') else 'none/fail'}`; stale=`{agent.get('test_stale')}`
- authenticated catalog entries: `{agent.get('catalog_count', 0)}`

## Boundaries

- Source identity, generated build identity and actually served identity are separate claims.
- Generated/mechanical success is not musical acceptance.
- A passing Agent Test is not Apply.
- Legacy evidence and archive content are not alternate live truth.
"""


_VOLATILE_STATE_PREFIXES = (
    "> observed_at:",
    "> observed_head:",
    "> branch:",
    "> landing_state_sha256:",
    "> landing staged/unstaged/untracked:",
)


def normalized_state(text: str) -> str:
    normalized = []
    for line in text.splitlines():
        prefix = next(
            (candidate for candidate in _VOLATILE_STATE_PREFIXES if line.startswith(candidate)),
            None,
        )
        normalized.append(f"{prefix} `<ignored>`" if prefix else line)
    return "\n".join(normalized).strip()

def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def state_command(args: argparse.Namespace) -> int:
    current = state_markdown(collect())
    if args.stdout:
        print(current, end="")
        return 0
    if args.check:
        if not STATE_PATH.is_file():
            print("STATE missing; run bin/state-refresh", file=sys.stderr)
            return 1
        stored = STATE_PATH.read_text(encoding="utf-8")
        if normalized_state(stored) != normalized_state(current):
            print("STATE stale; run bin/state-refresh", file=sys.stderr)
            return 1
        print("STATE current")
        return 0
    atomic_write(STATE_PATH, current)
    print(f"wrote {STATE_PATH.relative_to(ROOT)}")
    return 0


HANDOFF_HEADINGS = (
    "## Objective",
    "## Files in scope",
    "## Changed",
    "## Evidence",
    "## Pending",
    "## Bowei-owned decisions",
    "## Resume from",
)


def handoff_section(text: str, heading: str) -> str:
    marker = f"{heading}\n"
    if marker not in text:
        return ""
    tail = text.split(marker, 1)[1]
    return tail.split("\n## ", 1)[0].strip()


def handoff_start(objective: str) -> int:
    context = collect()
    git = context["git"]
    server = context["server"]
    db = context["database"]
    builds = context.get("builds") or {}
    tables = db.get("tables") or {}
    text = f"""# Current handoff

Status: active
Observed: {context['observed_at']}
Branch: {git['branch']}
HEAD: {git['head']}
Effective source: {git.get('effective_tree_sha256') or 'unavailable'}
Working tree: {git.get('working_tree_sha256') or 'unavailable'}
Landing state: {git.get('landing_state_sha256') or 'unavailable'}

## Objective

{objective.strip()}

## Files in scope

- Add exact paths as work begins.

## Changed

- Nothing recorded yet.

## Evidence

- server: {'online' if server['online'] else 'offline'}
- producer-ui generated output: {(builds.get('producer_ui') or {}).get('output_sha256') or 'unavailable'}
- producer-ui served output: {(builds.get('producer_ui_served') or {}).get('served_output_sha256') or 'unavailable'}
- renderer-page generated output: {(builds.get('renderer_page') or {}).get('output_sha256') or 'unavailable'}
- pieces/revisions/jobs: {tables.get('pieces', 0)}/{tables.get('piece_versions', 0)}/{tables.get('jobs', 0)}

## Pending

- Record the next unresolved action.

## Bowei-owned decisions

- None recorded.

## Resume from

Run `bin/catch-up`, inspect this handoff, then continue from the first Pending item.
"""
    atomic_write(HANDOFF_PATH, text)
    print(f"started {HANDOFF_PATH.relative_to(ROOT)}")
    return 0


def handoff_show() -> int:
    if not HANDOFF_PATH.is_file():
        print("no active handoff")
        return 0
    print(HANDOFF_PATH.read_text(encoding="utf-8"), end="")
    return 0


def handoff_check() -> int:
    if not HANDOFF_PATH.is_file():
        print("handoff missing", file=sys.stderr)
        return 1
    text = HANDOFF_PATH.read_text(encoding="utf-8")
    errors = [f"missing {heading}" for heading in HANDOFF_HEADINGS if heading not in text]
    line_count = len(text.splitlines())
    if line_count > 100:
        errors.append(f"handoff has {line_count} lines; maximum is 100")
    if "Status: active" not in text and "Status: closed" not in text:
        errors.append("missing valid Status")
    if "- Add exact paths as work begins." in text:
        errors.append("Files in scope still has its placeholder")
    if "- Record the next unresolved action." in text:
        errors.append("Pending still has its placeholder")
    if (
        "Run `bin/catch-up`, inspect this handoff, then continue from the first "
        "Pending item." in text
    ):
        errors.append("Resume from still has its generic placeholder")
    scope = handoff_section(text, "## Files in scope")
    for candidate in re.findall(r"`([^`]+)`", scope):
        if candidate.startswith(("http://", "https://")):
            continue
        if not (ROOT / candidate).exists():
            errors.append(f"Files in scope path does not exist: {candidate}")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"handoff ✓ {line_count} lines")
    return 0


def handoff_close(outcome: str) -> int:
    if not HANDOFF_PATH.is_file():
        print("handoff missing", file=sys.stderr)
        return 1
    text = HANDOFF_PATH.read_text(encoding="utf-8")
    text = text.replace("Status: active", "Status: closed", 1)
    text += f"\n## Outcome\n\n{outcome.strip()}\n\nClosed: {utc_now()}\n"
    atomic_write(HANDOFF_PATH, text)
    print(f"closed {HANDOFF_PATH.relative_to(ROOT)}")
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    sub = root.add_subparsers(dest="command", required=True)

    catch = sub.add_parser("catch-up")
    catch.add_argument("area", nargs="?")
    catch.add_argument("--json", action="store_true")

    state = sub.add_parser("state")
    state.add_argument("--stdout", action="store_true")
    state.add_argument("--check", action="store_true")

    handoff = sub.add_parser("handoff")
    handoff_sub = handoff.add_subparsers(dest="handoff_command", required=True)
    start = handoff_sub.add_parser("start")
    start.add_argument("objective")
    handoff_sub.add_parser("show")
    handoff_sub.add_parser("check")
    close = handoff_sub.add_parser("close")
    close.add_argument("outcome")
    return root


def main() -> int:
    args = parser().parse_args()
    if args.command == "catch-up":
        context = collect()
        if args.json:
            if args.area:
                area = load_areas().get(args.area)
                if not area:
                    raise SystemExit(f"unknown area {args.area!r}")
                context["area"] = area
            print(json.dumps(context, indent=2, ensure_ascii=False))
        else:
            print(catch_up_text(context, args.area), end="")
        return 0
    if args.command == "state":
        return state_command(args)
    if args.handoff_command == "start":
        return handoff_start(args.objective)
    if args.handoff_command == "show":
        return handoff_show()
    if args.handoff_command == "check":
        return handoff_check()
    if args.handoff_command == "close":
        return handoff_close(args.outcome)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
