"""End-to-end: CLI -> datasets -> prompts -> sandbox -> pass@k -> summary.json,
using the dry-run backend so no model is needed."""

import json

import pytest

from smoleval import cli


def run_cli(argv):
    return cli.main(argv)


def read_summary(tmp_path, name):
    return json.loads((tmp_path / "results" / name / "summary.json").read_text())


@pytest.fixture
def in_tmp(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_canonical_passes_everything(fixture_cache, in_tmp):
    code = run_cli(
        [
            "run", "--backend", "dryrun", "--model", "canonical",
            "--tasks", "humaneval,mbpp", "--n-samples", "1", "--k", "1",
            "--out", "canon",
        ]
    )
    assert code == 0
    summary = read_summary(in_tmp, "canon")
    assert summary["results"]["humaneval"]["metrics"]["pass@1"] == pytest.approx(1.0)
    assert summary["results"]["mbpp"]["metrics"]["pass@1"] == pytest.approx(1.0)
    samples = (in_tmp / "results" / "canon" / "samples.jsonl").read_text().splitlines()
    assert len(samples) == 6  # 3 humaneval + 3 mbpp tasks, 1 sample each


def test_empty_fails_everything(fixture_cache, in_tmp):
    run_cli(
        [
            "run", "--backend", "dryrun", "--model", "empty",
            "--tasks", "humaneval", "--n-samples", "1", "--k", "1",
            "--out", "empty",
        ]
    )
    summary = read_summary(in_tmp, "empty")
    assert summary["results"]["humaneval"]["metrics"]["pass@1"] == pytest.approx(0.0)


def test_mixed_matches_estimator_exactly(fixture_cache, in_tmp):
    run_cli(
        [
            "run", "--backend", "dryrun", "--model", "mixed",
            "--tasks", "humaneval", "--n-samples", "4", "--k", "1,2",
            "--out", "mixed",
        ]
    )
    summary = read_summary(in_tmp, "mixed")
    metrics = summary["results"]["humaneval"]["metrics"]
    # Every task: n=4, c=2 -> pass@1 = 0.5, pass@2 = 1 - C(2,2)/C(4,2) = 5/6.
    assert metrics["pass@1"] == pytest.approx(0.5)
    assert metrics["pass@2"] == pytest.approx(5 / 6)


def test_heldout_split_round_trip(fixture_cache, in_tmp):
    run_cli(["lock", "--tasks", "humaneval", "--fraction", "0.34", "--seed", "7"])
    lock = json.loads((in_tmp / "heldout.lock.json").read_text())
    n_held = lock["datasets"]["humaneval"]["n_heldout"]
    assert n_held == 1  # 3 tasks * 0.34 -> 1

    run_cli(
        [
            "run", "--backend", "dryrun", "--model", "canonical",
            "--tasks", "humaneval", "--n-samples", "1", "--k", "1",
            "--heldout", "heldout.lock.json", "--split", "heldout",
            "--out", "held",
        ]
    )
    summary = read_summary(in_tmp, "held")
    assert summary["results"]["humaneval"]["n_tasks"] == n_held

    run_cli(
        [
            "run", "--backend", "dryrun", "--model", "canonical",
            "--tasks", "humaneval", "--n-samples", "1", "--k", "1",
            "--heldout", "heldout.lock.json", "--split", "dev",
            "--out", "dev",
        ]
    )
    summary = read_summary(in_tmp, "dev")
    assert summary["results"]["humaneval"]["n_tasks"] == 3 - n_held


def test_k_exceeding_samples_rejected(fixture_cache, in_tmp):
    with pytest.raises(SystemExit):
        run_cli(
            [
                "run", "--backend", "dryrun", "--model", "canonical",
                "--tasks", "humaneval", "--n-samples", "1", "--k", "10",
            ]
        )


def test_k_zero_rejected(fixture_cache, in_tmp):
    with pytest.raises(SystemExit):
        run_cli(
            [
                "run", "--backend", "dryrun", "--model", "canonical",
                "--tasks", "humaneval", "--k", "0",
            ]
        )


def test_heldout_without_split_rejected(fixture_cache, in_tmp):
    run_cli(["lock", "--tasks", "humaneval", "--fraction", "0.34", "--seed", "7"])
    with pytest.raises(SystemExit, match="explicit --split"):
        run_cli(
            [
                "run", "--backend", "dryrun", "--model", "canonical",
                "--tasks", "humaneval", "--heldout", "heldout.lock.json",
            ]
        )


def test_greedy_pass_at_k_rejected_before_model_load(fixture_cache, in_tmp):
    # Must fail fast in the CLI: if this reached backend construction the
    # hf import would raise ImportError (torch isn't installed in the test
    # env), not SystemExit.
    with pytest.raises(SystemExit, match="temperature=0 with k>1"):
        run_cli(
            [
                "run", "--backend", "hf", "--model", "nonexistent",
                "--tasks", "humaneval", "--n-samples", "4", "--k", "2",
            ]
        )


def test_split_without_lock_rejected(fixture_cache, in_tmp):
    with pytest.raises(SystemExit):
        run_cli(
            [
                "run", "--backend", "dryrun", "--model", "canonical",
                "--tasks", "humaneval", "--split", "heldout",
            ]
        )


def test_limit(fixture_cache, in_tmp):
    run_cli(
        [
            "run", "--backend", "dryrun", "--model", "canonical",
            "--tasks", "humaneval", "--limit", "2", "--out", "lim",
        ]
    )
    summary = read_summary(in_tmp, "lim")
    assert summary["results"]["humaneval"]["n_tasks"] == 2
