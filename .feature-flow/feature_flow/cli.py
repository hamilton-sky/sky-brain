"""python3 scripts/flow.py <feature> <command>: the conductor's command line."""

import os
import sys
import traceback
from pathlib import Path

from feature_flow import git, state, suggest
from feature_flow.conductor import Conductor, NoPhase, Stop
from feature_flow.conductor.planning import Planner

USAGE = ("usage: python3 scripts/flow.py <feature> start | next [lane] | prompt [lane] [file] | verdict <file> [lane] | fast on|off\n"
         "       python3 scripts/flow.py <feature> budget [<minutes>|+<minutes>|off] | replan-prompt [repair]\n"
         "       python3 scripts/flow.py <feature> scouts [lane] | scout-prompt <k> [lane] | plan-scouts <brief> | plan-scout-prompt <k>\n"
         "       python3 scripts/flow.py <feature> consult-prompt architect|designer|po <question file>\n"
         "       python3 scripts/flow.py <feature> brainstorm-prompt scout|web|architect|designer|po|skeptic <question file>\n"
         "       python3 scripts/flow.py <feature> asked setup|options|plan | reset [NN]\n"
         "       python3 scripts/flow.py <feature> plan-prompt <brief> [findings] | plan-review-prompt | plan-accept")
COMMANDS = ("start", "next", "prompt", "verdict", "plan-prompt", "plan-review-prompt", "plan-accept", "reset", "fast", "scouts",
            "scout-prompt", "plan-scouts", "plan-scout-prompt", "consult-prompt", "budget", "replan-prompt",
            "brainstorm-prompt", "asked")
ARGS = {"verdict": (3, 4), "plan-prompt": (3, 4), "reset": (2, 3), "next": (2, 3), "prompt": (2, 3, 4), "fast": (3,), "scouts": (2, 3), "scout-prompt": (3, 4),
        "plan-scouts": (3,), "plan-scout-prompt": (3,), "consult-prompt": (4,), "brainstorm-prompt": (4,), "asked": (3,), "budget": (2, 3),
        "replan-prompt": (2, 3)}
WANTS = {"verdict": ("the file the reviewer's whole reply was saved to", "<file> [lane]"),
         "plan-prompt": ("the brief file", "<brief> [findings]"),
         "fast": ("on or off", "on|off"),
         "scout-prompt": ("the scout's number from a SCOUT line", "<k> [lane]"),
         "plan-scouts": ("the brief file", "<brief>"),
         "plan-scout-prompt": ("the scout's number from a SCOUT line", "<k>"),
         "consult-prompt": ("the role and the question file", "architect|designer|po <question file>"),
         "asked": ("the stop", "setup|options|plan"),
         "brainstorm-prompt": ("the helper and the question file",
                               "scout|web|architect|designer|po|skeptic <question file>")}
RUNNER_ONLY = ("next", "prompt", "verdict", "fast", "scouts", "scout-prompt", "budget", "replan-prompt")


def main(argv=None, scripts=None):
    """With FLOW_TRUSTED=1 (set by scripts/flow-trust.py) the last stderr line is always
    `flow-state <state sha256 or none> <findings sha256 or none>`, for the bytes the conductor left."""
    trusted = os.environ.get("FLOW_TRUSTED") == "1"
    state.SEEN.clear()
    try:
        args = list(sys.argv[1:] if argv is None else argv)
        if trusted:
            peek(args)
        return run(args, scripts, trusted)
    except SystemExit as err:  # say what the interpreter would say, but before the report
        if not trusted:
            raise
        if err.code is None or isinstance(err.code, int):
            return err.code or 0
        print(err.code, file=sys.stderr)
        return 1
    except BaseException:  # the traceback goes before the report, which stays the last stderr line
        if not trusted:
            raise
        traceback.print_exc()
        return 1
    finally:
        if trusted:
            sys.stdout.flush()
            sys.stderr.write("flow-state %s\n" % state.reported())
            sys.stderr.flush()


def peek(args):
    """Read the feature's state and findings files before anything can return early, so the report
    names the files that are there even after a usage error. Creates nothing."""
    if not args or not plain(args[0]):
        return
    feature = args[0]
    top = git.toplevel()
    if top is not None:
        folder = top / state.STATE_DIR
        state.read_bytes(state.state_path(folder, feature), "state")
        state.read_bytes(state.file_path(folder, feature, "findings"), "findings")


def plain(feature):
    """True when feature is a plain folder name: not empty, no leading -, no path parts."""
    return (bool(feature) and not feature.startswith("-") and feature not in (".", "..")
            and not any(c in feature for c in "/\\:"))


def run(args, scripts, trusted):
    if len(args) < 2 or args[1] not in COMMANDS or not args[0] or args[0].startswith("-"):
        print(USAGE, file=sys.stderr)
        if len(args) >= 2 and args[0] in COMMANDS:
            sys.stderr.write("did you mean: flow.py %s %s?\n" % (args[1], args[0]))
        elif len(args) >= 2:
            sys.stderr.write(suggest.hint(args[1], COMMANDS))
        return 2
    feature, command = args[0], args[1]
    if not plain(feature):
        print("the feature must be a plain folder name, not %s" % feature, file=sys.stderr)
        return 2
    if len(args) not in ARGS.get(command, (2,)):
        print(USAGE, file=sys.stderr)
        if "--after-build" in args:
            sys.stderr.write("--after-build is flow-trust.py's: flow-trust.py --after-build <ticket> <sha> %s next\n"
                             % feature)
        elif command in WANTS:
            sys.stderr.write("%s needs %s: %s %s\n" % (command, WANTS[command][0], command, WANTS[command][1]))
        return 2
    if command in RUNNER_ONLY and not trusted:
        print("STOP run the conductor through scripts/flow-trust.py, as the skill says")
        return 1
    scripts = Path(scripts) if scripts else Path.cwd() / "scripts"
    conductor = None
    try:
        conductor = Conductor(feature, scripts)
        if command == "verdict":
            line = conductor.verdict(*args[2:])
        elif command == "plan-prompt":
            line = conductor.plan_prompt(args[2], args[3] if len(args) == 4 else None)
        elif command == "plan-review-prompt":
            line = conductor.plan_review_prompt()
        elif command == "plan-accept":
            line = conductor.plan_accept()
        elif command == "prompt":
            rest = args[2:]
            to_file = "file" in rest
            rest = [a for a in rest if a != "file"]
            if len(rest) > 1:
                print(USAGE, file=sys.stderr)
                return 2
            line = conductor.prompt(*rest, to_file=to_file)
        elif command == "reset":
            line = conductor.reset(args[2] if len(args) == 3 else None)
        elif command == "scouts":
            line = conductor.scouts(*args[2:])
        elif command == "scout-prompt":
            line = conductor.scout_prompt(*args[2:])
        elif command == "plan-scouts":
            line = conductor.plan_scouts(args[2])
        elif command == "plan-scout-prompt":
            line = conductor.plan_scout_prompt(args[2])
        elif command == "consult-prompt":
            line = conductor.consult_prompt(args[2], args[3])
        elif command == "asked":
            line = Planner(conductor).asked(args[2])
        elif command == "brainstorm-prompt":
            line = conductor.brainstorm_prompt(args[2], args[3])
        elif command == "fast":
            line = conductor.fast_switch(args[2])
        elif command == "budget":
            line = conductor.budget_cmd(*args[2:])
        elif command == "replan-prompt":
            line = conductor.replan_prompt(*args[2:])
        elif command == "start":
            line = conductor.start()
        else:
            line = conductor.next(*args[2:])
    except NoPhase as err:
        print(err, file=sys.stderr)
        return 2
    except Stop as stop:
        line = "STOP %s" % stop
        if conductor is not None:
            conductor.log("STOP " + " ".join(str(stop).split())[:200])
        print(line)
        return 1
    out = sys.stdout
    if command in ("plan-prompt", "plan-review-prompt", "plan-scout-prompt", "consult-prompt", "replan-prompt") and hasattr(out, "reconfigure"):
        # the plan guides hold non-ASCII text, which a Windows console code page cannot print
        out.reconfigure(encoding="utf-8")
    print(line, end="" if line.endswith("\n") else "\n", file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
