#!/usr/bin/env python3
"""Check the bounded current-document and active-workspace contracts."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]

REQUIRED = (
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "docs/README.md",
    "docs/architecture.md",
    "docs/development.md",
    "docs/operations.md",
    "docs/API.md",
    "docs/SETTINGS.md",
    "docs/LIVE_VS_RESEARCH.md",
    "docs/renderer.md",
    "docs/STATE.md",
    "docs/HANDOFF.md",
    "docs/areas.json",
    "apps/README.md",
    "apps/producer-ui/README.md",
    "apps/render-worker/README.md",
    "packages/README.md",
    "runtime/README.md",
    "runtime/v3/README.md",
    "runtime/agent/README.md",
    "producer-brain/README.md",
    "bin/README.md",
    "archive/README.md",
    "archive/research-v1/README.md",
    "archive/local/README.md",
    "handoffs/README.md",
)

LINE_BUDGETS = {
    "AGENTS.md": 180,
    "CLAUDE.md": 20,
    "README.md": 90,
}

ACTIVE_APP_DIRS = {"producer-ui", "render-worker", "renderer-page"}
ACTIVE_PACKAGE_DIRS = {"analyzer", "renderer", "strudel-validator"}

STALE_ACTIVE_REFERENCES = {
    "apps/cli": "old CLI is archived; live render entrypoints use apps/render-worker",
    "apps/studio-ui": "Studio Inspector is archived",
    "refs/strudel-monorepo": "live renderer uses pinned npm Strudel packages",
    "/api/recent": "v2 endpoint is closed",
    "/api/cc/": "v2 bridge endpoint is closed",
    "/runtime/main.html": "v2 GUI is frozen under /legacy",
}

MARKDOWN_LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def active_markdown_files() -> list[Path]:
    paths: list[Path] = []
    for path in ROOT.rglob("*.md"):
        rel = relative(path)
        if rel.startswith(
            (
                "archive/",
                "node_modules/",
                "handoffs/HANDOFF.latest.md",
            )
        ):
            continue
        if "/node_modules/" in f"/{rel}":
            continue
        paths.append(path)
    return sorted(paths)


def visible_children(root: Path) -> set[str]:
    return {
        child.name
        for child in root.iterdir()
        if child.is_dir() and not child.name.startswith(".")
    }


def check_required(errors: list[str]) -> None:
    for value in REQUIRED:
        if not (ROOT / value).exists():
            errors.append(f"missing required path: {value}")


def check_entry_contract(errors: list[str]) -> None:
    if (ROOT / "AGENT.md").exists():
        errors.append("AGENT.md must not shadow the sole AGENTS.md authority")
    if (ROOT / ".claude").exists():
        errors.append(".claude must remain archived, not auto-discovered")
    for rel, maximum in LINE_BUDGETS.items():
        path = ROOT / rel
        if not path.is_file():
            continue
        lines = len(path.read_text(encoding="utf-8").splitlines())
        if lines > maximum:
            errors.append(f"{rel} has {lines} lines; budget is {maximum}")


def check_workspace(errors: list[str]) -> None:
    apps = visible_children(ROOT / "apps")
    packages = visible_children(ROOT / "packages")
    if apps != ACTIVE_APP_DIRS:
        errors.append(
            "active apps mismatch: "
            f"expected {sorted(ACTIVE_APP_DIRS)}, observed {sorted(apps)}"
        )
    if packages != ACTIVE_PACKAGE_DIRS:
        errors.append(
            "active packages mismatch: "
            f"expected {sorted(ACTIVE_PACKAGE_DIRS)}, observed {sorted(packages)}"
        )


def check_areas(errors: list[str]) -> None:
    path = ROOT / "docs" / "areas.json"
    if not path.is_file():
        return
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"docs/areas.json is invalid JSON: {exc}")
        return
    areas = loaded.get("areas")
    if loaded.get("schema_version") != 1 or not isinstance(areas, list):
        errors.append("docs/areas.json must have schema_version 1 and an areas list")
        return
    identifiers: set[str] = set()
    for index, area in enumerate(areas):
        if not isinstance(area, dict):
            errors.append(f"areas[{index}] is not an object")
            continue
        identifier = area.get("id")
        if not isinstance(identifier, str) or not identifier:
            errors.append(f"areas[{index}] has no valid id")
            continue
        if identifier in identifiers:
            errors.append(f"duplicate area id: {identifier}")
        identifiers.add(identifier)
        for field in ("read_first", "entrypoints", "tests"):
            values = area.get(field)
            if not isinstance(values, list) or not values:
                errors.append(f"area {identifier} has no {field}")
                continue
            for value in values:
                if not isinstance(value, str) or not (ROOT / value).exists():
                    errors.append(f"area {identifier} has missing {field} path: {value}")
        if area.get("full_scan_required") is not False:
            errors.append(f"area {identifier} must default full_scan_required to false")


def check_markdown_links(errors: list[str], paths: list[Path]) -> None:
    for path in paths:
        text = path.read_text(encoding="utf-8")
        for match in MARKDOWN_LINK.finditer(text):
            target = match.group(1).strip()
            if not target or target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            target = target.split("#", 1)[0].strip()
            if target.startswith("<") and target.endswith(">"):
                target = target[1:-1]
            resolved = (path.parent / target).resolve()
            try:
                resolved.relative_to(ROOT.resolve())
            except ValueError:
                errors.append(f"{relative(path)} links outside repo: {target}")
                continue
            if not resolved.exists():
                errors.append(f"{relative(path)} has broken link: {target}")


def check_docs_index(errors: list[str]) -> None:
    index = ROOT / "docs" / "README.md"
    if not index.is_file():
        return
    text = index.read_text(encoding="utf-8")
    for path in sorted((ROOT / "docs").glob("*.md")):
        if path.name == "README.md":
            continue
        if f"({path.name})" not in text:
            errors.append(f"docs/README.md does not route {path.name}")


def check_generated_state(errors: list[str]) -> None:
    path = ROOT / "docs" / "STATE.md"
    if not path.is_file():
        return
    text = path.read_text(encoding="utf-8")
    if not text.startswith("# Current generated state"):
        errors.append("docs/STATE.md has the wrong generated-state heading")
    if "GENERATED by `bin/state-refresh`" not in text:
        errors.append("docs/STATE.md has no generator marker")


def check_stale_references(errors: list[str], paths: list[Path]) -> None:
    for path in paths:
        text = path.read_text(encoding="utf-8")
        for needle, explanation in STALE_ACTIVE_REFERENCES.items():
            if needle in text:
                errors.append(
                    f"{relative(path)} contains stale active reference {needle!r}: "
                    f"{explanation}"
                )


def check_archive_hygiene(errors: list[str]) -> None:
    archive = ROOT / "archive" / "research-v1"
    if not archive.is_dir():
        return
    banned_dirs = {"node_modules", "dist", "__pycache__", ".pytest_cache", ".ruff_cache"}
    for current, dirs, files in os.walk(archive):
        current_path = Path(current)
        for dirname in list(dirs):
            if dirname in banned_dirs:
                errors.append(
                    "generated directory remains in source archive: "
                    f"{relative(current_path / dirname)}"
                )
                dirs.remove(dirname)
        for filename in files:
            if filename.endswith(".tsbuildinfo"):
                errors.append(
                    "generated file remains in source archive: "
                    f"{relative(current_path / filename)}"
                )


def main() -> int:
    errors: list[str] = []
    check_required(errors)
    check_entry_contract(errors)
    check_workspace(errors)
    check_areas(errors)
    markdown = active_markdown_files()
    check_markdown_links(errors, markdown)
    check_docs_index(errors)
    check_generated_state(errors)
    check_stale_references(errors, markdown)
    check_archive_hygiene(errors)
    if errors:
        print("documentation/topology contract failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(
        "docs/topology ✓ "
        f"{len(REQUIRED)} required paths, {len(markdown)} current markdown files, "
        f"{len(ACTIVE_APP_DIRS)} apps, {len(ACTIVE_PACKAGE_DIRS)} packages"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
