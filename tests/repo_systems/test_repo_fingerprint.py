from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from scripts.repo_fingerprint import _parse_index, snapshot_repository, tree_hash


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "repo_fingerprint.py"


class RepositoryFingerprintTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Fingerprint Test")
        self.git("config", "user.email", "fingerprint@example.invalid")
        self.write(".gitignore", "ignored/\n")
        self.write("src/main.ts", "export const value = 1;\n")
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def git(self, *args: str) -> str:
        completed = subprocess.run(
            ("git", *args),
            cwd=self.root,
            text=True,
            capture_output=True,
            check=True,
        )
        return completed.stdout.strip()

    def write(self, relative: str, content: str) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def test_untracked_paths_and_content_are_hashed_exactly(self) -> None:
        clean = snapshot_repository(self.root, include_paths=True)
        self.write("notes/nested/idea.md", "first\n")
        first = snapshot_repository(self.root, include_paths=True)

        self.assertEqual(first["untracked_files"], 1)
        self.assertEqual(
            first["untracked_manifest"],
            [
                {
                    "path": "notes/nested/idea.md",
                    "mode": "100644",
                    "bytes": 6,
                    "sha256": hashlib.sha256(b"first\n").hexdigest(),
                }
            ],
        )
        self.assertNotEqual(clean["working_tree_sha256"], first["working_tree_sha256"])

        self.write("notes/nested/idea.md", "second\n")
        second = snapshot_repository(self.root, include_paths=True)
        self.assertNotEqual(first["untracked_tree_sha256"], second["untracked_tree_sha256"])
        self.assertNotEqual(first["effective_tree_sha256"], second["effective_tree_sha256"])

        (self.root / "notes/nested/idea.md").rename(self.root / "notes/nested/renamed.md")
        renamed = snapshot_repository(self.root, include_paths=True)
        self.assertNotEqual(second["untracked_tree_sha256"], renamed["untracked_tree_sha256"])
        self.assertEqual(renamed["untracked_manifest"][0]["path"], "notes/nested/renamed.md")

    def test_stage_partition_is_exact_but_commit_is_not_required(self) -> None:
        self.write("src/main.ts", "export const value = 2;\n")
        unstaged = snapshot_repository(self.root)
        self.git("add", "src/main.ts")
        staged = snapshot_repository(self.root)

        self.assertEqual(unstaged["effective_tree_sha256"], staged["effective_tree_sha256"])
        self.assertNotEqual(unstaged["index_tree_sha256"], staged["index_tree_sha256"])
        self.assertNotEqual(unstaged["working_tree_sha256"], staged["working_tree_sha256"])
        self.assertEqual(staged["staged_changes"], 1)
        self.assertEqual(staged["unstaged_changes"], 0)

        self.git("commit", "-qm", "land identical bytes")
        committed = snapshot_repository(self.root)
        self.assertEqual(staged["effective_tree_sha256"], committed["effective_tree_sha256"])
        self.assertEqual(staged["index_tree_sha256"], committed["index_tree_sha256"])
        self.assertEqual(staged["working_tree_sha256"], committed["working_tree_sha256"])
        self.assertEqual(staged["staged_state_sha256"], committed["staged_state_sha256"])
        self.assertNotEqual(staged["landing_state_sha256"], committed["landing_state_sha256"])
        self.assertEqual(committed["staged_changes"], 0)

    def test_unrecognized_git_exposed_flag_bits_are_not_discarded(self) -> None:
        def record(flags: str) -> bytes:
            return (
                b"100644 0123456789012345678901234567890123456789 0\tsrc/main.ts\0"
                b"  ctime: 0:0\n"
                b"  mtime: 0:0\n"
                b"  dev: 0\tino: 0\n"
                b"  uid: 0\tgid: 0\n"
                b"  size: 0\tflags: " + flags.encode("ascii") + b"\n"
            )

        ordinary = _parse_index(record("0"))
        extra_raw_bit = _parse_index(record("1000"))
        self.assertEqual(extra_raw_bit[0]["flags"]["raw_hex"], "1000")
        self.assertNotEqual(tree_hash(ordinary), tree_hash(extra_raw_bit))

    def test_assume_unchanged_flag_only_change_updates_index_and_landing_identity(self) -> None:
        before = snapshot_repository(self.root, include_paths=True)
        before_entry = next(
            entry for entry in before["index_manifest"] if entry["path"] == "src/main.ts"
        )

        self.git("update-index", "--assume-unchanged", "src/main.ts")
        after = snapshot_repository(self.root, include_paths=True)
        after_entry = next(
            entry for entry in after["index_manifest"] if entry["path"] == "src/main.ts"
        )

        self.assertEqual(
            {key: before_entry[key] for key in ("path", "mode", "object", "stage")},
            {key: after_entry[key] for key in ("path", "mode", "object", "stage")},
        )
        self.assertFalse(before_entry["flags"]["assume_unchanged"])
        self.assertTrue(after_entry["flags"]["assume_unchanged"])
        self.assertNotEqual(before["index_flags_sha256"], after["index_flags_sha256"])
        self.assertNotEqual(before["index_tree_sha256"], after["index_tree_sha256"])
        self.assertNotEqual(before["staged_state_sha256"], after["staged_state_sha256"])
        self.assertNotEqual(before["working_tree_sha256"], after["working_tree_sha256"])
        self.assertNotEqual(before["landing_state_sha256"], after["landing_state_sha256"])
        self.assertEqual(before["dirty_entries"], after["dirty_entries"])

        self.git("update-index", "--no-assume-unchanged", "src/main.ts")
        restored = snapshot_repository(self.root)
        self.assertEqual(before["index_tree_sha256"], restored["index_tree_sha256"])
        self.assertEqual(before["landing_state_sha256"], restored["landing_state_sha256"])

    def test_skip_worktree_flag_only_change_updates_index_and_landing_identity(self) -> None:
        before = snapshot_repository(self.root, include_paths=True)
        before_entry = next(
            entry for entry in before["index_manifest"] if entry["path"] == "src/main.ts"
        )

        self.git("update-index", "--skip-worktree", "src/main.ts")
        after = snapshot_repository(self.root, include_paths=True)
        after_entry = next(
            entry for entry in after["index_manifest"] if entry["path"] == "src/main.ts"
        )

        self.assertEqual(
            {key: before_entry[key] for key in ("path", "mode", "object", "stage")},
            {key: after_entry[key] for key in ("path", "mode", "object", "stage")},
        )
        self.assertFalse(before_entry["flags"]["skip_worktree"])
        self.assertTrue(after_entry["flags"]["skip_worktree"])
        self.assertTrue(after_entry["flags"]["extended"])
        self.assertNotEqual(before["index_flags_sha256"], after["index_flags_sha256"])
        self.assertNotEqual(before["index_tree_sha256"], after["index_tree_sha256"])
        self.assertNotEqual(before["staged_state_sha256"], after["staged_state_sha256"])
        self.assertNotEqual(before["working_tree_sha256"], after["working_tree_sha256"])
        self.assertNotEqual(before["landing_state_sha256"], after["landing_state_sha256"])
        self.assertEqual(before["dirty_entries"], after["dirty_entries"])

        self.git("update-index", "--no-skip-worktree", "src/main.ts")
        restored = snapshot_repository(self.root)
        self.assertEqual(before["index_tree_sha256"], restored["index_tree_sha256"])
        self.assertEqual(before["landing_state_sha256"], restored["landing_state_sha256"])

    def test_intent_to_add_flag_participates_even_when_index_object_is_identical(self) -> None:
        path = self.write("src/intent.ts", "export const intent = true;\n")
        self.git("add", "--intent-to-add", "src/intent.ts")
        intent = snapshot_repository(self.root, include_paths=True)
        intent_entry = next(
            entry for entry in intent["index_manifest"] if entry["path"] == "src/intent.ts"
        )
        self.assertTrue(intent_entry["flags"]["intent_to_add"])
        self.assertTrue(intent_entry["flags"]["extended"])

        empty_blob = self.git("hash-object", "-t", "blob", "/dev/null")
        self.git(
            "update-index",
            "--add",
            "--cacheinfo",
            f"100644,{empty_blob},src/intent.ts",
        )
        ordinary = snapshot_repository(self.root, include_paths=True)
        ordinary_entry = next(
            entry for entry in ordinary["index_manifest"] if entry["path"] == "src/intent.ts"
        )

        self.assertEqual(
            {key: intent_entry[key] for key in ("path", "mode", "object", "stage")},
            {key: ordinary_entry[key] for key in ("path", "mode", "object", "stage")},
        )
        self.assertFalse(ordinary_entry["flags"]["intent_to_add"])
        self.assertNotEqual(intent["index_flags_sha256"], ordinary["index_flags_sha256"])
        self.assertNotEqual(intent["index_tree_sha256"], ordinary["index_tree_sha256"])
        self.assertNotEqual(intent["staged_state_sha256"], ordinary["staged_state_sha256"])
        self.assertNotEqual(intent["working_tree_sha256"], ordinary["working_tree_sha256"])
        self.assertNotEqual(intent["landing_state_sha256"], ordinary["landing_state_sha256"])
        self.assertTrue(path.is_file())

    def test_generated_builds_state_handoffs_and_ignored_files_are_excluded(self) -> None:
        before = snapshot_repository(self.root)
        self.write("docs/STATE.md", "generated state\n")
        self.write("handoffs/HANDOFF.latest.md", "generated handoff\n")
        self.write("runtime/app/index.html", "generated producer build\n")
        self.write("apps/renderer-page/dist/index.html", "generated renderer build\n")
        self.write("ignored/cache.bin", "ignored\n")
        after = snapshot_repository(self.root)

        self.assertEqual(before["effective_tree_sha256"], after["effective_tree_sha256"])
        self.assertEqual(before["working_tree_sha256"], after["working_tree_sha256"])
        self.assertEqual(after["untracked_files"], 0)


    def test_leading_dot_source_paths_are_not_misnormalized(self) -> None:
        before = snapshot_repository(self.root, include_paths=True)
        self.write(".cache/transient.bin", "cache\n")
        self.write(".github/workflows/verify.yml", "name: verify\n")
        after = snapshot_repository(self.root, include_paths=True)

        untracked = {entry["path"] for entry in after["untracked_manifest"]}
        self.assertIn(".github/workflows/verify.yml", untracked)
        self.assertNotIn(".cache/transient.bin", untracked)
        self.assertNotEqual(before["working_tree_sha256"], after["working_tree_sha256"])

    def test_full_manifest_preserves_index_objects_and_stages(self) -> None:
        self.write("src/main.ts", "export const value = 3;\n")
        self.git("add", "src/main.ts")
        self.write("src/main.ts", "export const value = 4;\n")
        snapshot = snapshot_repository(self.root, include_paths=True)

        index_entry = next(item for item in snapshot["index_manifest"] if item["path"] == "src/main.ts")
        worktree_entry = next(
            item for item in snapshot["tracked_worktree_manifest"] if item["path"] == "src/main.ts"
        )
        self.assertEqual(index_entry["stage"], "0")
        self.assertRegex(index_entry["object"], r"^[0-9a-f]{40,64}$")
        self.assertEqual(
            worktree_entry["sha256"],
            hashlib.sha256(b"export const value = 4;\n").hexdigest(),
        )
        self.assertEqual(snapshot["staged_changes"], 1)
        self.assertEqual(snapshot["unstaged_changes"], 1)

    def test_cli_writes_full_attestation_outside_source_identity(self) -> None:
        output = Path(self.temp.name).parent / f"{Path(self.temp.name).name}-attestation.json"
        try:
            completed = subprocess.run(
                (
                    "python3",
                    str(SCRIPT),
                    "--root",
                    str(self.root),
                    "--include-paths",
                    "--pretty",
                    "--output",
                    str(output),
                ),
                text=True,
                capture_output=True,
                check=True,
            )
            self.assertEqual(completed.stdout.strip(), str(output))
            loaded = json.loads(output.read_text(encoding="utf-8"))
            self.assertIn("effective_manifest", loaded)
            self.assertIn("index_manifest", loaded)
            self.assertIn("untracked_manifest", loaded)
        finally:
            output.unlink(missing_ok=True)

    def test_cli_rejects_a_self_referential_source_output(self) -> None:
        completed = subprocess.run(
            (
                "python3",
                str(SCRIPT),
                "--root",
                str(self.root),
                "--output",
                str(self.root / "source-attestation.json"),
            ),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("must be source-excluded", completed.stderr)
        self.assertFalse((self.root / "source-attestation.json").exists())


if __name__ == "__main__":
    unittest.main()
