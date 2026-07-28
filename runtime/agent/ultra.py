"""Bounded read-only scout orchestration for supported Ultra profiles."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from hashlib import sha256
import threading
import time
from typing import Any

from .cliproxy import CLIProxyClient, response_id, response_output_text
from .errors import JobCancelled, UltraUnavailable
from .models import AgentProfile


@dataclass(frozen=True, slots=True)
class UltraPreparation:
    lead_input: str
    receipts: tuple[dict[str, Any], ...]


class BoundedUltraCoordinator:
    """One or two tool-free scouts; the lead alone receives mutation tools."""

    def __init__(
        self,
        *,
        supported_models: tuple[str, ...] = (
            "gpt-5.6-sol",
            "gpt-5.6-terra",
        ),
        scout_count: int = 2,
    ):
        if scout_count not in (1, 2):
            raise ValueError("Ultra scout_count must be 1 or 2")
        self.supported_models = frozenset(supported_models)
        self.scout_count = scout_count

    def prepare(
        self,
        *,
        client: CLIProxyClient,
        profile: AgentProfile,
        input_text: str,
        job_id: str,
        cancel_event: threading.Event,
    ) -> UltraPreparation:
        if profile.model_id not in self.supported_models:
            raise UltraUnavailable(
                f"Ultra coordinator does not support {profile.model_id}"
            )
        if profile.wire_reasoning_effort != "max":
            raise UltraUnavailable("Ultra upstream reasoning must resolve to max")
        if cancel_event.is_set():
            raise JobCancelled("Ultra cancelled before scouts")

        prompts = [
            (
                "Act as a read-only scout. Analyze the request independently. "
                "Return concise observations, risks, and a recommended approach. "
                "Do not claim to have changed files or external state.\n\n"
                f"REQUEST:\n{input_text}"
            ),
            (
                "Act as a second read-only scout. Look for missed constraints, "
                "better sequencing, and the smallest evidence needed. "
                "Do not perform or claim mutations.\n\n"
                f"REQUEST:\n{input_text}"
            ),
        ][: self.scout_count]

        def run_one(
            index: int, prompt: str
        ) -> tuple[int, dict[str, Any], str, int]:
            started = time.monotonic()
            response = client.create_response(
                model_id=profile.model_id or "",
                input_value=prompt,
                reasoning_effort="max",
                tools=None,
                job_id=job_id,
                cancel_event=cancel_event,
                metadata={
                    "orchestration": "ultra",
                    "role": f"read-only-scout-{index + 1}",
                },
            )
            text = response_output_text(response)
            if not text:
                raise UltraUnavailable(
                    f"Ultra scout {index + 1} returned no output"
                )
            latency_ms = max(
                0, round((time.monotonic() - started) * 1000)
            )
            return index, response, text, latency_ms

        results: list[tuple[int, dict[str, Any], str, int]] = []
        with ThreadPoolExecutor(
            max_workers=self.scout_count,
            thread_name_prefix="cactus-ultra-scout",
        ) as executor:
            futures = {
                executor.submit(run_one, index, prompt): index
                for index, prompt in enumerate(prompts)
            }
            try:
                for future in as_completed(futures):
                    if cancel_event.is_set():
                        raise JobCancelled("Ultra cancelled during scouts")
                    results.append(future.result())
            except Exception:
                client.cancel(job_id)
                for future in futures:
                    future.cancel()
                raise
        results.sort(key=lambda item: item[0])
        notes = "\n\n".join(
            f"SCOUT {index + 1} (advisory):\n{text}"
            for index, _response, text, _latency_ms in results
        )
        lead_input = (
            f"{input_text}\n\n"
            "READ-ONLY SCOUT NOTES\n"
            "These notes are advisory. You are the lead and the only role "
            "allowed to call tools or commit mutations.\n\n"
            f"{notes}"
        )
        receipts = tuple(
            {
                "role": f"read-only-scout-{index + 1}",
                "response_id": response_id(response),
                "model_id": profile.model_id,
                "wire_reasoning_effort": "max",
                "output_sha256": sha256(text.encode("utf-8")).hexdigest(),
                "output_chars": len(text),
                "latency_ms": latency_ms,
            }
            for index, response, text, latency_ms in results
        )
        return UltraPreparation(lead_input=lead_input, receipts=receipts)
