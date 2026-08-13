"""Dry-run backend: no model, canned completions.

Lets you validate the *entire* pipeline (datasets, prompts, sandbox,
pass@k math, reporting) without a GPU or a checkpoint:

* ``canonical`` — returns the reference solution; pass rates should be
  ~1.0. If they aren't, the harness (not the model) is broken.
* ``empty`` — returns a body that raises; pass rates should be 0.0.
* ``mixed`` — alternates canonical/failing per sample index, so
  pass@k aggregation can be checked against exact expected values.
"""

from __future__ import annotations

MODES = ("canonical", "empty", "mixed")


def canonical_completion(problem: dict) -> str:
    if problem["dataset"] == "humaneval":
        return problem["raw"]["canonical_solution"]
    return problem["raw"]["code"]


def failing_completion(problem: dict) -> str:
    if problem["dataset"] == "humaneval":
        return "    raise NotImplementedError()\n"
    return "raise NotImplementedError()"


class DryRunBackend:
    name = "dryrun"

    def __init__(self, mode: str = "canonical"):
        if mode not in MODES:
            raise ValueError(f"dryrun mode must be one of {MODES}, got {mode!r}")
        self.mode = mode

    def generate(self, prompt: str, n: int, *, problem=None, **_) -> list[str]:
        if problem is None:
            raise ValueError("dryrun backend needs the problem dict")
        good = canonical_completion(problem)
        bad = failing_completion(problem)
        if self.mode == "canonical":
            return [good] * n
        if self.mode == "empty":
            return [bad] * n
        return [good if i % 2 == 0 else bad for i in range(n)]
