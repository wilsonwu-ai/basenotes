import pytest

from smoleval import data


def test_load_humaneval_fixture(fixture_cache):
    problems = data.load_humaneval()
    assert [p["task_id"] for p in problems] == ["Fix/0", "Fix/1", "Fix/2"]
    assert all(p["dataset"] == "humaneval" for p in problems)


def test_load_mbpp_splits(fixture_cache):
    test_split = data.load_mbpp("test")
    assert [p["raw"]["task_id"] for p in test_split] == [11, 12, 13]
    prompt_split = data.load_mbpp("prompt")
    assert [p["raw"]["task_id"] for p in prompt_split] == list(range(1, 11))
    with pytest.raises(ValueError):
        data.load_mbpp("nope")


def test_sha_recorded_and_verified(fixture_cache):
    data.load_humaneval()
    sha_file = fixture_cache / "HumanEval.jsonl.gz.sha256"
    assert sha_file.exists()
    # Tamper with the dataset; next load must refuse.
    (fixture_cache / "HumanEval.jsonl.gz").write_bytes(b"corrupted")
    with pytest.raises(RuntimeError, match="sha256 mismatch"):
        data.load_humaneval()


def test_lock_deterministic_and_partitions(fixture_cache):
    lock_a = data.make_lock(["humaneval"], fraction=0.5, seed=7)
    lock_b = data.make_lock(["humaneval"], fraction=0.5, seed=7)
    assert lock_a["datasets"] == lock_b["datasets"]
    lock_c = data.make_lock(["humaneval"], fraction=0.5, seed=8)

    problems = data.load_humaneval()
    held = data.apply_lock(problems, lock_a, "heldout")
    dev = data.apply_lock(problems, lock_a, "dev")
    held_ids = {p["task_id"] for p in held}
    dev_ids = {p["task_id"] for p in dev}
    assert held_ids | dev_ids == {p["task_id"] for p in problems}
    assert not held_ids & dev_ids
    assert len(held) == lock_a["datasets"]["humaneval"]["n_heldout"]
    assert data.apply_lock(problems, lock_a, "all") == problems

    # A different seed should (for any non-trivial dataset) pick differently;
    # with 3 tasks collisions are possible, so just check both are valid.
    assert lock_c["datasets"]["humaneval"]["n_heldout"] == len(held)


def test_lock_rejects_changed_dataset(fixture_cache):
    lock = data.make_lock(["humaneval"], fraction=0.5, seed=7)
    problems = data.load_humaneval()
    lock["datasets"]["humaneval"]["sha256"] = "0" * 64
    with pytest.raises(RuntimeError, match="does not match the lockfile"):
        data.apply_lock(problems, lock, "heldout")


def test_lock_fraction_validation(fixture_cache):
    with pytest.raises(ValueError):
        data.make_lock(["humaneval"], fraction=0.0, seed=1)
    with pytest.raises(ValueError):
        data.make_lock(["humaneval"], fraction=1.0, seed=1)
