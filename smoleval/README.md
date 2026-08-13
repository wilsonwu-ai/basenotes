# smoleval

A small, honest eval harness for small code models. Built for the
"can a ~366M model trained on curated reasoning data beat phi-1-small?"
experiment: HumanEval + MBPP, sandboxed execution, the unbiased pass@k
estimator, and a held-out set you lock **before** looking at any results.

One command in, one table out:

```
### humaneval — 164 tasks, 20 samples/task

| metric | value |
|---|---|
| pass@1 | 0.4512 |
| pass@10 | 0.6100 |
```

## Install

```bash
cd smoleval
python -m venv .venv && source .venv/bin/activate
pip install -e .          # harness only (dryrun + openai backends)
pip install -e ".[hf]"    # + torch/transformers for local checkpoints
```

Works on macOS (Apple Silicon via MPS) and Linux (CUDA or CPU).
Execution sandboxing is POSIX-only; on Windows use WSL.

## The protocol (do these in order)

**1. Lock the held-out set first, before anyone sees a single result:**

```bash
smoleval lock --tasks humaneval,mbpp --fraction 0.5 --seed 1234
git add heldout.lock.json && git commit -m "Lock held-out eval split"
```

Iterate on the `dev` split all you want; report the `heldout` split once,
at the end. The lockfile records dataset sha256s, so it refuses to run if
the data underneath it changed.

**2. Sanity-check the base model when pretraining finishes:**

```bash
smoleval smoke --backend hf --model /path/to/checkpoint
```

A base model at this scale will score ~0 on HumanEval regardless of how
well pretraining went — that is expected and not a signal. Judge go/no-go
on the loss curve plus these greedy completions: does it produce
syntactically plausible Python? Does it stay on topic? Add
`--ppl somefile.txt` for perplexity on held-out text.

**3. After SFT, run the real thing:**

```bash
# quick greedy check (n=1)
smoleval run --backend hf --model /path/to/ckpt --tasks humaneval \
    --heldout heldout.lock.json --split dev

# proper pass@1 (Codex-paper settings: n=20, temp 0.2)
smoleval run --backend hf --model /path/to/ckpt --tasks humaneval,mbpp \
    --n-samples 20 --temperature 0.2 --k 1 \
    --heldout heldout.lock.json --split dev

# proper pass@10 needs more sampling diversity: temp 0.8
smoleval run --backend hf --model /path/to/ckpt --tasks humaneval,mbpp \
    --n-samples 20 --temperature 0.8 --k 1,10 \
    --heldout heldout.lock.json --split dev

# the final, report-once number
...same command... --split heldout
```

Each run writes `results/<name>/summary.json` (config + metrics, so every
number is reproducible) and `samples.jsonl` (every completion with its
execution outcome, for error analysis).

## Backends

| backend | use case |
|---|---|
| `hf` | local checkpoint dir or hub id; auto-picks cuda > mps > cpu |
| `openai` | any OpenAI-compatible server (vLLM, llama.cpp) — eval a model that lives on a rented GPU box from your laptop |
| `dryrun` | no model; `canonical` replays reference solutions (must score ~1.0), `empty` must score 0.0, `mixed` checks the pass@k math |

Evaluating the model where it lives:

```bash
# on the GPU instance
vllm serve /path/to/checkpoint --port 8000
# on your laptop (ssh -L 8000:localhost:8000 gpu-box)
smoleval run --backend openai --model ckpt --base-url http://localhost:8000/v1 ...
```

`--mode complete` (default) is for base models: HumanEval prompts are the
bare signature+docstring, MBPP uses the paper's 3-shot [BEGIN]/[DONE]
format. `--mode instruct` phrases tasks as instructions and extracts
```python blocks — use it for post-SFT chat models (with `--chat` on the
openai backend if the server applies a chat template).

## Things that will bite a 366M GPT-2-tokenizer model

- **Context length.** MBPP's 3-shot prompt can approach a 1024-token
  context. The hf backend clamps generation to the space available and
  warns; if you see the warning, drop to `--mbpp-shots 1` (record the
  change — shots affect scores).
- **Greedy + pass@10 don't mix.** Temperature 0 returns n identical
  samples; the harness warns. Use temp 0.8 for pass@10.
- **phi-1 numbers for calibration** (from the paper): phi-1 (1.3B) 50.6%
  HumanEval pass@1, 55.5% MBPP; phi-1-small (350M) 45% HumanEval. Note
  phi-1 was Python-only — a three-way Python/math/STEM data mix at 366M
  is fighting for capacity phi-1-small spent entirely on code.

## Sandbox

Model-generated code runs in a fresh subprocess (`python -I`) with CPU,
memory, and file-size rlimits, a scratch working directory, a minimal
environment, a guard that stubs out destructive os/shutil/subprocess
calls, and a wall-clock kill of the whole process group. A pass requires
exit code 0 **and** a success sentinel written after the tests complete,
so a completion that calls `sys.exit(0)` before the asserts run is scored
as a failure, not a pass. The candidate is compiled as its own file, so
`from __future__` imports in generated code stay legal. That's solid
against accidents (infinite loops, memory bombs, stray `os.system`) but
it is not a hardened boundary against an adversarial payload — don't run
as root; use a container if you want belt and suspenders.

## Validation

- 59 unit/integration tests (`pytest`), including an end-to-end CLI run
  on fixture data with exact expected pass@k values, and regression tests
  for the fun failure modes: `sys.exit(0)` masquerading as a pass,
  `from __future__` imports, retry storms on deterministic HTTP 4xx.
- Canonical replay over the real datasets: HumanEval 164/164 and MBPP
  500/500 reference solutions pass. (This caught a real quirk: Mbpp/367's
  `test_setup_code` uses a class the *solution* defines, so setup must
  execute after the candidate code.)
- pass@k estimator verified against brute-force enumeration of all
  C(n,k) subsets.

## Provenance

- HumanEval from `openai/human-eval` (MIT), fetched once and sha256-pinned
  in your cache (`~/.cache/smoleval`).
- MBPP (full, 974 tasks) from `google-research` (CC-BY-4.0), using the
  paper's splits: test = ids 11–510, few-shot examples from ids 2–4.
- Execution guard adapted in spirit from OpenAI's human-eval harness.
