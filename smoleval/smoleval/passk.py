"""Unbiased pass@k estimator from Chen et al. 2021 ("Evaluating Large
Language Models Trained on Code", the Codex paper, appendix A).

Given n samples per task of which c passed, the unbiased estimate of
pass@k is:

    pass@k = 1 - C(n - c, k) / C(n, k)

computed in product form for numerical stability.
"""

from __future__ import annotations

import math


def pass_at_k(n: int, c: int, k: int) -> float:
    """Unbiased pass@k for one task from n samples with c passes."""
    if k <= 0:
        raise ValueError(f"k must be positive, got {k}")
    if n <= 0:
        raise ValueError(f"n must be positive, got {n}")
    if not 0 <= c <= n:
        raise ValueError(f"need 0 <= c <= n, got c={c}, n={n}")
    if k > n:
        raise ValueError(
            f"k={k} > n={n}: generate at least k samples per task to estimate pass@{k}"
        )
    if n - c < k:
        return 1.0
    return 1.0 - math.prod(1.0 - k / i for i in range(n - c + 1, n + 1))


def mean_pass_at_k(counts: list[tuple[int, int]], k: int) -> float:
    """Mean pass@k over tasks; counts is a list of (n, c) per task."""
    if not counts:
        raise ValueError("no tasks to aggregate")
    return sum(pass_at_k(n, c, k) for n, c in counts) / len(counts)
