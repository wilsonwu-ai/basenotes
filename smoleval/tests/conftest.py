import gzip
import json

import pytest

HUMANEVAL_FIXTURE = [
    {
        "task_id": "Fix/0",
        "prompt": 'def add(a, b):\n    """Return a + b."""\n',
        "entry_point": "add",
        "canonical_solution": "    return a + b\n",
        "test": (
            "def check(candidate):\n"
            "    assert candidate(1, 2) == 3\n"
            "    assert candidate(-1, 1) == 0\n"
        ),
    },
    {
        "task_id": "Fix/1",
        "prompt": 'def mul(a, b):\n    """Return a * b."""\n',
        "entry_point": "mul",
        "canonical_solution": "    return a * b\n",
        "test": "def check(candidate):\n    assert candidate(3, 4) == 12\n",
    },
    {
        "task_id": "Fix/2",
        "prompt": 'def is_even(n):\n    """Return True if n is even."""\n',
        "entry_point": "is_even",
        "canonical_solution": "    return n % 2 == 0\n",
        "test": (
            "def check(candidate):\n"
            "    assert candidate(2) is True\n"
            "    assert candidate(3) is False\n"
        ),
    },
]


def _mbpp_row(task_id: int) -> dict:
    return {
        "task_id": task_id,
        "text": f"Write a function f{task_id} that returns {task_id}.",
        "code": f"def f{task_id}():\n    return {task_id}",
        "test_list": [f"assert f{task_id}() == {task_id}"],
        "test_setup_code": "",
        "challenge_test_list": [],
    }


# ids 1-10: prompting split; 11-13: inside the paper's test split (11-510).
MBPP_FIXTURE = [_mbpp_row(i) for i in list(range(1, 11)) + [11, 12, 13]]


@pytest.fixture
def fixture_cache(tmp_path, monkeypatch):
    """Point SMOLEVAL_CACHE at a tmp dir pre-seeded with tiny fixture datasets,
    so loaders never touch the network."""
    cache = tmp_path / "smoleval-cache"
    cache.mkdir()
    monkeypatch.setenv("SMOLEVAL_CACHE", str(cache))
    with gzip.open(cache / "HumanEval.jsonl.gz", "wt", encoding="utf-8") as f:
        for row in HUMANEVAL_FIXTURE:
            f.write(json.dumps(row) + "\n")
    with open(cache / "mbpp.jsonl", "w", encoding="utf-8") as f:
        for row in MBPP_FIXTURE:
            f.write(json.dumps(row) + "\n")
    return cache
