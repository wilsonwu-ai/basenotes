"""Dataset loading, caching, integrity checks, and held-out set locking.

Datasets are fetched once from their canonical upstream locations and
cached under ~/.cache/smoleval (override with SMOLEVAL_CACHE). A sha256
of each file is recorded on first download and verified on every
subsequent load, so a silently-changed dataset can't quietly move your
numbers.

The lockfile freezes a held-out subset of task ids *before* anyone looks
at results, so the go/no-go decision is made on tasks nobody peeked at.
"""

from __future__ import annotations

import datetime
import gzip
import hashlib
import json
import os
import random
from pathlib import Path

import requests

HUMANEVAL_URL = "https://raw.githubusercontent.com/openai/human-eval/master/data/HumanEval.jsonl.gz"
MBPP_URL = "https://raw.githubusercontent.com/google-research/google-research/master/mbpp/mbpp.jsonl"

# Task-id splits from the MBPP paper (Austin et al. 2021, section 2.1).
MBPP_SPLITS = {
    "prompt": range(1, 11),      # reserved for few-shot prompting
    "test": range(11, 511),      # the 500-problem eval split
    "validation": range(511, 601),
    "train": range(601, 975),
}

DATASETS = ("humaneval", "mbpp")


def cache_dir() -> Path:
    root = os.environ.get("SMOLEVAL_CACHE")
    path = Path(root) if root else Path.home() / ".cache" / "smoleval"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _fetch(url: str, dest: Path) -> None:
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(resp.content)
    tmp.replace(dest)


def _ensure_file(url: str, filename: str) -> Path:
    """Download-once with recorded-on-first-download sha256 verification."""
    dest = cache_dir() / filename
    sha_file = dest.with_suffix(dest.suffix + ".sha256")
    if not dest.exists():
        _fetch(url, dest)
        sha_file.write_text(_sha256(dest) + "\n")
    digest = _sha256(dest)
    if sha_file.exists():
        recorded = sha_file.read_text().strip()
        if recorded and recorded != digest:
            raise RuntimeError(
                f"{dest} sha256 mismatch: recorded {recorded[:12]}…, got {digest[:12]}…. "
                "The cached dataset changed since it was first downloaded. "
                "Delete the file (and its .sha256) to re-fetch deliberately."
            )
    else:
        sha_file.write_text(digest + "\n")
    return dest


def dataset_sha256(name: str) -> str:
    path = {
        "humaneval": cache_dir() / "HumanEval.jsonl.gz",
        "mbpp": cache_dir() / "mbpp.jsonl",
    }[name]
    return _sha256(path)


def _read_jsonl(path: Path) -> list[dict]:
    opener = gzip.open if path.suffix == ".gz" else open
    rows = []
    with opener(path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def load_humaneval() -> list[dict]:
    """164 problems: task_id, prompt, entry_point, canonical_solution, test."""
    path = _ensure_file(HUMANEVAL_URL, "HumanEval.jsonl.gz")
    problems = []
    for raw in _read_jsonl(path):
        problems.append({"task_id": raw["task_id"], "dataset": "humaneval", "raw": raw})
    return problems


def load_mbpp(split: str = "test") -> list[dict]:
    """MBPP (full, 974 problems): text, code, test_list, test_setup_code."""
    if split not in MBPP_SPLITS:
        raise ValueError(f"unknown MBPP split {split!r}, choose from {sorted(MBPP_SPLITS)}")
    path = _ensure_file(MBPP_URL, "mbpp.jsonl")
    wanted = MBPP_SPLITS[split]
    problems = []
    for raw in _read_jsonl(path):
        if raw["task_id"] in wanted:
            problems.append(
                {"task_id": f"Mbpp/{raw['task_id']}", "dataset": "mbpp", "raw": raw}
            )
    return problems


def load_dataset(name: str) -> list[dict]:
    if name == "humaneval":
        return load_humaneval()
    if name == "mbpp":
        return load_mbpp("test")
    raise ValueError(f"unknown dataset {name!r}, choose from {DATASETS}")


# ---------------------------------------------------------------------------
# Held-out set locking


def make_lock(names: list[str], fraction: float, seed: int) -> dict:
    """Freeze a held-out subset of each dataset with a seeded shuffle."""
    if not 0.0 < fraction < 1.0:
        raise ValueError(f"fraction must be in (0, 1), got {fraction}")
    lock: dict = {
        "version": 1,
        "seed": seed,
        "fraction": fraction,
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "datasets": {},
    }
    for name in names:
        problems = load_dataset(name)
        ids = sorted(p["task_id"] for p in problems)
        rng = random.Random(f"smoleval-lock:{seed}:{name}")
        shuffled = ids[:]
        rng.shuffle(shuffled)
        n_held = max(1, round(len(ids) * fraction))
        held = sorted(shuffled[:n_held])
        lock["datasets"][name] = {
            "sha256": dataset_sha256(name),
            "n_total": len(ids),
            "n_heldout": len(held),
            "heldout_ids": held,
        }
    return lock


def apply_lock(problems: list[dict], lock: dict, split: str) -> list[dict]:
    """Filter problems to the locked 'heldout' split or its 'dev' complement.

    Integrity (lock entry present, dataset sha256 unchanged) is verified for
    every split, including 'all'.
    """
    if split not in ("heldout", "dev", "all"):
        raise ValueError(f"split must be heldout, dev, or all, got {split!r}")
    if not problems:
        return problems
    name = problems[0]["dataset"]
    entry = lock["datasets"].get(name)
    if entry is None:
        raise ValueError(f"lockfile has no entry for dataset {name!r}")
    current = dataset_sha256(name)
    if entry["sha256"] != current:
        raise RuntimeError(
            f"dataset {name!r} sha256 {current[:12]}… does not match the lockfile's "
            f"{entry['sha256'][:12]}… — the data changed since the lock was created."
        )
    if split == "all":
        return problems
    held = set(entry["heldout_ids"])
    if split == "heldout":
        return [p for p in problems if p["task_id"] in held]
    return [p for p in problems if p["task_id"] not in held]
