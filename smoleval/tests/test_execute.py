import time

from smoleval.execute import check_correctness, run_many


def test_pass():
    result = check_correctness("assert 1 + 1 == 2\n")
    assert result.passed
    assert result.status == "passed"


def test_assertion_failure():
    result = check_correctness("assert 1 + 1 == 3, 'nope'\n")
    assert not result.passed
    assert result.status == "failed"
    assert "AssertionError" in result.detail


def test_exception():
    result = check_correctness("raise ValueError('boom')\n")
    assert not result.passed
    assert result.status == "error"
    assert "boom" in result.detail


def test_syntax_error():
    result = check_correctness("def f(:\n")
    assert not result.passed
    assert result.status == "error"


def test_timeout_wall_clock():
    start = time.monotonic()
    result = check_correctness("import time\ntime.sleep(60)\n", timeout=2.0)
    elapsed = time.monotonic() - start
    assert not result.passed
    assert result.status == "timeout"
    assert elapsed < 10


def test_timeout_busy_loop():
    result = check_correctness("while True:\n    pass\n", timeout=2.0)
    assert not result.passed
    assert result.status == "timeout"


def test_guard_blocks_os_system():
    result = check_correctness("import os\nos.system('echo hi')\n")
    assert not result.passed
    assert "blocked by smoleval sandbox" in result.detail


def test_guard_blocks_subprocess():
    result = check_correctness(
        "import subprocess\nsubprocess.run(['echo', 'hi'])\n"
    )
    assert not result.passed


def test_guard_blocks_file_deletion(tmp_path):
    victim = tmp_path / "victim.txt"
    victim.write_text("precious")
    result = check_correctness(f"import os\nos.remove({str(victim)!r})\n")
    assert not result.passed
    assert victim.exists()


def test_output_flood_capped():
    # Guarded by RLIMIT_FSIZE on the stdout file; should not hang or fill disk.
    result = check_correctness(
        "for _ in range(10**7):\n    print('x' * 100)\n", timeout=20.0
    )
    assert not result.passed  # killed by SIGXFSZ or similar


def test_legit_stdlib_still_works():
    program = (
        "import math, re, json, collections, itertools, heapq\n"
        "assert math.gcd(12, 18) == 6\n"
        "assert json.loads('[1, 2]') == [1, 2]\n"
        "assert re.findall(r'\\d+', 'a1b22') == ['1', '22']\n"
    )
    result = check_correctness(program)
    assert result.passed, result.detail


def test_sys_exit_zero_is_not_a_pass():
    # Script-style completions ending in sys.exit(0) must not skip the tests
    # and count as passing (exit code 0 alone is not proof of success).
    result = check_correctness("import sys\nsys.exit(0)\nassert False\n")
    assert not result.passed
    assert result.status == "failed"
    assert "before tests completed" in result.detail


def test_bare_systemexit_is_not_a_pass():
    result = check_correctness("raise SystemExit\nassert False\n")
    assert not result.passed


def test_os_underscore_exit_is_not_a_pass():
    result = check_correctness("import os\nos._exit(0)\nassert False\n")
    assert not result.passed


def test_future_import_is_legal():
    # The candidate is its own compilation unit, so file-top __future__
    # imports must not be turned into SyntaxErrors by the guard.
    program = (
        "from __future__ import annotations\n"
        "def f(x: int) -> int:\n"
        "    return x + 1\n"
        "assert f(1) == 2\n"
    )
    result = check_correctness(program)
    assert result.passed, result.detail


def test_run_many_preserves_order():
    programs = ["assert True\n", "assert False\n", "assert True\n"]
    results = run_many(programs, timeout=5.0, workers=3)
    assert [r.passed for r in results] == [True, False, True]
