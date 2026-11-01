"""Run a shell command with its output in a file and a time limit, and end the whole process tree on a timeout."""

import subprocess
import sys

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


def run(args, use_shell, log, minutes, cwd=None):
    """Run args (from gate.shell) with stdout and stderr to the open file log. minutes is a float, 0 or None for
    no limit. cwd is the folder it runs in, None for the working folder. Returns (exit code, False), or
    (None, True) when the limit ran out and the tree was killed."""
    extra = {} if sys.platform == "win32" else {"start_new_session": True}
    proc = subprocess.Popen(args, shell=use_shell, stdout=log, stderr=subprocess.STDOUT, cwd=cwd, **extra)
    try:
        return proc.wait(timeout=minutes * 60 if minutes else None), False
    except subprocess.TimeoutExpired:
        kill_tree(proc)
        proc.wait()
        return None, True
