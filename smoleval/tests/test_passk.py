import itertools
import math

import pytest

from smoleval.passk import mean_pass_at_k, pass_at_k


def brute_force(n: int, c: int, k: int) -> float:
    """Exact expectation of any-pass over all C(n, k) subsets."""
    flags = [True] * c + [False] * (n - c)
    subsets = list(itertools.combinations(range(n), k))
    hits = sum(1 for subset in subsets if any(flags[i] for i in subset))
    return hits / len(subsets)


@pytest.mark.parametrize("n", [1, 2, 5, 10])
def test_matches_brute_force(n):
    for c in range(n + 1):
        for k in range(1, n + 1):
            assert pass_at_k(n, c, k) == pytest.approx(brute_force(n, c, k), abs=1e-12)


def test_edges():
    assert pass_at_k(20, 0, 1) == 0.0
    assert pass_at_k(20, 20, 1) == 1.0
    assert pass_at_k(20, 1, 20) == 1.0  # k == n and at least one pass
    assert pass_at_k(1, 0, 1) == 0.0
    assert pass_at_k(1, 1, 1) == 1.0


def test_codex_paper_identity():
    # pass@1 must equal the plain pass rate c/n.
    for n, c in [(20, 7), (10, 3), (5, 5)]:
        assert pass_at_k(n, c, 1) == pytest.approx(c / n)


def test_known_value():
    # n=4, c=2: pass@2 = 1 - C(2,2)/C(4,2) = 1 - 1/6
    assert pass_at_k(4, 2, 2) == pytest.approx(1 - 1 / 6)


def test_validation():
    with pytest.raises(ValueError):
        pass_at_k(5, 3, 6)  # k > n
    with pytest.raises(ValueError):
        pass_at_k(5, 6, 1)  # c > n
    with pytest.raises(ValueError):
        pass_at_k(5, -1, 1)
    with pytest.raises(ValueError):
        pass_at_k(0, 0, 1)
    with pytest.raises(ValueError):
        pass_at_k(5, 0, 0)


def test_mean():
    counts = [(4, 2), (4, 4), (4, 0)]
    expected = (0.5 + 1.0 + 0.0) / 3
    assert mean_pass_at_k(counts, 1) == pytest.approx(expected)
    with pytest.raises(ValueError):
        mean_pass_at_k([], 1)


def test_numerical_stability_large_n():
    value = pass_at_k(1000, 1, 100)
    assert 0.0 < value < 1.0
    assert math.isfinite(value)
