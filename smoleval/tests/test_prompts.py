from smoleval import prompts

HUMANEVAL_PROBLEM = {
    "task_id": "Fix/0",
    "dataset": "humaneval",
    "raw": {
        "task_id": "Fix/0",
        "prompt": 'def add(a, b):\n    """Return a + b."""\n',
        "entry_point": "add",
        "canonical_solution": "    return a + b\n",
        "test": "def check(candidate):\n    assert candidate(1, 2) == 3\n",
    },
}

MBPP_PROBLEM = {
    "task_id": "Mbpp/11",
    "dataset": "mbpp",
    "raw": {
        "task_id": 11,
        "text": "Write a function to add two numbers.",
        "code": "def add(a, b):\n    return a + b",
        "test_list": ["assert add(1, 2) == 3", "assert add(0, 0) == 0"],
        "test_setup_code": "",
        "challenge_test_list": ["assert add(-1, 1) == 0"],
    },
}


def test_truncate_at_stops():
    text = "    return a + b\n\ndef next_function():\n    pass"
    assert prompts.truncate_at_stops(text, ["\ndef ", "\nclass "]) == (
        "    return a + b\n"
    )


def test_truncate_earliest_stop_wins():
    text = "body\nprint(1)\ndef f():"
    assert prompts.truncate_at_stops(text, ["\ndef ", "\nprint("]) == "body"


def test_truncate_no_stops_present():
    assert prompts.truncate_at_stops("    return 1\n", ["[DONE]"]) == "    return 1\n"


def test_humaneval_complete_prompt_is_verbatim():
    prompt, stops = prompts.build_prompt(HUMANEVAL_PROBLEM, "complete")
    assert prompt == HUMANEVAL_PROBLEM["raw"]["prompt"]
    assert "\ndef " in stops


def test_humaneval_program_assembly():
    program = prompts.build_program(HUMANEVAL_PROBLEM, "    return a + b\n", "complete")
    assert program.startswith("def add(a, b):")
    assert "def check(candidate):" in program
    assert program.rstrip().endswith("check(add)")
    exec_globals: dict = {}
    exec(program, exec_globals)  # canonical body must actually pass


def test_humaneval_instruct_extracts_code_block():
    completion = "Here you go:\n```python\ndef add(a, b):\n    return a + b\n```"
    program = prompts.build_program(HUMANEVAL_PROBLEM, completion, "instruct")
    assert "Here you go" not in program
    exec_globals: dict = {}
    exec(program, exec_globals)


def test_humaneval_instruct_bare_body_falls_back():
    program = prompts.build_program(HUMANEVAL_PROBLEM, "    return a + b\n", "instruct")
    exec_globals: dict = {}
    exec(program, exec_globals)


def test_mbpp_prompt_and_stops():
    prompt, stops = prompts.build_prompt(MBPP_PROBLEM, "complete")
    assert prompt.endswith("[BEGIN]\n")
    assert "assert add(1, 2) == 3" in prompt
    assert MBPP_PROBLEM["raw"]["code"] not in prompt
    assert stops == ["[DONE]"]


def test_mbpp_fewshot_prefix_includes_solutions():
    pool = [
        {
            "task_id": f"Mbpp/{i}",
            "dataset": "mbpp",
            "raw": {
                "task_id": i,
                "text": f"Task {i}.",
                "code": f"def f{i}(): pass",
                "test_list": [f"assert f{i}() is None"],
                "test_setup_code": "",
            },
        }
        for i in range(1, 11)
    ]
    prefix = prompts.mbpp_fewshot_prefix(pool, 3)
    assert prefix.count("[BEGIN]") == 3
    assert prefix.count("[DONE]") == 3
    # Paper's convention: examples come from ids 2, 3, 4.
    assert "def f2()" in prefix and "def f4()" in prefix
    assert "def f5()" not in prefix
    assert prompts.mbpp_fewshot_prefix(pool, 0) == ""


def test_mbpp_program_assembly():
    program = prompts.build_program(
        MBPP_PROBLEM, MBPP_PROBLEM["raw"]["code"], "complete"
    )
    assert "assert add(1, 2) == 3" in program
    assert "assert add(-1, 1) == 0" not in program  # challenge tests off by default
    exec(program, {})


def test_mbpp_program_challenge_tests():
    program = prompts.build_program(
        MBPP_PROBLEM, MBPP_PROBLEM["raw"]["code"], "complete", challenge=True
    )
    assert "assert add(-1, 1) == 0" in program


def test_mbpp_setup_code_after_candidate():
    problem = {
        "task_id": "Mbpp/99",
        "dataset": "mbpp",
        "raw": {
            **MBPP_PROBLEM["raw"],
            "test_setup_code": "value = add(1, 1)",
        },
    }
    program = prompts.build_program(problem, problem["raw"]["code"], "complete")
    # Setup may depend on names the candidate defines (see Mbpp/367), so it
    # must come after the code and before the asserts.
    assert (
        program.index("def add")
        < program.index("value = add(1, 1)")
        < program.index("assert add(1, 2) == 3")
    )
    exec(program, {})
