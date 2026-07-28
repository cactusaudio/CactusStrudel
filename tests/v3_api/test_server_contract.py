from __future__ import annotations

import http.client
import json
import threading
import unittest

from .helpers import REPO_ROOT  # noqa: F401 - also installs runtime on sys.path

from serve import Handler, RuntimeServer
from v3.store import IdempotencyConflict, InvalidTransition, ReceiptConflict
from v3_api import V3Error


class ServerContractTests(unittest.TestCase):
    @staticmethod
    def _start_server(app=object()):
        server = RuntimeServer(("127.0.0.1", 0), Handler, app)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        return server, worker

    def test_domain_conflicts_map_to_http_409(self) -> None:
        handler = object.__new__(Handler)
        captured: list[tuple[int, object]] = []
        handler._json = lambda status, payload: captured.append((status, payload))

        for error in (
            IdempotencyConflict("same key, different preview"),
            InvalidTransition("preview is already running"),
            ReceiptConflict("rating audio SHA is stale"),
        ):
            captured.clear()
            handler._api_error(error)
            self.assertEqual(captured[0][0], 409, type(error).__name__)

        captured.clear()
        handler._api_error(V3Error("bad request shape"))
        self.assertEqual(captured[0][0], 400)

    def test_asset_gate_refusal_is_served_as_json(self) -> None:
        class GatedApp:
            def asset_request_gate(self, path):
                if str(path).endswith("package.json"):
                    return 409, {
                        "error": "revision is not usable for playback",
                        "detail": "receipt file hash drift: audio.mp3",
                    }
                return None

        server, worker = self._start_server(GatedApp())
        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_address[1], timeout=2
        )
        try:
            connection.request("GET", "/package.json")
            response = connection.getresponse()
            self.assertEqual(response.status, 409)
            payload = json.loads(response.read())
            self.assertEqual(
                payload["error"], "revision is not usable for playback"
            )
            connection.request("GET", "/README.md")
            allowed = connection.getresponse()
            self.assertEqual(allowed.status, 200)
            allowed.read()
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_unsatisfiable_range_has_zero_length_http11_framing(self) -> None:
        server = RuntimeServer(("127.0.0.1", 0), Handler, object())
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_address[1], timeout=2
        )
        try:
            connection.request(
                "GET",
                "/package.json",
                headers={"Range": "bytes=999999999-"},
            )
            response = connection.getresponse()
            self.assertEqual(response.status, 416)
            self.assertEqual(
                response.getheader("Content-Range"),
                f"bytes */{(REPO_ROOT / 'package.json').stat().st_size}",
            )
            self.assertEqual(response.getheader("Content-Length"), "0")
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_satisfiable_range_returns_exact_bytes(self) -> None:
        expected = (REPO_ROOT / "package.json").read_bytes()[3:12]
        server = RuntimeServer(("127.0.0.1", 0), Handler, object())
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_address[1], timeout=2
        )
        try:
            connection.request(
                "GET",
                "/package.json",
                headers={"Range": "bytes=3-11"},
            )
            response = connection.getresponse()
            self.assertEqual(response.status, 206)
            self.assertEqual(response.getheader("Content-Length"), "9")
            self.assertEqual(response.read(), expected)
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_generation_settings_mutation_routes_call_application_boundary(self) -> None:
        class SettingsApp:
            def __init__(self):
                self.calls = []

            def sync_generation_from_agent_test(self, test_id):
                self.calls.append(("sync", test_id))
                return {"revision_id": "gencfg-sync", "default_profile_id": "sol-max"}

            def set_generation_default(self, profile_id):
                self.calls.append(("default", profile_id))
                return {
                    "revision_id": "gencfg-default",
                    "default_profile_id": profile_id,
                }

        app = SettingsApp()
        server, worker = self._start_server(app)
        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_address[1], timeout=2
        )
        try:
            connection.request(
                "POST",
                "/api/v2/settings/generation/sync",
                body=json.dumps({"test_id": "agenttest-exact"}),
                headers={"Content-Type": "application/json"},
            )
            sync_response = connection.getresponse()
            sync_payload = json.loads(sync_response.read())
            connection.request(
                "PUT",
                "/api/v2/settings/generation/default",
                body=json.dumps({"profile_id": "opus-producer"}),
                headers={"Content-Type": "application/json"},
            )
            default_response = connection.getresponse()
            default_payload = json.loads(default_response.read())

            self.assertEqual(sync_response.status, 200)
            self.assertEqual(default_response.status, 200)
            self.assertEqual(
                app.calls,
                [
                    ("sync", "agenttest-exact"),
                    ("default", "opus-producer"),
                ],
            )
            self.assertEqual(sync_payload["revision_id"], "gencfg-sync")
            self.assertEqual(
                default_payload["default_profile_id"], "opus-producer"
            )
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_health_route_uses_compact_application_readback(self) -> None:
        class HealthApp:
            def __init__(self):
                self.calls = 0

            def health(self):
                self.calls += 1
                return {
                    "ok": True,
                    "api_version": "v2",
                    "pieces": 51,
                    "generation_jobs": 4,
                    "brain_jobs": 0,
                    "agent_ready": False,
                    "cursor": 31,
                }

            def bootstrap(self):
                raise AssertionError("health must not materialize bootstrap")

        app = HealthApp()
        server, worker = self._start_server(app)
        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_address[1], timeout=2
        )
        try:
            connection.request("GET", "/api/v2/health")
            response = connection.getresponse()
            payload = json.loads(response.read())
            self.assertEqual(response.status, 200)
            self.assertEqual(payload["pieces"], 51)
            self.assertEqual(app.calls, 1)
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_score_route_is_canonical_and_binds_retry_key(self) -> None:
        class ScoreApp:
            def __init__(self):
                self.calls = []

            def score_revision(self, **kwargs):
                self.calls.append(kwargs)
                return {"id": kwargs["piece_id"]}

        app = ScoreApp()
        server, worker = self._start_server(app)
        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_address[1], timeout=2
        )
        try:
            connection.request(
                "PUT",
                "/api/v2/pieces/piece-a/revisions/revision-a/score/",
                body=json.dumps(
                    {"audio_sha": "sha-a", "score": 7.5, "note": "heard"}
                ),
                headers={
                    "Content-Type": "application/json",
                    "Idempotency-Key": "score-intent-a",
                },
            )
            response = connection.getresponse()
            payload = json.loads(response.read())
            self.assertEqual(response.status, 200)
            self.assertEqual(payload["piece"]["id"], "piece-a")
            self.assertEqual(
                app.calls,
                [
                    {
                        "piece_id": "piece-a",
                        "revision_id": "revision-a",
                        "audio_sha": "sha-a",
                        "score": 7.5,
                        "note": "heard",
                        "source_key": "score-intent-a",
                    }
                ],
            )
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_score_rejects_non_numeric_json_as_bad_request(self) -> None:
        class ScoreApp:
            def score_revision(self, **_kwargs):
                raise AssertionError("invalid score must not reach the application")

        server, worker = self._start_server(ScoreApp())
        try:
            for invalid in (None, True, [7.5]):
                connection = http.client.HTTPConnection(
                    "127.0.0.1", server.server_address[1], timeout=2
                )
                try:
                    connection.request(
                        "PUT",
                        "/api/v2/pieces/p/revisions/r/score",
                        body=json.dumps({"audio_sha": "sha", "score": invalid}),
                        headers={"Content-Type": "application/json"},
                    )
                    response = connection.getresponse()
                    payload = json.loads(response.read())
                    self.assertEqual(response.status, 400)
                    self.assertEqual(payload["error"], "score must be a finite number")
                finally:
                    connection.close()
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_old_gui_bookmarks_redirect_to_v3_for_get_and_head(self) -> None:
        expected = {
            "/runtime/main.html": "/studio",
            "/runtime/data.html": "/library",
            "/runtime/settings.html": "/settings/agent",
            "/runtime/spine.html": "/research",
        }
        server, worker = self._start_server()
        observed = []
        try:
            for method in ("GET", "HEAD"):
                for path, destination in expected.items():
                    connection = http.client.HTTPConnection(
                        "127.0.0.1", server.server_address[1], timeout=2
                    )
                    try:
                        connection.request(method, path)
                        response = connection.getresponse()
                        response.read()
                        observed.append(
                            (
                                method,
                                path,
                                response.status,
                                response.getheader("Location"),
                                response.getheader("Content-Length"),
                            )
                        )
                    finally:
                        connection.close()
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

        self.assertEqual(
            observed,
            [
                (method, path, 302, destination, "0")
                for method in ("GET", "HEAD")
                for path, destination in expected.items()
            ],
        )

    def test_frozen_gui_aliases_are_static_visual_records(self) -> None:
        server, worker = self._start_server()
        try:
            for path in ("/legacy/data", "/legacy/data.html"):
                connection = http.client.HTTPConnection(
                    "127.0.0.1", server.server_address[1], timeout=2
                )
                try:
                    connection.request("GET", path)
                    response = connection.getresponse()
                    body = response.read()
                    self.assertEqual(response.status, 200)
                    self.assertIn(b"<!doctype html", body[:200])
                    self.assertIn(b"Read-only visual record", body)
                    self.assertIn(
                        b"/legacy/snapshots/data-1728x1117.png", body
                    )
                    self.assertNotIn(b"<script", body)
                finally:
                    connection.close()

            connection = http.client.HTTPConnection(
                "127.0.0.1", server.server_address[1], timeout=2
            )
            try:
                connection.request(
                    "GET", "/legacy/snapshots/data-1728x1117.png"
                )
                response = connection.getresponse()
                body = response.read()
                expected = (
                    REPO_ROOT
                    / "archive"
                    / "gui"
                    / "ui-v2-baseline-20260728-95f85f6"
                    / "screenshots"
                    / "data-1728x1117.png"
                ).read_bytes()
                self.assertEqual(response.status, 200)
                self.assertEqual(body, expected)
            finally:
                connection.close()
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
