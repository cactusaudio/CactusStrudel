from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from runtime.v3 import LegacyImportError, LegacyImporter, LegacyReconcilePlanner


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


class LegacyReconcilePlannerTest(unittest.TestCase):
    def test_plan_classifies_duplicate_drift_partial_and_recovery_without_writes(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pieces = root / "producer-brain" / "pieces"
            audio = root / "producer-brain" / "audio"
            prompts = root / "producer-brain" / "prompts"
            pieces.mkdir(parents=True)
            audio.mkdir(parents=True)
            prompts.mkdir(parents=True)
            shared_js = pieces / "shared.js"
            shared_mp3 = audio / "shared.mp3"
            shared_prompt = prompts / "shared.txt"
            shared_prompt_json = prompts / "shared.json"
            shared_js.write_text('s("bd")', encoding="utf-8")
            shared_mp3.write_bytes(b"ID3-shared")
            shared_prompt.write_text("exact prompt\n第二行", encoding="utf-8")
            shared_prompt_json.write_text(
                '{\n  "compiled_prompt": "exact",\n  "mode": "legacy"\n}\n',
                encoding="utf-8",
            )
            recovery_js = pieces / "recovery.js"
            recovery_mp3 = audio / "recovery.mp3"
            recovery_js.write_text('s("sd")', encoding="utf-8")
            recovery_mp3.write_bytes(b"ID3-recovery")

            corpus = root / "producer-brain" / "corpus.jsonl"
            revisions = root / "producer-brain" / "revisions.jsonl"
            tasks = (
                root
                / "archive"
                / "runtime-v2"
                / "data"
                / "cc-bridge"
                / "tasks.jsonl"
            )
            write_jsonl(
                corpus,
                [
                    {
                        "name": "UN-003",
                        "js": "producer-brain/pieces/shared.js",
                        "mp3": "producer-brain/audio/shared.mp3",
                        "prompt": "producer-brain/prompts/shared.txt",
                        "prompt_json": "producer-brain/prompts/shared.json",
                        "sha": "deadbeef",
                        "source": "agy-cli",
                        "score_bowei": 7.2,
                        "note_bowei": "human note",
                        "note_ts": "2026-05-29 00:00:00",
                    },
                    {
                        "name": "UN-004",
                        "js": "producer-brain/pieces/shared.js",
                        "mp3": "producer-brain/audio/shared.mp3",
                        "prompt": "producer-brain/prompts/shared.txt",
                        "prompt_json": "producer-brain/prompts/shared.json",
                        "sha": "deadbeef",
                        "source": "agy-cli",
                    },
                ],
            )
            write_jsonl(
                revisions,
                [
                    {
                        "id": "rev-1",
                        "piece": "UN-003",
                        "code": {"delta_chars": 12},
                        "from_sha": "same",
                        "to_sha": "same",
                        "from_dur": "1.0",
                        "to_dur": "1.0",
                        "score_before": 6,
                        "score_after": 7,
                        "score_delta": None,
                    }
                ],
            )
            write_jsonl(
                tasks,
                [
                    {
                        "id": "task-recovery",
                        "status": "done",
                        "result": {
                            "js": "producer-brain/pieces/recovery.js",
                            "mp3": "producer-brain/audio/recovery.mp3",
                        },
                    }
                ],
            )
            before = {path: path.read_bytes() for path in (corpus, revisions, tasks)}
            plan = LegacyReconcilePlanner(repo_root=root).build_plan()
            after = {path: path.read_bytes() for path in (corpus, revisions, tasks)}

            self.assertEqual(before, after)
            self.assertEqual(plan["mode"], "dry-run")
            self.assertEqual(len(plan["duplicate_groups"]), 1)
            self.assertEqual(
                plan["duplicate_groups"][0]["members"], ["UN-003", "UN-004"]
            )
            by_name = {entry["legacy_name"]: entry for entry in plan["corpus_entries"]}
            self.assertIn("hash_drift", by_name["UN-003"]["classifications"])
            self.assertIn("legacy_partial", by_name["UN-003"]["classifications"])
            self.assertIn("legacy_unknown", by_name["UN-003"]["classifications"])
            self.assertIn("duplicate_evidence", by_name["UN-004"]["classifications"])
            self.assertEqual(
                plan["revision_entries"][0]["classifications"],
                ["legacy_partial"],
            )
            self.assertEqual(len(plan["recovery_candidates"]), 1)
            self.assertTrue(plan["recovery_candidates"][0]["human_decision_required"])

            target_db = root / "target" / "runtime.sqlite3"
            target_assets = root / "target" / "assets"
            source_before_apply = {
                path: path.read_bytes()
                for path in (
                    corpus,
                    revisions,
                    tasks,
                    shared_js,
                    shared_mp3,
                    shared_prompt,
                    shared_prompt_json,
                    recovery_js,
                    recovery_mp3,
                )
            }
            importer = LegacyImporter(
                repo_root=root,
                db_path=target_db,
                assets_root=target_assets,
                duration_probe=lambda _: 4.25,
            )
            applied = importer.apply(plan)
            self.assertEqual(applied["pieces_imported"], 2)
            self.assertEqual(applied["pieces_existing"], 0)
            self.assertEqual(applied["ratings_imported"], 1)
            self.assertEqual(applied["recovery_candidates_excluded"], 1)
            self.assertEqual(
                applied["receipt_reconciliation"],
                {
                    "matched": 2,
                    "orphan_promoted": 0,
                    "invalid": 0,
                    "registered_receipt_identity_mismatch": 0,
                    "registered_without_valid_receipt": 0,
                },
            )
            self.assertEqual(
                source_before_apply,
                {path: path.read_bytes() for path in source_before_apply},
            )

            import sqlite3

            connection = sqlite3.connect(target_db)
            connection.row_factory = sqlite3.Row
            self.assertEqual(
                connection.execute("SELECT COUNT(*) AS n FROM pieces").fetchone()["n"],
                2,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) AS n FROM piece_versions"
                ).fetchone()["n"],
                2,
            )
            self.assertEqual(
                connection.execute("SELECT COUNT(*) AS n FROM ratings").fetchone()["n"],
                1,
            )
            rows = connection.execute(
                "SELECT state, provenance_json, asset_dir "
                "FROM piece_versions ORDER BY id"
            ).fetchall()
            provenances = [json.loads(row["provenance_json"]) for row in rows]
            self.assertTrue(all(row["state"] == "legacy_partial" for row in rows))
            self.assertTrue(
                any(
                    item["legacy"].get("duplicate_of") == "UN-003"
                    for item in provenances
                )
            )
            rating = connection.execute(
                "SELECT score, note, source_key FROM ratings"
            ).fetchone()
            self.assertEqual((rating["score"], rating["note"]), (7.2, "human note"))
            self.assertTrue(rating["source_key"].endswith(":rating"))
            prompt_receipt = json.loads(
                (root / rows[0]["asset_dir"] / "prompt.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(prompt_receipt["prompt_text"], "exact prompt\n第二行")
            self.assertEqual(
                prompt_receipt["prompt_json_text"],
                shared_prompt_json.read_text(encoding="utf-8"),
            )
            self.assertEqual(prompt_receipt["prompt_json"]["mode"], "legacy")
            connection.close()

            # Recovery candidate bytes were never copied into the live target.
            target_hashes = {
                path.read_bytes() for path in target_assets.glob("*/*/audio.mp3")
            }
            self.assertNotIn(recovery_mp3.read_bytes(), target_hashes)

            repeated = importer.apply(plan)
            self.assertEqual(repeated["pieces_imported"], 0)
            self.assertEqual(repeated["pieces_existing"], 2)
            self.assertEqual(repeated["ratings_imported"], 0)
            self.assertEqual(repeated["ratings_existing"], 1)

    def test_legacy_ids_are_deterministic_across_dry_runs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "producer-brain" / "pieces").mkdir(parents=True)
            (root / "producer-brain" / "audio").mkdir(parents=True)
            (root / "producer-brain" / "pieces" / "p.js").write_text(
                's("bd")', encoding="utf-8"
            )
            (root / "producer-brain" / "audio" / "p.mp3").write_bytes(b"ID3")
            write_jsonl(
                root / "producer-brain" / "corpus.jsonl",
                [
                    {
                        "name": "P-001",
                        "js": "producer-brain/pieces/p.js",
                        "mp3": "producer-brain/audio/p.mp3",
                    }
                ],
            )
            first = LegacyReconcilePlanner(repo_root=root).build_plan()
            second = LegacyReconcilePlanner(repo_root=root).build_plan()
            self.assertEqual(
                first["corpus_entries"][0]["proposed_piece_id"],
                second["corpus_entries"][0]["proposed_piece_id"],
            )
            self.assertEqual(
                first["corpus_entries"][0]["proposed_version_id"],
                second["corpus_entries"][0]["proposed_version_id"],
            )

    def test_importer_rejects_a_stale_plan_before_opening_target_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pieces = root / "producer-brain" / "pieces"
            audio = root / "producer-brain" / "audio"
            pieces.mkdir(parents=True)
            audio.mkdir(parents=True)
            (pieces / "p.js").write_text('s("bd")', encoding="utf-8")
            (audio / "p.mp3").write_bytes(b"ID3")
            corpus = root / "producer-brain" / "corpus.jsonl"
            write_jsonl(
                corpus,
                [
                    {
                        "name": "P-001",
                        "js": "producer-brain/pieces/p.js",
                        "mp3": "producer-brain/audio/p.mp3",
                    }
                ],
            )
            plan = LegacyReconcilePlanner(repo_root=root).build_plan()
            corpus.write_text(corpus.read_text() + "\n", encoding="utf-8")
            target_db = root / "target" / "runtime.sqlite3"
            importer = LegacyImporter(
                repo_root=root,
                db_path=target_db,
                assets_root=root / "target" / "assets",
                duration_probe=lambda _: 1.0,
            )
            with self.assertRaisesRegex(
                LegacyImportError, "source snapshot changed after dry-run"
            ):
                importer.apply(plan)
            self.assertFalse(target_db.exists())


if __name__ == "__main__":
    unittest.main()
