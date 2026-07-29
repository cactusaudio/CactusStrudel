"""`strudel` — one CLI covering every product read and mutation (C1).

A strict `/api/v2` client plus the operational verbs (doctor/backup/
restore). No product logic lives here: the same invariants, idempotency
and receipts flow through V3Application exactly as they do for the GUI,
and the MCP server wraps this same module. `--json` emits machine output
for scripts; scoring via this CLI is Bowei's own hand — agents score only
through the MCP tool with its explicit acting_for_bowei relay contract.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any
from uuid import uuid4

DEFAULT_BASE_URL = os.environ.get("CACTUS_BASE_URL") or "http://127.0.0.1:8765"
# The operator subprocess (backup/restore) always runs from THIS checkout;
# an environment variable must not redirect module resolution.
REPO_ROOT = str(__import__("pathlib").Path(__file__).resolve().parent.parent)


class CliError(RuntimeError):
    pass


class ApiClient:
    """Thin transport; injectable for tests."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL, timeout: float = 300.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        request = urllib.request.Request(
            url, data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(
                request, timeout=timeout or self.timeout
            ) as response:
                raw = response.read()
            try:
                return json.loads(raw)
            except json.JSONDecodeError as exc:
                raise CliError(
                    f"runtime returned non-JSON for {path}: {exc}"
                ) from exc
        except urllib.error.HTTPError as exc:
            try:
                payload = json.loads(exc.read())
            except Exception:  # noqa: BLE001
                payload = {}
            raise CliError(
                f"HTTP {exc.code}: {payload.get('error') or exc.reason}"
                + (f" — {payload['detail']}" if payload.get("detail") else "")
            ) from exc
        except urllib.error.URLError as exc:
            raise CliError(
                f"runtime unreachable at {self.base_url} ({exc.reason}); "
                "is the server running? (launchctl print gui/$UID/com.cactus.strudel)"
            ) from exc


def _emit(args: argparse.Namespace, value: Any, human: str | None = None) -> None:
    if args.json or human is None:
        print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(human)


def _piece_line(piece: dict[str, Any]) -> str:
    revision = piece.get("active_revision") or {}
    score = revision.get("score")
    usable = revision.get("usable", True)
    return (
        f"{piece.get('name', '?'):<28} "
        f"{(revision.get('provenance') or {}).get('model_id') or '?':<18} "
        f"{revision.get('duration_seconds') or 0:>6.1f}s "
        f"score {score if score is not None else '—':<4} "
        f"{'' if usable else '⚠ unusable'} {piece.get('id', '')}"
    )


def cmd_status(client: ApiClient, args: argparse.Namespace) -> int:
    health = client.request("GET", "/api/v2/health")
    _emit(
        args,
        health,
        f"ok={health.get('ok')} pieces={health.get('pieces')} "
        f"generation_jobs={health.get('generation_jobs')} "
        f"brain_jobs={health.get('brain_jobs')} "
        f"agent_ready={health.get('agent_ready')} cursor={health.get('cursor')}",
    )
    return 0


def cmd_doctor(client: ApiClient, args: argparse.Namespace) -> int:
    report = client.request("GET", "/api/v2/doctor", timeout=600)
    if args.json:
        _emit(args, report)
    else:
        for check in report.get("checks", []):
            mark = "✓" if check.get("ok") else "✗"
            line = f"{mark} {check.get('id'):<22} {check.get('detail')}"
            if not check.get("ok") and check.get("fix"):
                line += f"\n    fix: {check['fix']}"
            print(line)
        print(f"doctor: {'all green' if report.get('ok') else 'ATTENTION NEEDED'}")
    return 0 if report.get("ok") else 1


def cmd_pieces(client: ApiClient, args: argparse.Namespace) -> int:
    payload = client.request(
        "GET",
        "/api/v2/pieces"
        + ("?archived=all" if getattr(args, "all", False) else ""),
    )
    pieces = payload.get("pieces", [])
    if args.json:
        _emit(args, payload)
    else:
        for piece in pieces[: args.limit]:
            print(_piece_line(piece))
        print(f"{len(pieces)} piece(s)")
    return 0


def cmd_piece(client: ApiClient, args: argparse.Namespace) -> int:
    piece = client.request(
        "GET", f"/api/v2/pieces/{urllib.parse.quote(args.piece_id, safe="")}"
    )["piece"]
    if args.json:
        _emit(args, piece)
        return 0
    print(_piece_line(piece))
    for revision in piece.get("revisions", []):
        marker = "▶" if revision.get("promoted") else " "
        print(
            f"  {marker} {revision.get('id')} {revision.get('label'):<14} "
            f"audio {str(revision.get('audio_sha'))[:12]} "
            f"score {revision.get('score') if revision.get('score') is not None else '—'}"
            + ("" if revision.get("usable", True) else "  ⚠ unusable")
        )
    return 0


def cmd_play(client: ApiClient, args: argparse.Namespace) -> int:
    piece = client.request(
        "GET", f"/api/v2/pieces/{urllib.parse.quote(args.piece_id, safe="")}"
    )["piece"]
    revision = piece.get("active_revision") or {}
    if args.revision:
        match = next(
            (
                row
                for row in piece.get("revisions", [])
                if row.get("id") == args.revision
            ),
            None,
        )
        if match is None:
            raise CliError(f"revision not found on piece: {args.revision}")
        revision = match
    url = f"{client.base_url}{revision.get('audio_url')}"
    _emit(args, {"audio_url": url, "revision_id": revision.get("id")}, url)
    if args.open:
        subprocess.run(["open", url], check=False)
    return 0


def cmd_gen(client: ApiClient, args: argparse.Namespace) -> int:
    job = client.request(
        "POST",
        "/api/v2/generation-jobs",
        body={
            "count": args.count,
            "prompt": args.prompt or "",
            "profile_id": args.profile,
        },
        idempotency_key=args.idempotency_key or f"cactus-cli-{uuid4().hex}",
    )["job"]
    _emit(
        args,
        job,
        f"generation {job.get('id')} state={job.get('state')} "
        f"profile={job.get('profile_id')} count={job.get('count')}",
    )
    return 0


def cmd_score(client: ApiClient, args: argparse.Namespace) -> int:
    piece = client.request(
        "GET", f"/api/v2/pieces/{urllib.parse.quote(args.piece_id, safe="")}"
    )["piece"]
    revision = next(
        (
            row
            for row in piece.get("revisions", [])
            if row.get("id") == (args.revision or piece.get("active_revision_id"))
        ),
        None,
    )
    if revision is None:
        raise CliError("revision not found on piece")
    result = client.request(
        "PUT",
        f"/api/v2/pieces/{urllib.parse.quote(piece['id'], safe="")}/revisions/"
        f"{urllib.parse.quote(revision['id'], safe="")}/score",
        body={
            "score": args.score,
            "note": args.note or "",
            "audio_sha": revision["audio_sha"],
        },
        idempotency_key=args.idempotency_key or f"cactus-cli-{uuid4().hex}",
    )
    scored = result["piece"]["active_revision"]
    _emit(
        args,
        result,
        f"scored {revision['id']} → {args.score} "
        f"(active score now {scored.get('score')})",
    )
    return 0


def cmd_promote(client: ApiClient, args: argparse.Namespace) -> int:
    result = client.request(
        "POST",
        f"/api/v2/pieces/{urllib.parse.quote(args.piece_id, safe="")}/revisions",
        body={"action": "promote", "revision_id": args.revision},
    )
    _emit(
        args,
        result,
        (result.get("receipt") or {}).get("summary")
        or f"promoted {args.revision}",
    )
    return 0


def cmd_preview(client: ApiClient, args: argparse.Namespace) -> int:
    try:
        code = (
            sys.stdin.read()
            if args.code_file == "-"
            else open(args.code_file, encoding="utf-8").read()
        )
    except OSError as exc:
        raise CliError(f"cannot read code file: {exc}") from exc
    except UnicodeDecodeError as exc:
        raise CliError(f"code file is not UTF-8 text: {exc}") from exc
    result = client.request(
        "POST",
        f"/api/v2/pieces/{urllib.parse.quote(args.piece_id, safe="")}/previews",
        body={
            "code": code,
            "source_revision_id": args.source_revision,
            "intent": args.intent or "cactus cli preview",
        },
        idempotency_key=args.idempotency_key or f"cactus-cli-{uuid4().hex}",
        timeout=12000,
    )
    revision = result["revision"]
    _emit(
        args,
        result,
        f"preview {revision.get('id')} audio {str(revision.get('audio_sha'))[:12]}",
    )
    return 0


def cmd_brain(client: ApiClient, args: argparse.Namespace) -> int:
    body: dict[str, Any] = {"message": args.message}
    if args.pin:
        body["piece_id"] = args.pin
    job = client.request(
        "POST",
        "/api/v2/brain/jobs",
        body=body,
        idempotency_key=args.idempotency_key or f"cactus-cli-{uuid4().hex}",
    )["job"]
    if not args.wait:
        _emit(args, job, f"brain {job.get('id')} state={job.get('state')}")
        return 0
    import time as _time

    deadline = _time.monotonic() + args.wait_timeout
    while _time.monotonic() < deadline:
        job = client.request(
            "GET", f"/api/v2/brain/jobs/{urllib.parse.quote(job['id'], safe="")}"
        )["job"]
        if job.get("state") not in {
            "queued",
            "running",
            "waiting_for_tool",
            "cancelling",
        }:
            break
        _time.sleep(2)
    if args.json:
        _emit(args, job)
    else:
        answer = next(
            (
                message["text"]
                for message in reversed(job.get("messages", []))
                if message.get("role") == "assistant"
            ),
            job.get("error") or f"(state={job.get('state')}, no answer)",
        )
        print(answer)
    return 0 if job.get("state") == "done" else 1


def cmd_ops(client: ApiClient, args: argparse.Namespace) -> int:
    result = client.request(
        "GET", f"/api/v2/operations/{urllib.parse.quote(args.idempotency_key, safe="")}"
    )
    _emit(
        args,
        result,
        f"found={result.get('found')} kind={result.get('kind')}",
    )
    return 0


def cmd_settings(client: ApiClient, args: argparse.Namespace) -> int:
    agent = client.request("GET", "/api/v2/settings/agent")
    if args.json:
        _emit(args, agent)
    else:
        active = agent.get("active") or {}
        print(
            f"agent: {active.get('model_id') or 'none'} "
            f"({(agent.get('status') or {}).get('detail')})"
        )
        applied = agent.get("applied_receipt") or {}
        if applied:
            print(
                f"applied: {applied.get('revision_id')} at {applied.get('applied_at')}"
            )
    return 0


def _operator_cli(args_list: list[str]) -> int:
    completed = subprocess.run(
        [sys.executable, "-m", "runtime.v3.cli", *args_list],
        cwd=REPO_ROOT,
    )
    return completed.returncode


def cmd_backup(_client: ApiClient, args: argparse.Namespace) -> int:
    extra = ["backup"]
    if args.no_assets:
        extra.append("--no-assets")
    if args.output:
        extra.extend(["--output", args.output])
    return _operator_cli(extra)


def cmd_restore(_client: ApiClient, args: argparse.Namespace) -> int:
    extra = ["restore", args.archive]
    if args.force:
        extra.append("--force")
    return _operator_cli(extra)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="strudel",
        description="CactusStrudel: AI-native music production runtime",
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--json", action="store_true", help="machine output")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="compact runtime readback").set_defaults(
        func=cmd_status
    )
    sub.add_parser("doctor", help="full diagnostic pass").set_defaults(
        func=cmd_doctor
    )

    pieces = sub.add_parser("pieces", help="list the library")
    pieces.add_argument("--all", action="store_true", help="include archived")
    pieces.add_argument("--limit", type=int, default=30)
    pieces.set_defaults(func=cmd_pieces)

    piece = sub.add_parser("piece", help="one piece with revisions")
    piece.add_argument("piece_id")
    piece.set_defaults(func=cmd_piece)

    play = sub.add_parser("play", help="audio URL for the exact bytes")
    play.add_argument("piece_id")
    play.add_argument("--revision")
    play.add_argument("--open", action="store_true", help="open in browser")
    play.set_defaults(func=cmd_play)

    gen = sub.add_parser("gen", help="best-of-N first shots")
    gen.add_argument("count", type=int, choices=(1, 2, 4))
    gen.add_argument("prompt", nargs="?", default="")
    gen.add_argument("--profile")
    gen.add_argument("--idempotency-key")
    gen.set_defaults(func=cmd_gen)

    score = sub.add_parser("score", help="bind an ear score to exact bytes")
    score.add_argument("piece_id")
    score.add_argument("score", type=float)
    score.add_argument("note", nargs="?", default="")
    score.add_argument("--revision")
    score.add_argument("--idempotency-key")
    score.set_defaults(func=cmd_score)

    promote = sub.add_parser("promote", help="make a revision current")
    promote.add_argument("piece_id")
    promote.add_argument("revision")
    promote.set_defaults(func=cmd_promote)

    preview = sub.add_parser("preview", help="render code as immutable B")
    preview.add_argument("piece_id")
    preview.add_argument("source_revision")
    preview.add_argument("code_file", help="path or - for stdin")
    preview.add_argument("--intent")
    preview.add_argument("--idempotency-key")
    preview.set_defaults(func=cmd_preview)

    brain = sub.add_parser("brain", help="one durable Brain message")
    brain.add_argument("message")
    brain.add_argument("--pin", help="piece id to pin as context")
    brain.add_argument("--wait", action="store_true")
    brain.add_argument("--wait-timeout", type=float, default=3000)
    brain.add_argument("--idempotency-key")
    brain.set_defaults(func=cmd_brain)

    ops = sub.add_parser("ops", help="exact prior outcome for a key")
    ops.add_argument("idempotency_key")
    ops.set_defaults(func=cmd_ops)

    settings = sub.add_parser("settings", help="agent settings readback")
    settings.set_defaults(func=cmd_settings)

    backup = sub.add_parser("backup", help="snapshot all durable truth")
    backup.add_argument("--no-assets", action="store_true")
    backup.add_argument("--output")
    backup.set_defaults(func=cmd_backup)

    restore = sub.add_parser("restore", help="verify + adopt a backup")
    restore.add_argument("archive")
    restore.add_argument("--force", action="store_true")
    restore.set_defaults(func=cmd_restore)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    client = ApiClient(args.base_url)
    try:
        return int(args.func(client, args))
    except CliError as exc:
        print(f"strudel: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
