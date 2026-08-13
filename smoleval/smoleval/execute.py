"""Sandboxed execution of model-generated code.

Defense layers, adapted in spirit from OpenAI's human-eval harness (MIT):

1. Fresh subprocess per program, ``python -I`` (isolated mode: no user
   site-packages, no PYTHONPATH, no current-dir on sys.path).
2. POSIX rlimits set inside the child before user code runs: CPU time,
   address space, file size, no core dumps. Hard limits, so user code
   can't raise them back.
3. Fresh temporary working directory and a minimal environment; stdout
   and stderr go to files inside it, so the file-size rlimit caps output
   floods.
4. An in-process guard that stubs out destructive os/shutil/subprocess
   calls before user code runs.
5. A wall-clock timeout that SIGKILLs the whole process group.

This is solid protection against accidents (infinite loops, memory
bombs, stray os.system calls) but it is NOT a hard security boundary
against an adversarial payload. Don't run it as root on a machine you
care about; a container is the belt-and-suspenders option.

POSIX only (macOS / Linux). On Windows, use WSL.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

# Runs before user code inside the child. String-formatted with the CPU
# and memory limits so no preexec_fn is needed (preexec_fn is unsafe in
# threaded parents, and we execute from a thread pool).
_GUARD_TEMPLATE = """\
import sys as _sys
try:
    import resource as _res
    _cpu = {cpu}
    _soft, _hard = _res.getrlimit(_res.RLIMIT_CPU)
    if _hard != _res.RLIM_INFINITY:
        _cpu = min(_cpu, _hard)  # never try to raise an inherited hard limit
    try:
        _res.setrlimit(_res.RLIMIT_CPU, (_cpu, _cpu))
    except (ValueError, OSError):
        pass
    try:
        _res.setrlimit(_res.RLIMIT_CORE, (0, 0))
    except (ValueError, OSError):
        pass
    try:
        _res.setrlimit(_res.RLIMIT_FSIZE, ({fsize}, {fsize}))
    except (ValueError, OSError):
        pass
    try:
        _res.setrlimit(_res.RLIMIT_AS, ({mem}, {mem}))
    except (ValueError, OSError):
        pass  # RLIMIT_AS is unreliable on macOS; CPU + wall limits still apply
    del _res
    _sys.modules["resource"] = None
except ImportError:
    pass

import builtins as _b
import faulthandler as _fh
import os as _os
import shutil as _sh
import subprocess as _sp

_fh.disable()


def _blocked(*_a, **_k):
    raise RuntimeError("blocked by smoleval sandbox")


for _name in (
    "kill", "system", "putenv", "remove", "removedirs", "rmdir", "unlink",
    "fork", "forkpty", "killpg", "rename", "renames", "truncate", "replace",
    "chmod", "chown", "chroot", "setuid", "fchdir", "chdir", "_exit",
):
    if hasattr(_os, _name):
        setattr(_os, _name, _blocked)
for _name in ("rmtree", "move", "chown"):
    setattr(_sh, _name, _blocked)
for _name in ("Popen", "run", "call", "check_call", "check_output"):
    setattr(_sp, _name, _blocked)
_b.exit = _blocked
_b.quit = _blocked
for _name in ("ipdb", "joblib", "psutil", "tkinter", "multiprocessing"):
    _sys.modules[_name] = None
del _b, _fh, _os, _sh, _sp, _sys, _name, _blocked

# The candidate runs as its own compilation unit so top-of-file
# `from __future__ import ...` lines stay legal, and the sentinel is
# written only if the program (solution + tests) ran to completion —
# a SystemExit / os._exit before the tests finish must not look like a pass.
_code = compile(open("cand.py", encoding="utf-8").read(), "cand.py", "exec")
exec(_code, {{"__name__": "__main__"}})
open({sentinel!r}, "w").write("ok")
"""


@dataclass
class ExecResult:
    passed: bool
    status: str  # "passed" | "failed" | "timeout" | "error"
    detail: str
    seconds: float


def _tail(path: str, limit: int = 2000) -> str:
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - limit))
            return f.read().decode("utf-8", errors="replace").strip()
    except OSError:
        return ""


def check_correctness(
    program: str, *, timeout: float = 10.0, memory_mb: int = 4096
) -> ExecResult:
    """Run one program in the sandbox.

    Passed requires exit code 0 within the timeout AND the success sentinel,
    which the runner writes only after the program ran to completion — so an
    early SystemExit / os._exit(0) cannot masquerade as a pass.
    """
    sentinel = f".smoleval_ok_{os.urandom(8).hex()}"
    runner = _GUARD_TEMPLATE.format(
        cpu=int(timeout) + 2,
        mem=memory_mb * 1024 * 1024,
        fsize=32 * 1024 * 1024,
        sentinel=sentinel,
    )
    with tempfile.TemporaryDirectory(prefix="smoleval-") as tmp:
        prog_path = os.path.join(tmp, "prog.py")
        cand_path = os.path.join(tmp, "cand.py")
        out_path = os.path.join(tmp, "stdout.txt")
        err_path = os.path.join(tmp, "stderr.txt")
        with open(cand_path, "w", encoding="utf-8") as f:
            f.write(program + "\n")
        with open(prog_path, "w", encoding="utf-8") as f:
            f.write(runner)
        env = {
            "PATH": os.defpath,
            "HOME": tmp,
            "TMPDIR": tmp,
            "PYTHONIOENCODING": "utf-8",
        }
        start = time.monotonic()
        with open(out_path, "wb") as out, open(err_path, "wb") as err:
            proc = subprocess.Popen(
                [sys.executable, "-I", prog_path],
                cwd=tmp,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=out,
                stderr=err,
                start_new_session=True,
            )
            timed_out = False
            try:
                returncode = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                _kill_group(proc)
                returncode = proc.wait()
        elapsed = time.monotonic() - start
        stderr_tail = _tail(err_path)
        completed = os.path.exists(os.path.join(tmp, sentinel))
        if timed_out:
            return ExecResult(False, "timeout", f"no result within {timeout}s", elapsed)
        if returncode == 0:
            if completed:
                return ExecResult(True, "passed", "", elapsed)
            return ExecResult(
                False,
                "failed",
                "exited (SystemExit/os._exit) before tests completed",
                elapsed,
            )
        status = "failed" if "AssertionError" in stderr_tail else "error"
        return ExecResult(False, status, stderr_tail, elapsed)


def _kill_group(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass


def run_many(
    programs: list[str],
    *,
    timeout: float = 10.0,
    memory_mb: int = 4096,
    workers: int | None = None,
    progress=None,
) -> list[ExecResult]:
    """Run programs concurrently (each in its own subprocess), preserving order."""
    if workers is None:
        workers = max(1, (os.cpu_count() or 2) // 2)

    def _one(program: str) -> ExecResult:
        result = check_correctness(program, timeout=timeout, memory_mb=memory_mb)
        if progress is not None:
            progress.update(1)
        return result

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_one, programs))
