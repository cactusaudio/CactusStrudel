"""Durable native-Responses Brain job service."""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from dataclasses import dataclass
from hashlib import sha256
import json
import threading
import time
from typing import Any, Mapping

from .cliproxy import (
    CLIProxyClient,
    response_id,
    response_output_text,
    response_tool_calls,
)
from .errors import (
    CancelledAfterCommit,
    JobCancelled,
    JobError,
    ToolExecutionError,
    UltraUnavailable,
)
from .job_store import BrainJobStore, TERMINAL_STATUSES
from .models import AgentProfile, canonical_json
from .settings import AgentSettingsService
from .tools import ToolExecutionContext, ToolRegistry
from .ultra import BoundedUltraCoordinator


@dataclass(frozen=True, slots=True)
class LoopResult:
    output_text: str
    response_id: str
    response_count: int
    tool_call_count: int


class _ToolExecutor:
    def __init__(
        self,
        *,
        store: BrainJobStore,
        registry: ToolRegistry,
        job_id: str,
        cancel_event: threading.Event,
    ):
        self.store = store
        self.registry = registry
        self.job_id = job_id
        self.cancel_event = cancel_event

    def execute(self, call: Mapping[str, Any]) -> Any:
        if self.cancel_event.is_set():
            raise JobCancelled("cancelled before tool call")
        name = str(call["name"])
        call_id = str(call["call_id"])
        arguments = dict(call["arguments"])
        spec = self.registry.get(name)
        cached, cached_result = self.store.begin_tool_call(
            job_id=self.job_id,
            call_id=call_id,
            tool_name=name,
            arguments=arguments,
            mutating=spec.mutating,
        )
        if cached:
            return cached_result
        if self.cancel_event.is_set():
            self.store.fail_tool_call(
                job_id=self.job_id,
                call_id=call_id,
                error="cancelled before tool execution",
            )
            raise JobCancelled("cancelled before tool execution")
        context = ToolExecutionContext(
            job_id=self.job_id,
            call_id=call_id,
            cancel_event=self.cancel_event,
        )
        try:
            result = spec.handler(arguments, context)
            # Reject opaque/non-JSON tool results before recording them.
            canonical_json(result)
            self.store.complete_tool_call(
                job_id=self.job_id,
                call_id=call_id,
                result=result,
                committed=spec.mutating,
            )
        except (CancelledAfterCommit, JobCancelled) as exc:
            self.store.fail_tool_call(
                job_id=self.job_id,
                call_id=call_id,
                error=(str(exc) or type(exc).__name__)[:1000],
            )
            raise
        except Exception as exc:
            self.store.fail_tool_call(
                job_id=self.job_id,
                call_id=call_id,
                error=(str(exc) or type(exc).__name__)[:1000],
            )
            raise ToolExecutionError(
                f"tool {name} failed: {str(exc) or type(exc).__name__}"
            ) from exc
        if self.cancel_event.is_set():
            if spec.mutating:
                raise CancelledAfterCommit(
                    f"cancelled after mutating tool committed: {name}"
                )
            raise JobCancelled(f"cancelled after read-only tool: {name}")
        return result


class ResponsesToolLoop:
    def __init__(self, *, max_tool_rounds: int = 12):
        if max_tool_rounds < 1:
            raise ValueError("max_tool_rounds must be positive")
        self.max_tool_rounds = max_tool_rounds

    def run(
        self,
        *,
        client: CLIProxyClient,
        profile: AgentProfile,
        input_text: str,
        job_id: str,
        cancel_event: threading.Event,
        registry: ToolRegistry,
        store: BrainJobStore,
        ultra: BoundedUltraCoordinator | None,
    ) -> LoopResult:
        lead_input = input_text
        if profile.orchestration == "ultra":
            if ultra is None:
                raise UltraUnavailable(
                    "Ultra selected but no bounded coordinator is wired"
                )
            preparation = ultra.prepare(
                client=client,
                profile=profile,
                input_text=input_text,
                job_id=job_id,
                cancel_event=cancel_event,
            )
            lead_input = preparation.lead_input
            for receipt in preparation.receipts:
                store.append_receipt(job_id, "ultra_scout", receipt)

        executor = _ToolExecutor(
            store=store,
            registry=registry,
            job_id=job_id,
            cancel_event=cancel_event,
        )
        previous_id: str | None = None
        next_input: str | list[dict[str, Any]] = lead_input
        response_count = 0
        tool_call_count = 0
        for round_index in range(self.max_tool_rounds + 1):
            if cancel_event.is_set():
                raise JobCancelled("cancelled before model request")
            request_started = time.monotonic()
            response = client.create_response(
                model_id=profile.model_id or "",
                input_value=next_input,
                reasoning_effort=profile.wire_reasoning_effort,
                tools=registry.schemas() or None,
                previous_response_id=previous_id,
                job_id=job_id,
                cancel_event=cancel_event,
                metadata={
                    "cactus_job_id": job_id,
                    "orchestration": profile.orchestration,
                    "role": "lead",
                },
            )
            response_count += 1
            current_id = response_id(response)
            calls = response_tool_calls(response)
            output = response_output_text(response)
            store.append_receipt(
                job_id,
                "model_response",
                {
                    "round": round_index,
                    "response_id": current_id,
                    "request_model_id": profile.model_id,
                    "reasoning_effort": profile.reasoning_effort,
                    "wire_reasoning_effort": profile.wire_reasoning_effort,
                    "orchestration": profile.orchestration,
                    "tool_call_ids": [call["call_id"] for call in calls],
                    "output_sha256": sha256(output.encode("utf-8")).hexdigest()
                    if output
                    else None,
                    "output_chars": len(output),
                    "latency_ms": max(
                        0, round((time.monotonic() - request_started) * 1000)
                    ),
                },
            )
            if cancel_event.is_set():
                raise JobCancelled("cancelled after model response")
            if not calls:
                if not output:
                    raise JobError(
                        "Responses lead returned neither output text nor tool calls"
                    )
                return LoopResult(
                    output_text=output,
                    response_id=current_id,
                    response_count=response_count,
                    tool_call_count=tool_call_count,
                )
            if round_index >= self.max_tool_rounds:
                raise JobError(
                    f"Responses tool loop exceeded {self.max_tool_rounds} rounds"
                )
            function_outputs: list[dict[str, Any]] = []
            seen_call_ids: set[str] = set()
            for call in calls:
                result = executor.execute(call)
                if call["call_id"] in seen_call_ids:
                    continue
                seen_call_ids.add(call["call_id"])
                tool_call_count += 1
                function_outputs.append(
                    {
                        "type": "function_call_output",
                        "call_id": call["call_id"],
                        "output": canonical_json(result),
                    }
                )
            previous_id = current_id
            next_input = function_outputs
        raise JobError("Responses tool loop ended unexpectedly")


class BrainRunnerService:
    """Threaded observer/service boundary around durable Brain jobs."""

    def __init__(
        self,
        *,
        store: BrainJobStore,
        settings: AgentSettingsService,
        toolsets: Mapping[str, ToolRegistry],
        ultra: BoundedUltraCoordinator | None = None,
        max_workers: int = 2,
        max_tool_rounds: int = 12,
    ):
        if max_workers < 1 or max_workers > 8:
            raise ValueError("Brain runner max_workers must be 1..8")
        self.store = store
        self.settings = settings
        self.toolsets = dict(toolsets)
        self.ultra = ultra
        self.loop = ResponsesToolLoop(max_tool_rounds=max_tool_rounds)
        self._pool = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="cactus-brain-v3",
        )
        self._lock = threading.RLock()
        self._futures: dict[str, Future[dict[str, Any]]] = {}
        self._cancel_events: dict[str, threading.Event] = {}
        self._clients: dict[str, CLIProxyClient] = {}

    @property
    def ultra_client_models(self) -> frozenset[str]:
        if self.ultra is None:
            return frozenset()
        return self.ultra.supported_models

    def submit(
        self,
        input_text: str,
        *,
        config_revision_id: str | None = None,
        toolset_id: str = "music",
        metadata: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        start: bool = True,
    ) -> dict[str, Any]:
        text = str(input_text or "").strip()
        if not text:
            raise JobError("Brain input cannot be empty")
        if toolset_id not in self.toolsets:
            raise JobError(f"unknown Brain toolset: {toolset_id}")
        if config_revision_id is None:
            _profile, revision = self.settings.load_active()
            config_revision_id = str(revision["revision_id"])
        else:
            self.settings.load_revision(config_revision_id)
        job = self.store.create_job(
            config_revision_id=config_revision_id,
            input_text=text,
            toolset_id=toolset_id,
            metadata=metadata,
            idempotency_key=idempotency_key,
        )
        if start:
            self.start(job["job_id"])
        return job

    def start(self, job_id: str) -> Future[dict[str, Any]]:
        with self._lock:
            existing = self._futures.get(job_id)
            if existing and not existing.done():
                return existing
            job = self.store.get_job(job_id)
            if job["status"] in TERMINAL_STATUSES:
                future: Future[dict[str, Any]] = Future()
                future.set_result(job)
                return future
            if job["status"] == "cancel_requested":
                cancelled = self.store.finish(
                    job_id,
                    status="cancelled",
                    error="cancel request restored before runner start",
                )
                future = Future()
                future.set_result(cancelled)
                return future
            event = threading.Event()
            if job["status"] == "cancel_requested":
                event.set()
            self._cancel_events[job_id] = event
            future = self._pool.submit(self.run_job, job_id)
            self._futures[job_id] = future
            return future

    def run_job(self, job_id: str) -> dict[str, Any]:
        event = self._event_for(job_id)
        if event.is_set() or not self.store.mark_running(job_id):
            return self.store.get_job(job_id)
        job = self.store.get_job(job_id)
        try:
            client, profile, revision = self.settings.client_for_revision(
                job["config_revision_id"]
            )
            registry = self.toolsets[job["toolset_id"]]
            if profile.orchestration == "ultra":
                if self.ultra is None or profile.model_id not in self.ultra.supported_models:
                    raise UltraUnavailable(
                        "active revision selects Ultra without a matching coordinator"
                    )
            with self._lock:
                self._clients[job_id] = client
            result = self.loop.run(
                client=client,
                profile=profile,
                input_text=str(job["input"]["text"]),
                job_id=job_id,
                cancel_event=event,
                registry=registry,
                store=self.store,
                ultra=self.ultra,
            )
            if event.is_set() or self.store.cancellation_requested(job_id):
                committed = self.store.has_committed_mutation(job_id)
                raise (
                    CancelledAfterCommit("cancelled after mutation committed")
                    if committed
                    else JobCancelled("cancelled before completion")
                )
            final = {
                "output_text": result.output_text,
                "response_id": result.response_id,
                "response_count": result.response_count,
                "tool_call_count": result.tool_call_count,
                "config_revision_id": revision["revision_id"],
                "model_id": profile.model_id,
                "reasoning_effort": profile.reasoning_effort,
                "wire_reasoning_effort": profile.wire_reasoning_effort,
                "orchestration": profile.orchestration,
            }
            self.store.append_receipt(
                job_id,
                "final",
                {
                    key: value
                    for key, value in final.items()
                    if key != "output_text"
                }
                | {
                    "output_sha256": sha256(
                        result.output_text.encode("utf-8")
                    ).hexdigest(),
                    "output_chars": len(result.output_text),
                },
            )
            return self.store.finish(job_id, status="completed", result=final)
        except CancelledAfterCommit as exc:
            return self.store.finish(
                job_id,
                status="cancelled_after_commit",
                error=str(exc),
            )
        except JobCancelled as exc:
            committed = self.store.has_committed_mutation(job_id)
            return self.store.finish(
                job_id,
                status="cancelled_after_commit" if committed else "cancelled",
                error=str(exc),
            )
        except Exception as exc:
            return self.store.finish(
                job_id,
                status="failed",
                error=(str(exc) or type(exc).__name__)[:1200],
            )
        finally:
            with self._lock:
                self._clients.pop(job_id, None)
                self._cancel_events.pop(job_id, None)

    def cancel(self, job_id: str) -> dict[str, Any]:
        job = self.store.request_cancel(job_id)
        with self._lock:
            event = self._cancel_events.get(job_id)
            client = self._clients.get(job_id)
        if event is not None:
            event.set()
        if client is not None:
            client.cancel(job_id)
        return self.store.get_job(job_id)

    def recover(self) -> dict[str, list[str]]:
        recovered = self.store.recover_interrupted()
        for job_id in recovered["queued"]:
            self.start(job_id)
        return recovered

    def wait(self, job_id: str, timeout: float | None = None) -> dict[str, Any]:
        with self._lock:
            future = self._futures.get(job_id)
        if future is not None:
            future.result(timeout=timeout)
        return self.store.get_job(job_id)

    def drain(self, timeout: float) -> bool:
        """Bounded wait for outstanding job futures; True when all settled."""

        deadline = time.monotonic() + max(0.0, timeout)
        with self._lock:
            futures = list(self._futures.values())
        settled = True
        for future in futures:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                if not future.done():
                    settled = False
                continue
            try:
                future.result(timeout=remaining)
            except FuturesTimeoutError:
                settled = False
            except Exception:
                # Job outcomes are recorded durably by run_job; drain only
                # cares whether the worker finished before the deadline.
                pass
        return settled

    def close(self, *, wait: bool = True) -> None:
        self._pool.shutdown(wait=wait, cancel_futures=False)

    def _event_for(self, job_id: str) -> threading.Event:
        with self._lock:
            return self._cancel_events.setdefault(job_id, threading.Event())
