"""Aggregation and reporting: per-task pass counts -> pass@k -> table + files."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from .passk import pass_at_k


def summarize_dataset(
    task_results: dict[str, list[bool]], ks: list[int]
) -> dict:
    """task_results: task_id -> list of per-sample pass booleans."""
    counts = {tid: (len(flags), sum(flags)) for tid, flags in task_results.items()}
    n_samples = {n for n, _ in counts.values()}
    metrics = {}
    for k in ks:
        usable = [(n, c) for n, c in counts.values() if n >= k]
        if not usable:
            continue
        if len(usable) < len(counts):
            metrics[f"pass@{k}_note"] = (
                f"only {len(usable)}/{len(counts)} tasks had >= {k} samples"
            )
        metrics[f"pass@{k}"] = sum(pass_at_k(n, c, k) for n, c in usable) / len(usable)
    return {
        "n_tasks": len(counts),
        "samples_per_task": sorted(n_samples),
        "metrics": metrics,
        "tasks": {tid: {"n": n, "c": c} for tid, (n, c) in sorted(counts.items())},
    }


def status_counts(samples: list[dict]) -> dict[str, int]:
    return dict(Counter(s["status"] for s in samples))


def render_table(name: str, summary: dict, statuses: dict[str, int]) -> str:
    lines = [
        f"### {name} — {summary['n_tasks']} tasks, "
        f"{'/'.join(map(str, summary['samples_per_task']))} samples/task",
        "",
        "| metric | value |",
        "|---|---|",
    ]
    for key, value in summary["metrics"].items():
        if key.endswith("_note"):
            continue
        lines.append(f"| {key} | {value:.4f} |")
    for key, value in summary["metrics"].items():
        if key.endswith("_note"):
            lines.append(f"| note | {value} |")
    status_str = ", ".join(f"{k}: {v}" for k, v in sorted(statuses.items()))
    lines += ["", f"execution outcomes — {status_str}", ""]
    return "\n".join(lines)


def write_outputs(
    outdir: Path, config: dict, samples: list[dict], summaries: dict[str, dict]
) -> None:
    outdir.mkdir(parents=True, exist_ok=True)
    with open(outdir / "samples.jsonl", "w", encoding="utf-8") as f:
        for sample in samples:
            f.write(json.dumps(sample) + "\n")
    with open(outdir / "summary.json", "w", encoding="utf-8") as f:
        json.dump({"config": config, "results": summaries}, f, indent=2)
