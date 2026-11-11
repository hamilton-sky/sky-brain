"""The checks the conductor runs, in process.

Each call lives in one function so plans/interactive-flow-python can swap it for an
in-process call without touching the conductor.
"""

import os
import sys
import tempfile
from pathlib import Path

from feature_flow import proc
from feature_flow import status
from feature_flow import gate as gate_module
from feature_flow import floorguard


class Result:
    def __init__(self, code, out):
        self.code = code
        self.out = out

    @property
    def ok(self):
        return self.code == 0


class _Collect:
    """stdout and stderr of an in-process port, folded together in the order they were written."""

    def __init__(self):
        self.parts = []

    def write(self, text):
        self.parts.append(text)

    def text(self):
        return "".join(self.parts)


def flow_status(scripts, feature, mode, root=None, cwd=None):
    """The ticket graph reader with --next, --counts or --check, in process. stderr is folded into the output.
    root, when given, stands in for FLOW_DIR for this one call (the planner's draft folder). cwd is the folder
    the plan is read under, None for the working folder."""
    out = _Collect()
    saved = os.environ.get("FLOW_DIR")
    if root is not None:
        os.environ["FLOW_DIR"] = str(root)
    try:
        code = status.run([feature, mode], out, out, cwd=cwd)
    finally:
        if root is not None:
            if saved is None:
                del os.environ["FLOW_DIR"]
            else:
                os.environ["FLOW_DIR"] = saved
    return Result(code, out.text())


def _stderr(text):
    try:
        sys.stderr.write(text)
        sys.stderr.flush()
    except (OSError, ValueError, UnicodeError):
        pass  # a live line is a courtesy: a closed or narrow stderr must not fail the gate


def gate(scripts, feature, timeout=None, quick=False, cwd=None, changed=None, log=None):
    """The gate, run in process. stderr is folded into the output as the subprocess call did.
    timeout is minutes, None for FLOW_GATE_TIMEOUT. quick runs Quick in the place of Test. cwd, changed: see gate.run.
    While it runs, a line naming its log and a "still running" line every minute go to this process's stderr, so a
    person (or an agent that reads it as it comes) is not left waiting in silence. log, when given, is the run log's
    writer: it gets a `GATE-TIME` line with the seconds each command took (`GATE-TIME Test=182 Lint=4`).
    Result.timings is the [(command, seconds)] list."""
    chunks = []
    timings = []
    code = gate_module.run(str(feature), chunks.append, chunks.append, timeout, quick, cwd=cwd, changed=changed,
                           progress=_stderr, timings=timings, announce=True)
    out = "".join(chunks).encode("utf-8", "surrogateescape").decode("utf-8", "replace")
    out = out.replace("\r\n", "\n").replace("\r", "\n")
    if log is not None and timings:
        log("GATE-TIME " + " ".join("%s=%d" % (key.replace(" ", "_"), round(seconds)) for key, seconds in timings))
    result = Result(code, out)
    result.timings = timings
    return result


def floor_guard(scripts, feature, num, base, cwd=None):
    """feature_flow.floorguard in-process; stdout and stderr are folded together in order. cwd: see floorguard.run."""
    chunks = []
    code = floorguard.run([str(feature), str(num), str(base)], chunks.append, chunks.append, cwd=cwd)
    out = "".join(chunks).encode("utf-8", "surrogateescape").decode("utf-8", "replace")
    return Result(code, out)


def smoke(command, timeout=None, cwd=None):
    """The smoke command, run in cwd (None: the working folder). timeout is minutes, 0 or None for none.
    Result.timed_out is set when it ran out."""
    args, use_shell = gate_module.shell(command)
    with tempfile.TemporaryFile() as log:
        code, timed_out = proc.run(args, use_shell, log, timeout, cwd=cwd)
        log.seek(0)
        out = log.read().decode("utf-8", "replace").replace("\r\n", "\n")
    result = Result(1 if timed_out else code, out)
    result.timed_out = timed_out
    return result
