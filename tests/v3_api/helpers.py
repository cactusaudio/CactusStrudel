from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import sys
import threading
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_ROOT = REPO_ROOT / "runtime"
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))


class StaticGenerationConfig:
    def __init__(self, value: dict[str, Any]):
        self.value = deepcopy(value)

    def read(self) -> dict[str, Any]:
        return deepcopy(self.value)


class CapturedThread:
    """Thread stand-in: records scheduling without running background work."""

    created: list["CapturedThread"] = []

    def __init__(self, *, target, args=(), kwargs=None, **_ignored):
        self.target = target
        self.args = args
        self.kwargs = dict(kwargs or {})
        self.started = False
        self.finished = False
        type(self).created.append(self)

    def start(self) -> None:
        self.started = True

    def run_now(self) -> Any:
        try:
            return self.target(*self.args, **self.kwargs)
        finally:
            self.finished = True

    def is_alive(self) -> bool:
        return self.started and not self.finished

    @classmethod
    def reset(cls) -> None:
        cls.created.clear()


class FakeGenerationTruth:
    def __init__(self):
        self.cancelled: list[str] = []
        self.jobs: dict[str, dict[str, Any]] = {}

    def request_cancel(self, child_id: str) -> dict[str, Any]:
        self.cancelled.append(child_id)
        job = self.jobs.setdefault(
            child_id,
            {"id": child_id, "status": "cancel_requested", "result_version_id": None},
        )
        job["status"] = "cancel_requested"
        return dict(job)

    def get_job(self, child_id: str) -> dict[str, Any]:
        return dict(
            self.jobs.get(
                child_id,
                {"id": child_id, "status": "running", "result_version_id": None},
            )
        )


class FakeCancelableClient:
    def __init__(self):
        self.cancelled: list[str] = []

    def cancel(self, job_id: str) -> None:
        self.cancelled.append(job_id)


class FakeEvent:
    def __init__(self):
        self._event = threading.Event()

    def set(self) -> None:
        self._event.set()

    def is_set(self) -> bool:
        return self._event.is_set()
