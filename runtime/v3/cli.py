"""Operator CLI for initializing and inspecting the v3 truth layer."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from .db import Database
from .legacy import LegacyReconcilePlanner
from .legacy_importer import LegacyImporter
from .service import RuntimeTruth


def _repo_root(value: str | None) -> Path:
    if value:
        return Path(value).expanduser().resolve()
    return Path(__file__).resolve().parents[2]


def _default_db_path() -> Path:
    state_root = Path(
        os.environ.get("CACTUS_V3_STATE_ROOT")
        or Path.home() / ".cactus-strudel" / "v3"
    )
    return state_root.expanduser().resolve() / "runtime.sqlite3"


def _print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def _atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(
                json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)
            )
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def command_init(args: argparse.Namespace) -> int:
    db_path = (
        Path(args.db).expanduser().resolve()
        if args.db
        else _default_db_path()
    )
    database = Database(db_path)
    version = database.initialize()
    _print_json(
        {
            "ok": True,
            "db": str(db_path),
            "schema_version": version,
            "mode": "operational",
        }
    )
    return 0


def command_status(args: argparse.Namespace) -> int:
    root = _repo_root(args.repo_root)
    runtime = RuntimeTruth(
        repo_root=root,
        db_path=args.db or _default_db_path(),
        assets_root=args.assets_root,
    )
    with runtime.database.transaction(immediate=False) as conn:
        tables = {}
        for table in (
            "pieces",
            "piece_versions",
            "ratings",
            "model_runs",
            "jobs",
            "job_events",
        ):
            tables[table] = int(
                conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
            )
        statuses = {
            row["status"]: int(row["n"])
            for row in conn.execute(
                "SELECT status, COUNT(*) AS n FROM jobs GROUP BY status ORDER BY status"
            )
        }
    _print_json(
        {
            "ok": True,
            "db": str(runtime.database.path),
            "schema_version": runtime.database.schema_version(),
            "tables": tables,
            "job_statuses": statuses,
            "receipt_reconciliation": runtime.reconcile_receipts(),
        }
    )
    return 0


def command_reconcile(args: argparse.Namespace) -> int:
    root = _repo_root(args.repo_root)
    if args.plan:
        plan_path = Path(args.plan).expanduser().resolve()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
    else:
        plan = LegacyReconcilePlanner(
            repo_root=root,
            corpus_path=args.corpus,
            revisions_path=args.revisions,
            tasks_path=args.tasks,
        ).build_plan()
    if args.output:
        output = Path(args.output).expanduser().resolve()
        _atomic_write_json(output, plan)
    if args.apply:
        result = LegacyImporter(
            repo_root=root,
            db_path=args.reconcile_db or args.db,
            assets_root=args.assets_root,
        ).apply(plan)
        _print_json(
            {
                "ok": True,
                "mode": "apply",
                "plan_output": str(output) if args.output else None,
                "plan_summary": plan["summary"],
                "apply_result": result,
            }
        )
    elif args.output:
        _print_json(
            {
                "ok": True,
                "mode": "dry-run",
                "output": str(output),
                "summary": plan["summary"],
                "source_snapshots": plan["source_snapshots"],
            }
        )
    else:
        _print_json(plan)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="v3-truth",
        description="CactusStrudel v3 operational truth utilities",
    )
    parser.add_argument(
        "--repo-root", help="repository root (auto-detected by default)"
    )
    parser.add_argument(
        "--db",
        help="SQLite path (default $CACTUS_V3_STATE_ROOT/runtime.sqlite3 or ~/.cactus-strudel/v3/runtime.sqlite3)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init", help="apply SQLite migrations")
    init_parser.set_defaults(func=command_init)

    status_parser = subparsers.add_parser("status", help="read operational counts")
    status_parser.add_argument("--assets-root")
    status_parser.set_defaults(func=command_status)

    reconcile_parser = subparsers.add_parser(
        "reconcile", help="build a read-only legacy migration plan"
    )
    reconcile_parser.add_argument("--corpus")
    reconcile_parser.add_argument("--revisions")
    reconcile_parser.add_argument("--tasks")
    reconcile_parser.add_argument("--output")
    reconcile_parser.add_argument("--plan", help="consume an existing frozen plan")
    reconcile_parser.add_argument(
        "--apply",
        action="store_true",
        help="copy all importable corpus entries into the specified v3 store",
    )
    reconcile_parser.add_argument(
        "--db",
        dest="reconcile_db",
        help="target SQLite path (required with --apply for bin/v3-reconcile)",
    )
    reconcile_parser.add_argument(
        "--assets-root",
        help="target immutable asset root (required with --apply)",
    )
    reconcile_parser.set_defaults(func=command_reconcile)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "reconcile" and args.apply:
        if not (args.reconcile_db or args.db):
            parser.error("reconcile --apply requires --db")
        if not args.assets_root:
            parser.error("reconcile --apply requires --assets-root")
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
