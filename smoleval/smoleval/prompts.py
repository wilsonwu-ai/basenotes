"""Prompt construction, stop-sequence truncation, and test-program assembly.

Two prompting modes:

* ``complete`` — for base models. HumanEval problems are presented as-is
  (signature + docstring, model writes the body). MBPP uses the few-shot
  [BEGIN]/[DONE] format from the MBPP paper (Austin et al. 2021), built
  from the paper's dedicated prompting split (task ids 1-10).
* ``instruct`` — for post-SFT models. The task is phrased as an
  instruction and a ```python fenced block is extracted from the reply.
"""

from __future__ import annotations

import re

# Stop set from the Codex paper for signature+docstring completion:
# any new top-level construct means the function body is finished.
HUMANEVAL_STOPS = ["\nclass ", "\ndef ", "\n#", "\nif ", "\nprint("]
MBPP_STOPS = ["[DONE]"]
INSTRUCT_STOPS: list[str] = []

# Few-shot example ids for MBPP, from the paper's prompting split.
MBPP_FEWSHOT_IDS = [2, 3, 4]

_CODE_BLOCK_RE = re.compile(r"```(?:python)?\s*\n(.*?)```", re.DOTALL)


def truncate_at_stops(text: str, stops: list[str]) -> str:
    """Cut text at the earliest occurrence of any stop sequence."""
    cut = len(text)
    for stop in stops:
        idx = text.find(stop)
        if idx != -1:
            cut = min(cut, idx)
    return text[:cut]


def extract_code_block(text: str) -> str:
    """First fenced code block if present, else the raw text."""
    match = _CODE_BLOCK_RE.search(text)
    return match.group(1) if match else text


# ---------------------------------------------------------------------------
# HumanEval


def humaneval_prompt(problem: dict, mode: str) -> tuple[str, list[str]]:
    raw = problem["raw"]
    if mode == "complete":
        return raw["prompt"], HUMANEVAL_STOPS
    return (
        "Complete the following Python function. Reply with only the full "
        "function definition in a ```python code block.\n\n"
        f"```python\n{raw['prompt']}```",
        INSTRUCT_STOPS,
    )


def humaneval_program(problem: dict, completion: str, mode: str) -> str:
    raw = problem["raw"]
    if mode == "complete":
        body = raw["prompt"] + completion
    else:
        code = extract_code_block(completion)
        if f"def {raw['entry_point']}" in code:
            body = code
        else:
            # Model replied with a bare body; fall back to completion style.
            body = raw["prompt"] + completion
    return f"{body}\n{raw['test']}\ncheck({raw['entry_point']})\n"


# ---------------------------------------------------------------------------
# MBPP


def _mbpp_example(raw: dict, include_code: bool) -> str:
    tests = "\n".join(raw["test_list"])
    head = (
        "You are an expert Python programmer, and here is your task: "
        f"{raw['text']} Your code should pass these tests:\n\n{tests}\n[BEGIN]\n"
    )
    if include_code:
        return head + raw["code"] + "\n[DONE]\n"
    return head


def mbpp_fewshot_prefix(prompt_pool: list[dict], shots: int) -> str:
    """Few-shot prefix built from the MBPP prompting split (ids 1-10)."""
    if shots == 0:
        return ""
    by_id = {p["raw"]["task_id"]: p for p in prompt_pool}
    chosen = [by_id[i] for i in MBPP_FEWSHOT_IDS if i in by_id][:shots]
    if len(chosen) < shots:
        chosen = prompt_pool[:shots]
    return "\n".join(_mbpp_example(p["raw"], include_code=True) for p in chosen) + "\n"


def mbpp_prompt(problem: dict, mode: str, fewshot_prefix: str = "") -> tuple[str, list[str]]:
    raw = problem["raw"]
    if mode == "complete":
        return fewshot_prefix + _mbpp_example(raw, include_code=False), MBPP_STOPS
    tests = "\n".join(raw["test_list"])
    return (
        f"Write a Python function for this task: {raw['text']}\n"
        f"Your code should pass these tests:\n\n{tests}\n\n"
        "Reply with only the code in a ```python code block.",
        INSTRUCT_STOPS,
    )


def mbpp_program(problem: dict, completion: str, mode: str, challenge: bool = False) -> str:
    raw = problem["raw"]
    code = completion if mode == "complete" else extract_code_block(completion)
    parts = [code]
    # Setup goes AFTER the candidate: some tasks' setup code instantiates
    # classes the solution itself defines (e.g. Mbpp/367's Node).
    setup = raw.get("test_setup_code") or ""
    if setup.strip():
        parts.append(setup)
    parts.extend(raw["test_list"])
    if challenge:
        parts.extend(raw.get("challenge_test_list") or [])
    return "\n".join(parts) + "\n"


# ---------------------------------------------------------------------------
# Dispatch


def build_prompt(problem: dict, mode: str, fewshot_prefix: str = "") -> tuple[str, list[str]]:
    if problem["dataset"] == "humaneval":
        return humaneval_prompt(problem, mode)
    return mbpp_prompt(problem, mode, fewshot_prefix)


def build_program(problem: dict, completion: str, mode: str, challenge: bool = False) -> str:
    if problem["dataset"] == "humaneval":
        return humaneval_program(problem, completion, mode)
    return mbpp_program(problem, completion, mode, challenge)
