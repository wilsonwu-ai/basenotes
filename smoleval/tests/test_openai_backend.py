import pytest
import requests

from smoleval.backends.openai_api import OpenAIBackend


class FakeResponse:
    def __init__(self, status_code, text="", payload=None):
        self.status_code = status_code
        self.text = text
        self._payload = payload or {}

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr("smoleval.backends.openai_api.time.sleep", lambda _s: None)


def _patch_post(monkeypatch, responses, calls):
    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append({"url": url, "payload": dict(json)})  # snapshot: backend reuses the dict
        return responses.pop(0)

    monkeypatch.setattr(requests, "post", fake_post)


def test_deterministic_4xx_not_retried(monkeypatch):
    calls = []
    _patch_post(monkeypatch, [FakeResponse(401, "unauthorized")], calls)
    backend = OpenAIBackend("m", base_url="http://x/v1")
    with pytest.raises(RuntimeError, match="not retried"):
        backend.generate("p", 1)
    assert len(calls) == 1


def test_5xx_retried_then_succeeds(monkeypatch):
    calls = []
    _patch_post(
        monkeypatch,
        [
            FakeResponse(500, "boom"),
            FakeResponse(200, payload={"choices": [{"text": "ok"}]}),
        ],
        calls,
    )
    backend = OpenAIBackend("m", base_url="http://x/v1")
    assert backend.generate("p", 1) == ["ok"]
    assert len(calls) == 2


def test_context_length_error_scores_empty_completions(monkeypatch):
    calls = []
    _patch_post(
        monkeypatch,
        [FakeResponse(400, "This model's maximum context length is 1024 tokens")],
        calls,
    )
    backend = OpenAIBackend("m", base_url="http://x/v1")
    with pytest.warns(UserWarning, match="context length"):
        out = backend.generate("p", 3)
    assert out == ["", "", ""]


def test_n_batching_accumulates_until_n(monkeypatch):
    calls = []
    two_choices = {"choices": [{"text": "a"}, {"text": "b"}]}
    _patch_post(
        monkeypatch,
        [FakeResponse(200, payload=two_choices) for _ in range(3)],
        calls,
    )
    backend = OpenAIBackend("m", base_url="http://x/v1")
    out = backend.generate("p", 5)
    assert len(out) == 5
    # Requested n shrinks as completions accumulate: 5, then 3, then 1.
    assert [c["payload"]["n"] for c in calls] == [5, 3, 1]


def test_chat_mode_payload_and_extraction(monkeypatch):
    calls = []
    _patch_post(
        monkeypatch,
        [FakeResponse(200, payload={"choices": [{"message": {"content": "hi"}}]})],
        calls,
    )
    backend = OpenAIBackend("m", base_url="http://x/v1", chat=True)
    out = backend.generate("prompt text", 1, stop=["a", "b", "c", "d", "e"])
    assert out == ["hi"]
    assert calls[0]["url"].endswith("/chat/completions")
    payload = calls[0]["payload"]
    assert payload["messages"] == [{"role": "user", "content": "prompt text"}]
    assert payload["stop"] == ["a", "b", "c", "d"]  # capped at the API limit of 4
