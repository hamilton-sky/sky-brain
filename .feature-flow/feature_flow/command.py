"""feature-flow: the command an installed package puts on PATH (`uvx feature-flow-cli install .`).

It installs the flow into a repo and reads a plan. The flow itself runs from the repo, as
python3 scripts/flow.py, with the copy the installer put there.
"""

import os
import sys

from pathlib import Path

from feature_flow import __version__, brainstorm_page, cli, install, evaluate, importer, report, status, suggest, uninstall, view

USAGE = """\
usage: feature-flow install [target-repo] [--agent claude|codex|all] [--user] [--private] [--force] [--dry-run]
       feature-flow uninstall [target-repo] [--user] [--force] [--dry-run]
       feature-flow status <feature> [--next | --counts | --check | --mermaid [plain] | --json]
       feature-flow view <feature> [--watch] [--no-open] [--out FILE]
       feature-flow reset <feature> [NN]
       feature-flow report <feature>
       feature-flow eval <feature> [--later] [--out DIR] [--claude-home DIR]
       feature-flow import <spec-kit or openspec folder, or its tasks.md> <feature> [--dry-run]
       feature-flow brainstorm-page <feature> [--style NAME] [--fragment] [--out FILE]
       feature-flow brainstorm-page <feature> --live DIR | --asks STATE | --answer STATE <n> <text> | --apply STATE <figure> <version>
       feature-flow --version
install copies the skill, its roles, scripts and guides into a repo; --user installs them once for every repo, in ~/.claude, ~/.agents and ~/.feature-flow, and writes nothing into a repo. feature-flow install --help says more.
uninstall removes exactly what install wrote (files you edited are kept); --user removes the personal install in ~/.claude, ~/.agents and ~/.feature-flow.
status and view read plans/<feature>/ in the current directory, like scripts/flow-status.py and scripts/flow-view.py.
reset reopens a half-built ticket (or ticket NN), commits that, and clears the run, like scripts/flow.py <feature> reset.
report prints what a run did (builds, reviews, failed checks, stops) from its log in .feature-flow/state/. Read-only.
given a Spec Kit or OpenSpec task list, `import` starts plans/<feature>/ with one ticket per phase or section.
brainstorm-page writes the feature's brainstorm as a review page beside it: a section sidebar, a theme switch, diagrams you can edit. --live writes a page and its state.json to publish as an artifact that people save versions in and ask Claude through; --asks, --answer and --apply are the session's side of it.
eval records a field run in plans/<feature>/eval.json: cost, tokens, what each check caught, where it needed you, and your verdict from eval-verdict.md.
"""


COMMANDS = ("install", "uninstall", "status", "view", "reset", "report", "eval", "import", "brainstorm-page", "--version",
            "--help")


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in ("-h", "--help", "help"):
        out = sys.stdout if args else sys.stderr
        out.write(USAGE)
        return 0 if args else 2
    command, rest = args[0], args[1:]
    if command in ("-V", "--version"):
        print("feature-flow " + __version__)
        return 0
    if command == "install":
        return install.main(install.source_root(), rest)
    if command == "uninstall":
        return uninstall.main(rest)
    if command == "status":
        return status.main(rest)
    if command == "view":
        return view.main(rest, here=os.path.join(install.source_root(), "scripts"))
    if command == "report":
        return report.main(rest)
    if command == "eval":
        return evaluate.main(rest)
    if command == "import":
        return importer.main(rest)
    if command == "brainstorm-page":
        return brainstorm_page.main(rest)
    if command == "reset":
        if not rest or len(rest) > 2:
            sys.stderr.write(USAGE)
            return 2
        return cli.main(rest[:1] + ["reset"] + rest[1:], scripts=Path.cwd() / "scripts")
    sys.stderr.write("unknown command: %s\n%s%s" % (command, suggest.hint(command, COMMANDS), USAGE))
    return 2
