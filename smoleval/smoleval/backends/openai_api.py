"""OpenAI-compatible HTTP backend.

Works against any server that speaks the OpenAI completions API — vLLM,
llama.cpp server, TGI's OpenAI shim, or the real thing. This is the
backend to use while the model lives on a rented GPU instance:

    # on the GPU box
    vllm serve /path/to/checkpoint --port 8000

    # from your laptop (SSH tunnel or open port)
    smoleval run --backend openai --model ckpt \\
        --base-url http://localhost:8000/v1 ...

Base models should use the plain completions endpoint (default);
pass --chat for chat/SFT models served with a chat template.
"""

from __future__ import annotations

import os
import time
import warnings

import requests


class ContextLengthExceeded(RuntimeError):
    """The server rejected the prompt as longer than the model's context."""


_CONTEXT_ERROR_MARKERS = ("context length", "context_length", "maximum context")


class OpenAIBackend:
    name = "openai"

    def __init__(
        self,
        model: str,
        *,
        base_url: str = "http://localhost:8000/v1",
        api_key: str | None = None,
        chat: bool = False,
        request_timeout: float = 300.0,
        max_retries: int = 5,
    ):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = (
            api_key
            or os.environ.get("SMOLEVAL_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or "EMPTY"
        )
        self.chat = chat
        self.request_timeout = request_timeout
        self.max_retries = max_retries

    def _post(self, url: str, payload: dict) -> dict:
        headers = {"Authorization": f"Bearer {self.api_key}"}
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                resp = requests.post(
                    url, json=payload, headers=headers, timeout=self.request_timeout
                )
            except requests.RequestException as exc:
                # Network trouble: worth retrying.
                last_error = exc
                time.sleep(min(2**attempt, 30))
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                last_error = RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
                time.sleep(min(2**attempt, 30))
                continue
            if resp.status_code >= 400:
                # Deterministic client error: retrying can't help.
                body = resp.text[:500]
                if any(marker in body.lower() for marker in _CONTEXT_ERROR_MARKERS):
                    raise ContextLengthExceeded(body)
                raise RuntimeError(f"HTTP {resp.status_code} (not retried): {body}")
            return resp.json()
        raise RuntimeError(
            f"request to {url} failed after {self.max_retries} attempts"
        ) from last_error

    def generate(
        self,
        prompt: str,
        n: int,
        *,
        max_new_tokens: int = 512,
        temperature: float = 0.0,
        top_p: float = 0.95,
        stop=None,
        problem=None,
    ) -> list[str]:
        payload: dict = {
            "model": self.model,
            "max_tokens": max_new_tokens,
            "temperature": max(temperature, 0.0),
            "top_p": top_p,
        }
        if stop:
            payload["stop"] = list(stop)[:4]  # API limit; smoleval re-truncates locally
        if self.chat:
            url = f"{self.base_url}/chat/completions"
            payload["messages"] = [{"role": "user", "content": prompt}]
        else:
            url = f"{self.base_url}/completions"
            payload["prompt"] = prompt

        completions: list[str] = []
        while len(completions) < n:
            payload["n"] = n - len(completions)
            try:
                data = self._post(url, payload)
            except ContextLengthExceeded as exc:
                # Mirror the hf backend: an over-long prompt scores as
                # failures for this task instead of killing the whole run.
                warnings.warn(
                    f"prompt exceeds server context length, scoring {n} empty "
                    f"completions: {str(exc)[:200]}"
                )
                return [""] * n
            choices = data.get("choices") or []
            if not choices:
                raise RuntimeError(f"server returned no choices: {str(data)[:300]}")
            for choice in choices:
                if self.chat:
                    completions.append(choice["message"]["content"] or "")
                else:
                    completions.append(choice.get("text") or "")
        return completions[:n]
