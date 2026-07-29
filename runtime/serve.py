#!/usr/bin/env python3
"""CactusStrudel v3 local runtime: one Producer SPA and one durable API."""

from __future__ import annotations

from email.utils import formatdate
import html
import http.server
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import signal
import socketserver
import sys
import threading
import time
import urllib.parse
from uuid import uuid4
import webbrowser

from agent.errors import AgentV3Error, DraftConflict
from v3.owner import OwnerLease, OwnershipLost, StateRootBusy
from v3.store import (
    IdempotencyConflict,
    InvalidTransition,
    NotFound,
    ReceiptConflict,
    TruthError,
)
from v3_api import Conflict, V3Application, V3Error


ROOT = Path(
    os.environ.get("CACTUS_ROOT")
    or Path(__file__).resolve().parent.parent
).expanduser().resolve()
PORT = int(os.environ.get("CACTUS_PORT") or 8765)
STATE_ROOT = Path(
    os.environ.get("CACTUS_V3_STATE_ROOT")
    or Path.home() / ".cactus-strudel" / "v3"
).expanduser().resolve()
SHUTDOWN_TIMEOUT = float(os.environ.get("CACTUS_SHUTDOWN_TIMEOUT") or 10.0)
APP_INDEX = ROOT / "runtime" / "app" / "index.html"
LEGACY_ARCHIVE_ROOT = (
    ROOT
    / "archive"
    / "gui"
    / "ui-v2-baseline-20260728-95f85f6"
)
LEGACY_ROOT = LEGACY_ARCHIVE_ROOT / "source" / "runtime"
LEGACY_SCREENSHOT_ROOT = LEGACY_ARCHIVE_ROOT / "screenshots"
SPA_ROUTES = frozenset(
    {
        "/studio",
        "/library",
        "/research",
        "/activity",
        "/settings/agent",
        "/settings/generation",
        "/settings/system",
    }
)
LEGACY_BOOKMARK_REDIRECTS = {
    "/runtime/main.html": "/studio",
    "/runtime/data.html": "/library",
    "/runtime/settings.html": "/settings/agent",
    "/runtime/spine.html": "/research",
}


class _RangedFile:
    def __init__(self, handle, remaining: int):
        self.handle = handle
        self.remaining = remaining

    def read(self, size: int = -1) -> bytes:
        if self.remaining <= 0:
            return b""
        amount = self.remaining if size < 0 else min(size, self.remaining)
        chunk = self.handle.read(amount)
        self.remaining -= len(chunk)
        return chunk

    def close(self) -> None:
        self.handle.close()


class RuntimeServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, app: V3Application | None):
        # The application may be attached after construction: binding the
        # port before running recovery keeps a port conflict from mutating
        # state, while the accept loop starts only after recovery finishes.
        self.app = app
        super().__init__(address, handler)

    def handle_error(self, request, client_address) -> None:
        # EventSource and browser refresh routinely reset a socket after the
        # useful response has ended; that is transport churn, not a product
        # operation failure worth a traceback.
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class Handler(http.server.SimpleHTTPRequestHandler):
    server: RuntimeServer
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        status = str(args[1]) if len(args) > 1 else ""
        if status and status not in {"200", "206", "304"}:
            super().log_message(fmt, *args)

    @property
    def app(self) -> V3Application:
        return self.server.app

    # ------------------------------------------------------------------
    # HTTP verbs

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = self._canonical_path(parsed.path)
        if path == "/":
            return self._redirect("/studio")
        if path in LEGACY_BOOKMARK_REDIRECTS:
            return self._redirect(LEGACY_BOOKMARK_REDIRECTS[path])
        if path in SPA_ROUTES:
            return self._serve_spa()
        if path.startswith("/legacy/"):
            return self._serve_legacy(path)
        if path.startswith("/api/v2/"):
            return self._api_get(path, parsed)
        return super().do_GET()

    def do_HEAD(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = self._canonical_path(parsed.path)
        if path == "/":
            return self._redirect("/studio")
        if path in LEGACY_BOOKMARK_REDIRECTS:
            return self._redirect(LEGACY_BOOKMARK_REDIRECTS[path])
        if path in SPA_ROUTES:
            return self._serve_spa()
        if path.startswith("/legacy/"):
            return self._serve_legacy(path)
        return super().do_HEAD()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = self._canonical_path(parsed.path)
        if not path.startswith("/api/v2/"):
            return self._method_not_allowed()
        self._api_post(path)

    def do_PUT(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = self._canonical_path(parsed.path)
        if not path.startswith("/api/v2/"):
            return self._method_not_allowed()
        self._api_put(path)

    def do_PATCH(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = self._canonical_path(parsed.path)
        if not path.startswith("/api/v2/"):
            return self._method_not_allowed()
        self._api_patch(path)

    def do_DELETE(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = self._canonical_path(parsed.path)
        if not path.startswith("/api/v2/"):
            return self._method_not_allowed()
        self._api_delete(path)

    # ------------------------------------------------------------------
    # v3 reads

    def _api_get(self, path: str, parsed: urllib.parse.ParseResult) -> None:
        try:
            if path == "/api/v2/bootstrap":
                return self._json(200, self.app.bootstrap())
            if path == "/api/v2/health":
                return self._json(200, self.app.health())
            if path == "/api/v2/doctor":
                return self._json(200, self.app.doctor())
            if path == "/api/v2/pieces":
                query = urllib.parse.parse_qs(parsed.query)
                include_archived = (query.get("archived") or ["active"])[0] == "all"
                return self._json(
                    200,
                    {"pieces": self.app.list_pieces(include_archived=include_archived)},
                )
            if path == "/api/v2/settings/agent":
                return self._json(200, self.app.agent_settings_public())
            if path == "/api/v2/events":
                query = urllib.parse.parse_qs(parsed.query)
                after = int((query.get("after") or ["0"])[0])
                return self._events(after)
            match = re.fullmatch(r"/api/v2/operations/([^/]+)", path)
            if match:
                return self._json(
                    200,
                    self.app.operation_readback(
                        urllib.parse.unquote(match.group(1))
                    ),
                )
            match = re.fullmatch(r"/api/v2/brain/jobs/([^/]+)", path)
            if match:
                return self._json(
                    200,
                    {"job": self.app.get_brain_job(urllib.parse.unquote(match.group(1)))},
                )
            match = re.fullmatch(r"/api/v2/pieces/([^/]+)", path)
            if match:
                return self._json(
                    200,
                    {"piece": self.app.get_piece(urllib.parse.unquote(match.group(1)))},
                )
            self._json(404, {"error": "not found"})
        except Exception as exc:
            self._api_error(exc)

    # ------------------------------------------------------------------
    # v3 mutations

    def _api_post(self, path: str) -> None:
        try:
            body = self._json_body()
            if path == "/api/v2/generation-jobs":
                job = self.app.create_generation_job(
                    count=int(body.get("count") or 0),
                    prompt=str(body.get("prompt") or ""),
                    profile_id=(
                        str(body["profile_id"]) if body.get("profile_id") else None
                    ),
                    idempotency_key=self._idempotency_key(),
                )
                return self._json(202, {"job": job})
            if path == "/api/v2/brain/jobs":
                job = self.app.create_brain_job(
                    message=str(body.get("message") or ""),
                    piece_id=str(body["piece_id"]) if body.get("piece_id") else None,
                    revision_id=(
                        str(body["revision_id"]) if body.get("revision_id") else None
                    ),
                    audio_sha=str(body["audio_sha"]) if body.get("audio_sha") else None,
                    score=(
                        self._number(body["score"], field="score")
                        if body.get("score") is not None
                        else None
                    ),
                    idempotency_key=self._idempotency_key(),
                )
                return self._json(202, {"job": job})
            if path == "/api/v2/settings/agent/catalog":
                return self._json(200, self.app.discover_agent_catalog(body))
            if path == "/api/v2/settings/agent/test":
                return self._json(200, self.app.test_agent_settings(body))
            if path == "/api/v2/settings/agent/reset":
                return self._json(
                    200,
                    self.app.reset_agent_draft(
                        str(body["base_fingerprint"])
                        if body.get("base_fingerprint")
                        else None
                    ),
                )
            if path == "/api/v2/settings/generation/sync":
                return self._json(
                    200,
                    self.app.sync_generation_from_agent_test(
                        str(body.get("test_id") or "")
                    ),
                )
            match = re.fullmatch(r"/api/v2/pieces/([^/]+)/previews", path)
            if match:
                piece_id = urllib.parse.unquote(match.group(1))
                revision = self.app.create_preview(
                    piece_id=piece_id,
                    source_revision_id=str(body.get("source_revision_id") or ""),
                    code=str(body.get("code") or ""),
                    intent=str(body.get("intent") or ""),
                    idempotency_key=self._idempotency_key(),
                )
                return self._json(
                    201,
                    {"revision": revision, "piece": self.app.get_piece(piece_id)},
                )
            match = re.fullmatch(r"/api/v2/pieces/([^/]+)/revisions", path)
            if match:
                if body.get("action") != "promote":
                    raise V3Error("only the promote revision action is supported")
                result = self.app.promote_revision(
                    piece_id=urllib.parse.unquote(match.group(1)),
                    revision_id=str(body.get("revision_id") or ""),
                )
                return self._json(200, result)
            self._json(404, {"error": "not found"})
        except Exception as exc:
            self._api_error(exc)

    def _api_put(self, path: str) -> None:
        try:
            body = self._json_body()
            if path == "/api/v2/settings/agent/apply":
                draft = body.get("draft")
                if not isinstance(draft, dict):
                    raise V3Error("draft object is required")
                document = self.app.apply_agent_settings(
                    draft=draft,
                    test_id=str(body.get("test_id") or ""),
                )
                return self._json(200, document)
            if path == "/api/v2/settings/generation/default":
                return self._json(
                    200,
                    self.app.set_generation_default(
                        str(body.get("profile_id") or "")
                    ),
                )
            match = re.fullmatch(
                r"/api/v2/pieces/([^/]+)/revisions/([^/]+)/score", path
            )
            if match:
                piece = self.app.score_revision(
                    piece_id=urllib.parse.unquote(match.group(1)),
                    revision_id=urllib.parse.unquote(match.group(2)),
                    audio_sha=str(body.get("audio_sha") or ""),
                    score=self._number(body.get("score"), field="score"),
                    note=str(body.get("note") or ""),
                    source_key=self._idempotency_key(),
                )
                return self._json(200, {"piece": piece})
            self._json(404, {"error": "not found"})
        except Exception as exc:
            self._api_error(exc)

    def _api_patch(self, path: str) -> None:
        try:
            body = self._json_body()
            match = re.fullmatch(r"/api/v2/pieces/([^/]+)", path)
            if not match:
                return self._json(404, {"error": "not found"})
            piece = self.app.patch_piece(
                urllib.parse.unquote(match.group(1)),
                body,
            )
            self._json(200, {"piece": piece})
        except Exception as exc:
            self._api_error(exc)

    def _api_delete(self, path: str) -> None:
        try:
            match = re.fullmatch(r"/api/v2/jobs/([^/]+)", path)
            if match:
                job = self.app.cancel_generation(urllib.parse.unquote(match.group(1)))
                return self._json(200, {"job": job})
            match = re.fullmatch(r"/api/v2/brain/jobs/([^/]+)", path)
            if match:
                job = self.app.cancel_brain_job(urllib.parse.unquote(match.group(1)))
                return self._json(200, {"job": job})
            self._json(404, {"error": "not found"})
        except Exception as exc:
            self._api_error(exc)

    # ------------------------------------------------------------------
    # SSE + files

    def _events(self, after: int) -> None:
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        cursor = max(0, int(after))
        last_keepalive = time.monotonic()
        try:
            while True:
                events = self.app.events_after(cursor)
                for event in events:
                    body = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
                    self.wfile.write(f"id: {event['seq']}\ndata: {body}\n\n".encode())
                    cursor = max(cursor, int(event["seq"]))
                    last_keepalive = time.monotonic()
                if events:
                    self.wfile.flush()
                if time.monotonic() - last_keepalive >= 15:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    last_keepalive = time.monotonic()
                time.sleep(0.4)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def _serve_spa(self) -> None:
        if not APP_INDEX.is_file():
            return self._json(
                503,
                {
                    "error": "Producer UI build is missing",
                    "detail": "run pnpm --filter @cactus/producer-ui build",
                },
            )
        self._serve_local_file(APP_INDEX, cache="no-store")

    def _serve_legacy(self, path: str) -> None:
        mapping = {
            "/legacy/main": ("Main", "main-1728x1117.png"),
            "/legacy/main.html": ("Main", "main-1728x1117.png"),
            "/legacy/data": ("Data", "data-1728x1117.png"),
            "/legacy/data.html": ("Data", "data-1728x1117.png"),
            "/legacy/settings": ("Settings", "settings-1728x1117.png"),
            "/legacy/settings.html": ("Settings", "settings-1728x1117.png"),
            "/legacy/spine": ("Spine", "spine-1728x1117.png"),
            "/legacy/spine.html": ("Spine", "spine-1728x1117.png"),
        }
        page = mapping.get(path)
        if page:
            return self._serve_legacy_snapshot(*page)
        if path.startswith("/legacy/snapshots/"):
            relative = urllib.parse.unquote(
                path.removeprefix("/legacy/snapshots/")
            )
            target = (LEGACY_SCREENSHOT_ROOT / relative).resolve()
            if (
                target != LEGACY_SCREENSHOT_ROOT
                and LEGACY_SCREENSHOT_ROOT not in target.parents
            ):
                return self._json(404, {"error": "legacy snapshot not found"})
            return self._serve_local_file(target, cache="public, max-age=86400")
        if path.startswith("/legacy/uploads/"):
            uploads_root = (LEGACY_ROOT / "uploads").resolve()
            relative = urllib.parse.unquote(
                path.removeprefix("/legacy/uploads/")
            )
            target = (uploads_root / relative).resolve()
            if target != uploads_root and uploads_root not in target.parents:
                return self._json(404, {"error": "legacy snapshot not found"})
            return self._serve_local_file(target, cache="public, max-age=86400")
        return self._json(404, {"error": "legacy snapshot not found"})

    def _serve_legacy_snapshot(self, title: str, screenshot: str) -> None:
        safe_title = html.escape(title)
        safe_screenshot = urllib.parse.quote(screenshot)
        body = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CactusStrudel v2 archive — {safe_title}</title>
  <style>
    :root {{ color-scheme: dark; background: #090a08; color: #f1eee6; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }}
    header {{
      position: sticky; top: 0; z-index: 1; display: flex; gap: 18px;
      align-items: center; padding: 14px 22px; background: #11130fee;
      border-bottom: 1px solid #36372f; backdrop-filter: blur(12px);
    }}
    strong {{ color: #e2bd3f; letter-spacing: .04em; }}
    nav {{ display: flex; gap: 12px; margin-left: auto; }}
    a {{ color: #e8e5dc; text-decoration: none; }}
    a:hover {{ color: #e2bd3f; }}
    figure {{ margin: 0; padding: 18px; overflow: auto; text-align: center; }}
    img {{
      width: min(1728px, 100%); height: auto; border: 1px solid #36372f;
      box-shadow: 0 18px 60px #0008;
    }}
  </style>
</head>
<body>
  <header>
    <strong>FROZEN v2 GUI</strong>
    <span>Read-only visual record · captured 2026-07-28 · no live controls</span>
    <nav aria-label="Frozen GUI pages">
      <a href="/legacy/main">Main</a>
      <a href="/legacy/data">Data</a>
      <a href="/legacy/spine">Spine</a>
      <a href="/legacy/settings">Settings</a>
      <a href="/studio">Return to v3</a>
    </nav>
  </header>
  <figure>
    <img src="/legacy/snapshots/{safe_screenshot}"
         alt="Frozen CactusStrudel v2 {safe_title} screenshot">
  </figure>
</body>
</html>
""".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_head(self):
        """Static serving with byte ranges so transport seeking remains real."""

        path = Path(self.translate_path(self.path))
        app = self.server.app
        if app is not None and hasattr(app, "asset_request_gate"):
            # DT-003: immutable revision assets are served only while their
            # bytes still match the registered receipt.
            refusal = app.asset_request_gate(path)
            if refusal is not None:
                status, payload = refusal
                self._json(status, payload)
                return None
        if path.is_dir():
            return super().send_head()
        if not path.is_file():
            return super().send_head()
        try:
            handle = path.open("rb")
        except OSError:
            self.send_error(404, "File not found")
            return None
        stat = path.stat()
        total = stat.st_size
        content_type = self.guess_type(str(path))
        range_header = self.headers.get("Range")
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
            if not match:
                handle.close()
                self.send_error(416, "Invalid Range")
                return None
            start_text, end_text = match.groups()
            if not start_text and not end_text:
                handle.close()
                self.send_error(416, "Invalid Range")
                return None
            if not start_text:
                suffix = int(end_text)
                start = max(0, total - suffix)
                end = total - 1
            else:
                start = int(start_text)
                end = int(end_text) if end_text else total - 1
            if start >= total or start < 0 or end < start:
                handle.close()
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{total}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            end = min(end, total - 1)
            length = end - start + 1
            handle.seek(start)
            self.send_response(206)
            self.send_header("Content-Type", content_type)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{total}")
            self.send_header("Content-Length", str(length))
            self.send_header("Last-Modified", formatdate(stat.st_mtime, usegmt=True))
            self.send_header("Cache-Control", self._static_cache(path))
            self.end_headers()
            return _RangedFile(handle, length)
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(total))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Last-Modified", formatdate(stat.st_mtime, usegmt=True))
        self.send_header("Cache-Control", self._static_cache(path))
        self.end_headers()
        return handle

    # ------------------------------------------------------------------
    # Small response helpers

    def _json_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 4 * 1024 * 1024:
            raise V3Error("request body is too large")
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise V3Error("request body is not valid JSON") from exc
        if not isinstance(value, dict):
            raise V3Error("request JSON must be an object")
        return value

    def _json(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _api_error(self, exc: Exception) -> None:
        if isinstance(exc, NotFound):
            return self._json(404, {"error": str(exc)})
        if isinstance(exc, OwnershipLost):
            return self._json(
                503,
                {"error": "runtime is shutting down", "detail": str(exc)},
            )
        if isinstance(
            exc,
            (
                Conflict,
                DraftConflict,
                IdempotencyConflict,
                InvalidTransition,
                ReceiptConflict,
            ),
        ):
            return self._json(409, {"error": str(exc)})
        if isinstance(exc, (V3Error, TruthError, AgentV3Error, ValueError)):
            return self._json(400, {"error": str(exc) or type(exc).__name__})
        print(f"[v3] {type(exc).__name__}: {exc}", flush=True)
        self._json(500, {"error": "runtime operation failed", "detail": type(exc).__name__})

    def _serve_local_file(self, path: Path, *, cache: str) -> None:
        if not path.is_file():
            return self._json(404, {"error": "file not found"})
        body = path.read_bytes()
        self.send_response(200)
        self.send_header(
            "Content-Type",
            mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        )
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _idempotency_key(self) -> str:
        value = str(self.headers.get("Idempotency-Key") or "").strip()
        if not value:
            value = f"http-{uuid4().hex}"
        if len(value) > 180:
            raise V3Error("Idempotency-Key is too long")
        return value

    @staticmethod
    def _canonical_path(path: str) -> str:
        return path.rstrip("/") or "/"

    @staticmethod
    def _number(value: object, *, field: str) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise V3Error(f"{field} must be a finite number")
        result = float(value)
        if not math.isfinite(result):
            raise V3Error(f"{field} must be a finite number")
        return result

    def _redirect(self, location: str) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _method_not_allowed(self) -> None:
        self._json(405, {"error": "method not allowed"})

    @staticmethod
    def _static_cache(path: Path) -> str:
        if path.suffix in {".html", ".json"}:
            return "no-store"
        if "/runtime/app/assets/" in str(path):
            return "public, max-age=31536000, immutable"
        return "no-cache"


def main() -> None:
    os.chdir(ROOT)
    # RT-OWNER-001 order: acquire the state-root owner lease first, then bind
    # the port, then construct/recover, and only then accept HTTP work. A
    # losing launch exits before V3Application exists; a port conflict exits
    # before any state mutation.
    try:
        lease = OwnerLease.acquire(STATE_ROOT)
    except StateRootBusy as exc:
        print(f"[v3] refusing to start: {exc}", flush=True)
        print(
            "[v3] another CactusStrudel runtime owns this state root; "
            "stop it (or wait for it to exit) before launching again.",
            flush=True,
        )
        raise SystemExit(3)
    try:
        server = RuntimeServer(("127.0.0.1", PORT), Handler, None)
    except OSError as exc:
        lease.release()
        print(f"[v3] cannot bind 127.0.0.1:{PORT}: {exc}", flush=True)
        raise SystemExit(4)
    try:
        app = V3Application(ROOT, state_root=STATE_ROOT, owner=lease)
    except BaseException:
        server.server_close()
        lease.release()
        raise
    server.app = app

    url = f"http://127.0.0.1:{PORT}/studio"
    print(
        f"CactusStrudel v3 → {url} (owner epoch {lease.epoch})",
        flush=True,
    )
    if os.environ.get("CACTUS_NO_BROWSER") != "1":
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    stop_requested = threading.Event()

    def _request_stop(signum, frame) -> None:
        stop_requested.set()

    signal.signal(signal.SIGINT, _request_stop)
    signal.signal(signal.SIGTERM, _request_stop)

    accept_loop = threading.Thread(
        target=server.serve_forever,
        daemon=True,
        name="cactus-http-accept",
    )
    accept_loop.start()
    try:
        stop_requested.wait()
    finally:
        print(
            "\n[v3] shutting down: quiesce → cancel → drain → close → release",
            flush=True,
        )
        server.shutdown()
        report = app.shutdown(drain_timeout=SHUTDOWN_TIMEOUT)
        server.server_close()
        accept_loop.join(timeout=5)
        print(
            f"[v3] stopped (drained={report['drained']}, "
            f"epoch {report['epoch']} released).",
            flush=True,
        )


if __name__ == "__main__":
    main()
