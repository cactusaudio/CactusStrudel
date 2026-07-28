"""Archived tests for the frozen v2 single-file runtime."""

import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
import types
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
SERVE = ROOT / "runtime" / "serve.py"


def load_serve():
    spec = importlib.util.spec_from_file_location("cactus_runtime_serve", SERVE)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class ServeHelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.serve = load_serve()
        cls.handler = object.__new__(cls.serve.H)

    def test_tempo_parser_accepts_setcps_and_setcpm(self):
        self.assertAlmostEqual(self.serve.H._code_tempo_to_cps("setcps(0.55)\nstack()"), 0.55)
        self.assertAlmostEqual(self.serve.H._code_tempo_to_cps("setcpm(132/4)\nstack()"), 0.55)
        self.assertAlmostEqual(self.serve.H._code_tempo_to_cps("setcpm(33)\nstack()"), 0.55)

    def test_tempo_parser_falls_back_without_eval(self):
        self.assertEqual(self.serve.H._code_tempo_to_cps("setcpm(process.exit())"), 0.5)
        self.assertEqual(self.serve.H._code_tempo_to_cps("stack()"), 0.5)

    def test_dev_resolve_blocks_root_env_files(self):
        with self.assertRaisesRegex(RuntimeError, "sensitive env file"):
            self.handler._dev_resolve_path(str(ROOT / ".env.local"))

    def test_deterministic_validator_code_uses_temp_file_and_cleans_up(self):
        seen = {}

        def fake_validator(path):
            p = pathlib.Path(path)
            seen["path"] = p
            seen["content"] = p.read_text(encoding="utf-8")
            return subprocess.CompletedProcess(["validator", str(p)], 0, '{"ok":true}', "")

        with mock.patch.object(self.handler, "_run_deterministic_validator", side_effect=fake_validator):
            r = self.handler._run_deterministic_validator_code('s("[bd sd")')

        self.assertEqual(r.returncode, 0)
        self.assertEqual(seen["content"], 's("[bd sd")')
        self.assertFalse(seen["path"].exists())

    def test_redact_secrets_masks_common_token_shapes(self):
        text = "key=sk-1234567890abcdef token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        redacted = self.handler._redact_secrets(text)
        self.assertNotIn("sk-1234567890abcdef", redacted)
        self.assertNotIn("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", redacted)
        self.assertIn("***REDACTED***", redacted)

    def test_source_offer_payload_names_agpl_and_repo_root(self):
        payload = self.serve.H._source_offer_payload()
        self.assertEqual(payload["license"], "AGPL-3.0-or-later")
        self.assertTrue(payload["agpl_section_13"])
        self.assertEqual(payload["repo_root"], str(ROOT))
        self.assertIn("complete corresponding source", payload["notice"])

    def test_read_jsonl_tail_cache_invalidates_on_append(self):
        with tempfile.TemporaryDirectory() as td:
            p = pathlib.Path(td) / "tasks.jsonl"
            p.write_text('{"id": 1}\n{"id": 2}\n', encoding="utf-8")
            first = self.handler._read_jsonl(str(p), tail=1)
            self.assertEqual(first, [{"id": 2}])

            self.handler._append_jsonl(str(p), {"id": 3})
            second = self.handler._read_jsonl(str(p), tail=1)
            self.assertEqual(second, [{"id": 3}])

    def test_text_cache_invalidates_on_file_change(self):
        with tempfile.TemporaryDirectory() as td:
            p = pathlib.Path(td) / "pilot.md"
            p.write_text("first", encoding="utf-8")
            self.assertEqual(self.handler._read_text_cached(str(p)), "first")
            p.write_text("second and longer", encoding="utf-8")
            self.assertEqual(self.handler._read_text_cached(str(p)), "second and longer")

    def test_corpus_tail_context_uses_tail_cache(self):
        with tempfile.TemporaryDirectory() as td:
            p = pathlib.Path(td) / "corpus.jsonl"
            p.write_text(
                '{"i":1,"name":"A","score_bowei":5,"extra":"x"}\n'
                '{"i":2,"name":"B","score_bowei":7,"extra":"y"}\n',
                encoding="utf-8",
            )
            with mock.patch.object(self.serve, "MANIFEST", str(p)):
                rows = self.handler._corpus_tail_context(1)
            self.assertEqual(rows, [{
                "i": 2, "name": "B", "score_bowei": 7,
                "generation_issue": None, "dur": None, "extra": "y",
            }])

    def test_manifest_entries_use_jsonl_cache_and_invalidate_on_write(self):
        with tempfile.TemporaryDirectory() as td:
            p = pathlib.Path(td) / "corpus.jsonl"
            p.write_text('{"name":"A"}\n', encoding="utf-8")
            with mock.patch.object(self.serve, "MANIFEST", str(p)):
                self.assertEqual(self.handler._manifest_entries(), [{"name": "A"}])
                self.handler._append_manifest_entry({"name": "B"})
                self.assertEqual([r["name"] for r in self.handler._manifest_entries()], ["A", "B"])
                self.handler._write_manifest_entries([{"name": "C"}])
                self.assertEqual(self.handler._manifest_entries(), [{"name": "C"}])

    def test_download_stem_strips_header_metacharacters(self):
        self.assertEqual(
            self.serve.H._safe_download_stem('bad"\r\nX-Injected: yes.mid'),
            "bad_X-Injected_yes.mid",
        )
        self.assertEqual(self.serve.H._safe_download_stem("..."), "export")

    def test_prompt_kernel_lock_verifies_current_fragments(self):
        import runtime.prompt_kernel as prompt_kernel

        good = prompt_kernel.verify_lock()
        self.assertTrue(good["ok"], good.get("error"))
        with tempfile.TemporaryDirectory() as td:
            lock = pathlib.Path(td) / "kernel.lock.json"
            lock.write_text('{"hash":"wrong","fragments_used":[],"fragment_hashes":{},"text_length":0}', encoding="utf-8")
            with mock.patch.object(prompt_kernel, "LOCK_PATH", str(lock)):
                bad = prompt_kernel.verify_lock()
            self.assertFalse(bad["ok"])
            self.assertIn("kernel lock mismatch", bad["error"])

    def test_prune_bridge_tasks_keeps_active_and_recent_terminal(self):
        rows = [{"id": f"done-{i}", "status": "done"} for i in range(5)]
        rows += [{"id": "run", "status": "running"}, {"id": "queued", "status": "queued"}]
        pruned = self.serve.H._prune_bridge_tasks(rows, keep_terminal=2)
        self.assertEqual([r["id"] for r in pruned], ["run", "queued", "done-3", "done-4"])


class ServeEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.serve = load_serve()

    def make_handler(self):
        handler = object.__new__(self.serve.H)
        handler._captured = None

        def capture_json(this, code, payload):
            this._captured = (code, payload)

        handler._json = types.MethodType(capture_json, handler)
        return handler

    def test_dispatch_get_source_offer_returns_agpl_payload(self):
        handler = self.make_handler()
        handler.path = "/api/source-offer"
        handler._dispatch_get()
        code, payload = handler._captured
        self.assertEqual(code, 200)
        self.assertEqual(payload["license"], "AGPL-3.0-or-later")
        self.assertTrue(payload["agpl_section_13"])
        self.assertIn("complete corresponding source", payload["notice"])

    def test_dispatch_get_cc_state_reads_bridge_files_and_kick_marker(self):
        with tempfile.TemporaryDirectory() as td:
            bridge = pathlib.Path(td)
            inbox = bridge / "inbox.jsonl"
            replies = bridge / "replies.jsonl"
            proposals = bridge / "proposals.jsonl"
            tasks = bridge / "tasks.jsonl"
            transcript = bridge / "transcript-tail.jsonl"
            inbox.write_text('{"id":"in-1","status":"pending"}\n', encoding="utf-8")
            replies.write_text('{"id":"rp-1"}\n', encoding="utf-8")
            proposals.write_text("", encoding="utf-8")
            tasks.write_text('{"id":"task-1","status":"running"}\n', encoding="utf-8")
            transcript.write_text('{"id":"tr-1"}\n', encoding="utf-8")
            (bridge / ".kick").write_text("1", encoding="utf-8")

            with mock.patch.multiple(
                self.serve,
                BRIDGE=str(bridge),
                INBOX=str(inbox),
                REPLIES=str(replies),
                PROPOSALS=str(proposals),
                TASKS=str(tasks),
                TRANSCRIPT=str(transcript),
            ):
                handler = self.make_handler()
                handler.path = "/api/cc/state"
                handler._dispatch_get()

        code, payload = handler._captured
        self.assertEqual(code, 200)
        self.assertEqual(payload["inbox"][0]["id"], "in-1")
        self.assertEqual(payload["tasks"][0]["id"], "task-1")
        self.assertTrue(payload["kick_pending"])
        self.assertIn("presets", payload)

    def test_dispatch_post_cc_inbox_appends_jsonl_and_kick_marker(self):
        with tempfile.TemporaryDirectory() as td:
            bridge = pathlib.Path(td)
            inbox = bridge / "inbox.jsonl"
            with mock.patch.multiple(self.serve, BRIDGE=str(bridge), INBOX=str(inbox)):
                handler = self.make_handler()
                handler.path = "/api/cc/inbox"
                handler._json_body = types.MethodType(
                    lambda this: {"text": "检查最新 piece", "tag": "chat", "context": {"piece_name": "UI-test"}},
                    handler,
                )
                handler._dispatch_post()

            code, payload = handler._captured
            self.assertEqual(code, 200)
            self.assertTrue(payload["ok"])
            self.assertTrue(inbox.exists())
            self.assertTrue((bridge / ".kick").exists())
            row = __import__("json").loads(inbox.read_text(encoding="utf-8").strip())
            self.assertEqual(row["text"], "检查最新 piece")
            self.assertEqual(row["context"]["piece_name"], "UI-test")

    def test_kernel_fragment_endpoint_rejects_path_traversal(self):
        handler = self.make_handler()
        handler.path = "/api/kernel/fragment?name=../../.env"
        handler._dispatch_get()
        code, payload = handler._captured
        self.assertEqual(code, 404)
        self.assertIn("fragment not found", payload["error"])
        self.assertNotIn("content", payload)

    def test_update_piece_code_endpoint_renders_updates_manifest_and_revision(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            pieces = root / "producer-brain" / "pieces"
            audio = root / "producer-brain" / "audio"
            features = root / "producer-brain" / "features"
            bridge = root / "runtime" / "cc-bridge"
            pieces.mkdir(parents=True)
            audio.mkdir(parents=True)
            features.mkdir(parents=True)
            bridge.mkdir(parents=True)

            js = pieces / "piece.js"
            js.write_text("old code\n", encoding="utf-8")
            manifest = root / "producer-brain" / "corpus.jsonl"
            manifest.write_text('{"name":"UI-test","js":"producer-brain/pieces/piece.js","sha":"oldsha","dur":"1.0"}\n', encoding="utf-8")
            revisions = root / "producer-brain" / "revisions.jsonl"

            def fake_render(path, **_kwargs):
                (audio / "piece.mp3").write_bytes(b"mp3")
                (features / "piece.features.json").write_text('{"rms_db":-12}', encoding="utf-8")
                return subprocess.CompletedProcess(["render"], 0, "render ok", "")

            with mock.patch.multiple(
                self.serve,
                ROOT=str(root),
                MANIFEST=str(manifest),
                PIECES=str(pieces),
                AUDIO=str(audio),
                FEATURES=str(features),
                BRIDGE=str(bridge),
                BRAIN_BACKUPS=str(bridge / "brain-edit-backups"),
                REVISIONS=str(revisions),
            ):
                handler = self.make_handler()
                handler.path = "/api/update-piece-code"
                handler._json_body = types.MethodType(lambda this: {
                    "name": "UI-test",
                    "code": "new code\n",
                    "source": "endpoint-test",
                    "intent": {"kind": "mix", "target": "lead"},
                }, handler)
                with mock.patch.object(handler, "_run_render_subprocess", side_effect=fake_render), \
                     mock.patch.object(handler, "_probe_mp3", return_value=("newsha", "2.0")):
                    handler._dispatch_post()

            code, payload = handler._captured
            self.assertEqual(code, 200)
            self.assertTrue(payload["ok"])
            self.assertEqual(js.read_text(encoding="utf-8"), "new code\n")
            rows = [__import__("json").loads(line) for line in manifest.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(rows[0]["sha"], "newsha")
            self.assertEqual(rows[0]["dur"], "2.0")
            self.assertEqual(rows[0]["features"], "producer-brain/features/piece.features.json")
            self.assertEqual(rows[0]["audio_features"], {"rms_db": -12})
            self.assertIn("manual_last_save", rows[0])
            rev_rows = [__import__("json").loads(line) for line in revisions.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(rev_rows[0]["piece"], "UI-test")
            self.assertEqual(rev_rows[0]["source"], "endpoint-test")
            self.assertTrue((root / rev_rows[0]["backup_dir"] / "diff.txt").exists())

    def test_update_piece_code_endpoint_restores_code_on_render_failure(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            pieces = root / "producer-brain" / "pieces"
            audio = root / "producer-brain" / "audio"
            bridge = root / "runtime" / "cc-bridge"
            pieces.mkdir(parents=True)
            audio.mkdir(parents=True)
            bridge.mkdir(parents=True)

            js = pieces / "piece.js"
            js.write_text("old code\n", encoding="utf-8")
            manifest = root / "producer-brain" / "corpus.jsonl"
            manifest.write_text('{"name":"UI-test","js":"producer-brain/pieces/piece.js","sha":"oldsha","dur":"1.0"}\n', encoding="utf-8")

            with mock.patch.multiple(
                self.serve,
                ROOT=str(root),
                MANIFEST=str(manifest),
                PIECES=str(pieces),
                AUDIO=str(audio),
                BRIDGE=str(bridge),
                BRAIN_BACKUPS=str(bridge / "brain-edit-backups"),
                REVISIONS=str(root / "producer-brain" / "revisions.jsonl"),
            ):
                handler = self.make_handler()
                handler.path = "/api/update-piece-code"
                handler._json_body = types.MethodType(lambda this: {"name": "UI-test", "code": "bad code\n"}, handler)
                with mock.patch.object(
                    handler,
                    "_run_render_subprocess",
                    return_value=subprocess.CompletedProcess(["render"], 1, "", "render failed"),
                ):
                    handler._dispatch_post()

            code, payload = handler._captured
            self.assertEqual(code, 500)
            self.assertIn("restored", payload["error"])
            self.assertEqual(js.read_text(encoding="utf-8"), "old code\n")
            row = __import__("json").loads(manifest.read_text(encoding="utf-8").strip())
            self.assertEqual(row["sha"], "oldsha")

    def test_render_endpoint_returns_mp3_path_from_central_render_subprocess(self):
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            pieces = root / "producer-brain" / "pieces"
            audio = root / "producer-brain" / "audio"
            pieces.mkdir(parents=True)
            audio.mkdir(parents=True)
            js = pieces / "piece.js"
            js.write_text('s("bd*4")\n', encoding="utf-8")

            def fake_render(path, **_kwargs):
                (audio / "piece.mp3").write_bytes(b"mp3")
                return subprocess.CompletedProcess(["render"], 0, "stdout", "stderr")

            with mock.patch.multiple(self.serve, ROOT=str(root), PIECES=str(pieces), AUDIO=str(audio)):
                handler = self.make_handler()
                handler.path = "/api/render"
                handler._json_body = types.MethodType(lambda this: {"js": "producer-brain/pieces/piece.js"}, handler)
                with mock.patch.object(handler, "_run_render_subprocess", side_effect=fake_render):
                    handler._dispatch_post()

            code, payload = handler._captured
            self.assertEqual(code, 200)
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["mp3"], "producer-brain/audio/piece.mp3")
            self.assertEqual(payload["stdout"], "stdout")


if __name__ == "__main__":
    unittest.main()
