"""Run a shell command with its output in a file and a time limit, and end the whole process tree on a timeout."""

import subprocess
import sys
import time

def kill_tree(proc):
    """End proc and everything it started. POSIX: the child leads its own session, kill the group.
    Windows: taskkill /T walks the tree."""
    if sys.platform == "win32":
        subprocess.call(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        import os
        import signal
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            proc.kill()


def run(args, use_shell, log, minutes, cwd=None, tick=None, every=60):
    """Run args (from gate.shell) with stdout and stderr to the open file log. minutes is a float, 0 or None for
    no limit. cwd is the folder it runs in, None for the working folder. tick, when given, is called with the
    seconds so far every `every` seconds while the command runs. Returns (exit code, False), or
    (None, True) when the limit ran out and the tree was killed."""
    extra = {} if sys.platform == "win32" else {"start_new_session": True}
    proc = subprocess.Popen(args, shell=use_shell, stdout=log, stderr=subprocess.STDOUT, cwd=cwd, **extra)
    started = time.monotonic()
    limit = minutes * 60 if minutes else None
    try:
        while True:
            left = None if limit is None else max(0.0, limit - (time.monotonic() - started))
            wait = left if tick is None else (every if left is None else min(every, left))
            try:
                return proc.wait(timeout=wait), False
            except subprocess.TimeoutExpired:
                if tick is None or (left is not None and wait == left):  # the limit, not a tick, ran out
                    raise
                tick(time.monotonic() - started)
    except subprocess.TimeoutExpired:
        kill_tree(proc)
        proc.wait()
        return None, True
