"""B1 doctor: one honest diagnostic pass with a concrete fix per failure."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from .helpers import REPO_ROOT  # noqa: F401 - installs runtime on sys.path

from v3_api import V3Application


EXPECTED_CHECK_IDS = {
    "owner",
    "database",
    "receipts",
    "disk",
    "binary:ffmpeg",
    "binary:ffprobe",
    "binary:node",
    "binary:pnpm",
    "render-browser",
    "render-worker-deps",
    "cliproxy",
    "agent",
    "backup",
}


class DoctorTests(unittest.TestCase):
    def test_doctor_reports_every_check_with_fixes_on_failures(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            app = V3Application(
                REPO_ROOT,
                state_root=Path(td) / "v3",
                max_generation_workers=1,
            )
            try:
                report = app.doctor()
            finally:
                app.shutdown(drain_timeout=2)
        self.assertIn("ok", report)
        self.assertIn("checked_at", report)
        check_ids = {entry["id"] for entry in report["checks"]}
        self.assertTrue(
            EXPECTED_CHECK_IDS.issubset(check_ids),
            EXPECTED_CHECK_IDS - check_ids,
        )
        for entry in report["checks"]:
            self.assertIn("ok", entry)
            self.assertIn("detail", entry)
            if not entry["ok"] and entry["id"] not in {"receipts"}:
                self.assertTrue(
                    entry.get("fix"),
                    f"failing check {entry['id']} must name its fix",
                )
        by_id = {entry["id"]: entry for entry in report["checks"]}
        # Deterministic verdicts on a fresh state root:
        self.assertTrue(by_id["owner"]["ok"])
        self.assertTrue(by_id["database"]["ok"])
        self.assertFalse(by_id["cliproxy"]["ok"], "unconfigured must fail")
        self.assertFalse(by_id["backup"]["ok"], "no backup must fail")
        self.assertFalse(by_id["agent"]["ok"], "no applied profile must fail")
        # The aggregate verdict is the conjunction, so it must be False here.
        self.assertFalse(report["ok"])


if __name__ == "__main__":
    unittest.main()
