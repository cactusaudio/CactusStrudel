from __future__ import annotations

from copy import deepcopy
import unittest

from scripts import repo_context


def build_check(surface: str, output_hash: str) -> dict:
    return {
        "available": True,
        "valid": True,
        "surface": surface,
        "reasons": [],
        "receipt_sha256": "r" * 64,
        "input_sha256": "i" * 64,
        "output_sha256": output_hash,
        "receipt": {
            "task": {
                "command": f"pnpm --filter @cactus/{surface} build",
                "package_script": f"vite build && receipt {surface}",
            },
            "builder": {
                "sha256": "h" * 64,
                "node": "v22.16.0",
                "platform": "darwin",
                "arch": "arm64",
                "package_manager_declared": "pnpm@11.0.9",
                "package_manager_user_agent": "pnpm/11.0.9",
                "environment": {"keys": ["CI"], "sha256": "b" * 64},
            },
            "lock": {"sha256": "l" * 64},
            "inputs": {"sha256": "i" * 64, "files": [{"path": "package.json"}]},
            "outputs": {"sha256": output_hash, "files": [{"path": "index.html"}]},
        },
    }


def context() -> dict:
    return {
        "observed_at": "2026-07-28T00:00:00+00:00",
        "git": {
            "available": True,
            "head": "a" * 40,
            "branch": "cutover",
            "landing_state_sha256": "d" * 64,
            "effective_tree_sha256": "e" * 64,
            "working_tree_sha256": "w" * 64,
            "tracked_worktree_sha256": "t" * 64,
            "index_tree_sha256": "x" * 64,
            "index_flags_sha256": "f" * 64,
            "staged_state_sha256": "s" * 64,
            "unstaged_state_sha256": "u" * 64,
            "untracked_tree_sha256": "n" * 64,
            "effective_files": 187,
            "effective_bytes": 4_000_000,
            "untracked_files": 30,
            "untracked_bytes": 123_456,
            "staged_changes": 5,
            "unstaged_changes": 7,
        },
        "server": {"online": False, "base_url": "http://127.0.0.1:8765", "health": {}},
        "database": {"path": "/tmp/runtime.sqlite3", "exists": False},
        "kernel": {"hash": "kernel", "fragments": 6},
        "builds": {
            "producer_ui": build_check("producer-ui", "p" * 64),
            "renderer_page": build_check("renderer-page", "q" * 64),
            "producer_ui_served": {
                "available": True,
                "valid": True,
                "reasons": [],
                "served_output_sha256": "p" * 64,
            },
            "renderer_page_served": {
                "available": False,
                "valid": None,
                "reasons": ["ephemeral"],
            },
        },
    }


class StateTruthSurfaceTests(unittest.TestCase):
    def test_git_landing_metadata_does_not_create_state_self_loop(self) -> None:
        first = context()
        second = deepcopy(first)
        second["observed_at"] = "2026-07-29T00:00:00+00:00"
        second["git"].update(
            {
                "head": "b" * 40,
                "branch": "landed",
                "landing_state_sha256": "c" * 64,
                "staged_changes": 0,
                "unstaged_changes": 0,
            }
        )
        self.assertEqual(
            repo_context.normalized_state(repo_context.state_markdown(first)),
            repo_context.normalized_state(repo_context.state_markdown(second)),
        )

    def test_source_build_and_served_hashes_are_independent_freshness_claims(self) -> None:
        baseline = repo_context.normalized_state(repo_context.state_markdown(context()))

        source_changed = context()
        source_changed["git"]["working_tree_sha256"] = "z" * 64
        self.assertNotEqual(
            baseline,
            repo_context.normalized_state(repo_context.state_markdown(source_changed)),
        )

        build_changed = context()
        build_changed["builds"]["producer_ui"]["output_sha256"] = "y" * 64
        build_changed["builds"]["producer_ui"]["receipt"]["outputs"]["sha256"] = "y" * 64
        self.assertNotEqual(
            baseline,
            repo_context.normalized_state(repo_context.state_markdown(build_changed)),
        )

        served_changed = context()
        served_changed["builds"]["producer_ui_served"]["served_output_sha256"] = "v" * 64
        self.assertNotEqual(
            baseline,
            repo_context.normalized_state(repo_context.state_markdown(served_changed)),
        )

    def test_state_includes_minimal_build_receipt_contract(self) -> None:
        rendered = repo_context.state_markdown(context())
        self.assertIn("## Source bytes", rendered)
        self.assertIn("Git-exposed index-flags SHA-256", rendered)
        self.assertIn("## Generated build bytes", rendered)
        self.assertIn("## Actually served bytes", rendered)
        self.assertIn("task input SHA-256", rendered)
        self.assertIn("lock SHA-256", rendered)
        self.assertIn("builder: identity=", rendered)
        self.assertIn("node=", rendered)
        self.assertIn("build environment", rendered)
        self.assertIn("generated outputs", rendered)
        self.assertIn("Producer UI served output SHA-256", rendered)


if __name__ == "__main__":
    unittest.main()
