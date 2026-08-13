"""smoleval command line.

    smoleval download                       # prefetch + checksum datasets
    smoleval lock --fraction 0.5 --seed 7   # freeze the held-out set (do this FIRST)
    smoleval run --backend hf --model /path/to/ckpt --tasks humaneval \\
        --n-samples 20 --temperature 0.2 --k 1,10 --heldout heldout.lock.json --split heldout
    smoleval smoke --backend hf --model /path/to/ckpt   # base-model sanity check
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

from tqdm import tqdm

from . import __version__, data, execute, prompts, report
from .backends import make_backend

SMOKE_PROMPTS = [
    (
        "humaneval-style completion",
        'def fizzbuzz(n):\n    """Return a list of strings for 1..n: "Fizz" for'
        ' multiples of 3, "Buzz" for multiples of 5, "FizzBuzz" for both,'
        ' otherwise the number itself as a string."""\n',
    ),
    ("code continuation", "import math\n\ndef primes_up_to(n):\n"),
    (
        "math word problem",
        "Question: A train travels 60 miles in 1.5 hours. What is its average "
        "speed in miles per hour?\nAnswer:",
    ),
    ("STEM continuation", "The three laws of motion were formulated by"),
]


def _parse_ks(text: str) -> list[int]:
    try:
        ks = sorted({int(part) for part in text.split(",") if part.strip()})
    except ValueError:
        raise SystemExit(f"--k must be comma-separated integers, got {text!r}")
    if not ks:
        raise SystemExit("--k is empty")
    if ks[0] < 1:
        raise SystemExit(f"--k values must be >= 1, got {ks[0]}")
    return ks


def _backend_kwargs(args) -> dict:
    if args.backend == "hf":
        return {
            "device": args.device,
            "dtype": args.dtype,
            "trust_remote_code": args.trust_remote_code,
            "seed": args.seed,
            "batch_size": args.batch_size,
        }
    if args.backend == "openai":
        return {
            "base_url": args.base_url,
            "api_key": args.api_key,
            "chat": args.chat,
        }
    return {}


def _load_problems(args, task: str) -> list[dict]:
    problems = data.load_dataset(task)
    if args.heldout:
        if args.split is None:
            raise SystemExit(
                "--heldout requires an explicit --split heldout|dev "
                "(or --split all to deliberately evaluate everything)"
            )
        lock = json.loads(Path(args.heldout).read_text())
        problems = data.apply_lock(problems, lock, args.split)
    elif args.split not in (None, "all"):
        raise SystemExit("--split heldout/dev requires --heldout LOCKFILE")
    if args.limit:
        problems = problems[: args.limit]
    return problems


def cmd_run(args) -> int:
    ks = _parse_ks(args.k)
    if max(ks) > args.n_samples:
        raise SystemExit(
            f"pass@{max(ks)} needs --n-samples >= {max(ks)} (got {args.n_samples})"
        )
    tasks = [t.strip() for t in args.tasks.split(",") if t.strip()]
    for task in tasks:
        if task not in data.DATASETS:
            raise SystemExit(f"unknown task {task!r}, choose from {data.DATASETS}")

    if args.temperature <= 0 and args.n_samples > 1 and args.backend != "dryrun":
        if max(ks) > 1:
            raise SystemExit(
                "temperature=0 with k>1 is meaningless: greedy decoding returns "
                "identical samples. Use --temperature 0.8 (Codex-paper setting) "
                "for pass@k>1."
            )
        print(
            "warning: temperature=0 with n>1 wastes compute (identical samples)",
            file=sys.stderr,
        )

    # Load (and thereby validate lockfile/split/data integrity for) every
    # task up front, so a bad config fails before any generation happens.
    per_task = {task: _load_problems(args, task) for task in tasks}

    backend = make_backend(args.backend, args.model, **_backend_kwargs(args))
    run_name = args.out or datetime.datetime.now().strftime("run-%Y%m%d-%H%M%S")
    outdir = Path("results") / run_name

    all_samples: list[dict] = []
    summaries: dict[str, dict] = {}
    tables: list[str] = []

    for task in tasks:
        problems = per_task[task]
        if not problems:
            print(f"[{task}] no problems selected, skipping", file=sys.stderr)
            continue
        fewshot = ""
        if task == "mbpp" and args.mode == "complete":
            fewshot = prompts.mbpp_fewshot_prefix(
                data.load_mbpp("prompt"), args.mbpp_shots
            )

        print(f"[{task}] {len(problems)} tasks, {args.n_samples} samples each")

        # Phase 1: generation.
        pending: list[dict] = []
        for problem in tqdm(problems, desc=f"{task} generate", unit="task"):
            prompt, stops = prompts.build_prompt(problem, args.mode, fewshot)
            completions = backend.generate(
                prompt,
                args.n_samples,
                max_new_tokens=args.max_new_tokens,
                temperature=args.temperature,
                top_p=args.top_p,
                stop=stops,
                problem=problem,
            )
            for idx, raw_completion in enumerate(completions):
                completion = prompts.truncate_at_stops(raw_completion, stops)
                pending.append(
                    {
                        "task_id": problem["task_id"],
                        "dataset": task,
                        "sample": idx,
                        "completion": completion,
                        "program": prompts.build_program(
                            problem, completion, args.mode, args.mbpp_challenge
                        ),
                    }
                )

        # Phase 2: sandboxed execution.
        with tqdm(total=len(pending), desc=f"{task} execute", unit="prog") as bar:
            results = execute.run_many(
                [p["program"] for p in pending],
                timeout=args.timeout,
                memory_mb=args.memory_mb,
                workers=args.workers,
                progress=bar,
            )
        task_results: dict[str, list[bool]] = {}
        for sample, result in zip(pending, results):
            sample.update(
                passed=result.passed,
                status=result.status,
                detail=result.detail,
                seconds=round(result.seconds, 3),
            )
            del sample["program"]  # reconstructable; keeps samples.jsonl readable
            task_results.setdefault(sample["task_id"], []).append(result.passed)
        all_samples.extend(pending)

        summary = report.summarize_dataset(task_results, ks)
        summaries[task] = summary
        tables.append(report.render_table(task, summary, report.status_counts(pending)))

    if not summaries:
        raise SystemExit("nothing was evaluated")

    config = {
        "smoleval": __version__,
        "backend": args.backend,
        "model": args.model,
        "mode": args.mode,
        "tasks": tasks,
        "n_samples": args.n_samples,
        "k": ks,
        "temperature": args.temperature,
        "top_p": args.top_p,
        "max_new_tokens": args.max_new_tokens,
        "timeout": args.timeout,
        "split": args.split or "all",
        "heldout_lock": args.heldout,
        "limit": args.limit,
        "mbpp_shots": args.mbpp_shots,
        "seed": args.seed,
    }
    report.write_outputs(outdir, config, all_samples, summaries)
    print()
    print("\n".join(tables))
    print(f"wrote {outdir}/summary.json and {outdir}/samples.jsonl")
    return 0


def cmd_smoke(args) -> int:
    backend = make_backend(args.backend, args.model, **_backend_kwargs(args))
    for title, prompt in SMOKE_PROMPTS:
        print(f"\n=== {title} ===")
        print(prompt, end="")
        completion = backend.generate(
            prompt, 1, max_new_tokens=args.max_new_tokens, temperature=0.0
        )[0]
        print(f"\033[36m{completion}\033[0m")
    if args.ppl:
        if args.backend != "hf":
            raise SystemExit("--ppl requires --backend hf")
        text = Path(args.ppl).read_text(encoding="utf-8")
        ppl = backend.perplexity(text)
        print(f"\nperplexity on {args.ppl}: {ppl:.3f}")
    print(
        "\nSmoke test only shows whether pretraining learned *something* — "
        "judge go/no-go on the loss curve plus these completions, and save "
        "HumanEval numbers for after SFT."
    )
    return 0


def cmd_lock(args) -> int:
    names = [t.strip() for t in args.tasks.split(",") if t.strip()]
    lock = data.make_lock(names, args.fraction, args.seed)
    Path(args.out).write_text(json.dumps(lock, indent=2) + "\n")
    for name, entry in lock["datasets"].items():
        print(
            f"{name}: held out {entry['n_heldout']}/{entry['n_total']} tasks "
            f"(sha256 {entry['sha256'][:12]}…)"
        )
    print(f"wrote {args.out} — commit it before looking at any results.")
    return 0


def cmd_download(args) -> int:
    for name in data.DATASETS:
        problems = data.load_dataset(name)
        print(f"{name}: {len(problems)} problems, sha256 {data.dataset_sha256(name)[:12]}…")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="smoleval", description=__doc__)
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    def add_backend_args(p):
        p.add_argument("--backend", choices=["hf", "openai", "dryrun"], required=True)
        p.add_argument(
            "--model",
            required=True,
            help="hf: checkpoint path or hub id; openai: served model name; "
            "dryrun: canonical|empty|mixed",
        )
        p.add_argument("--device", default=None, help="hf: cuda|mps|cpu (auto)")
        p.add_argument("--dtype", default=None, help="hf: float16|bfloat16|float32")
        p.add_argument("--trust-remote-code", action="store_true")
        p.add_argument("--batch-size", type=int, default=8, help="hf: sampling batch")
        p.add_argument("--base-url", default="http://localhost:8000/v1")
        p.add_argument("--api-key", default=None)
        p.add_argument("--chat", action="store_true", help="openai: use chat endpoint")
        p.add_argument("--max-new-tokens", type=int, default=512)
        p.add_argument("--seed", type=int, default=None)

    run = sub.add_parser("run", help="run an eval")
    add_backend_args(run)
    run.add_argument("--tasks", default="humaneval", help="comma list: humaneval,mbpp")
    run.add_argument("--mode", choices=["complete", "instruct"], default="complete")
    run.add_argument("--n-samples", type=int, default=1)
    run.add_argument("--k", default="1", help='comma list, e.g. "1,10"')
    run.add_argument("--temperature", type=float, default=0.0)
    run.add_argument("--top-p", type=float, default=0.95)
    run.add_argument("--timeout", type=float, default=10.0, help="per-program seconds")
    run.add_argument("--memory-mb", type=int, default=4096)
    run.add_argument("--workers", type=int, default=None, help="execution parallelism")
    run.add_argument("--limit", type=int, default=None, help="first N tasks only")
    run.add_argument("--heldout", default=None, help="path to heldout.lock.json")
    run.add_argument(
        "--split",
        choices=["heldout", "dev", "all"],
        default=None,
        help="required with --heldout so the held-out set is never used by accident",
    )
    run.add_argument("--mbpp-shots", type=int, default=3, choices=[0, 1, 2, 3])
    run.add_argument("--mbpp-challenge", action="store_true")
    run.add_argument("--out", default=None, help="run name under results/")
    run.set_defaults(func=cmd_run)

    smoke = sub.add_parser("smoke", help="print greedy completions for fixed prompts")
    add_backend_args(smoke)
    smoke.add_argument("--ppl", default=None, help="text file for perplexity (hf only)")
    smoke.set_defaults(func=cmd_smoke, max_new_tokens=150)

    lock = sub.add_parser("lock", help="freeze the held-out split")
    lock.add_argument("--tasks", default="humaneval,mbpp")
    lock.add_argument("--fraction", type=float, default=0.5)
    lock.add_argument("--seed", type=int, default=1234)
    lock.add_argument("--out", default="heldout.lock.json")
    lock.set_defaults(func=cmd_lock)

    download = sub.add_parser("download", help="prefetch datasets")
    download.set_defaults(func=cmd_download)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
