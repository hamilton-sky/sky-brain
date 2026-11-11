"""The ticket graph reader, ported from the bash script of the same name.

usage: python3 scripts/flow-status.py <feature> [--next | --ready | --counts | --check | --lint | --mermaid [plain] | --json | --width | --clean [--yes] | --eval [--later] | --import <tasks.md or folder> [--dry-run] | --fix <diagnosis.md> [--dry-run] | --page (or --brainstorm-page) [--style NAME] [--fragment | --live DIR | --asks STATE | --answer STATE N TEXT | --apply STATE FIGURE VERSION | --picks STATE]]
Exit codes for --next: 0 a ready ticket path is printed, 10 all done, 11 unfinished but nothing ready.
--ready prints every ready ticket path, one per line, with the same exit codes.
"""

import os
import re
import shlex
import shutil
import sys

from feature_flow import builders, suggest, tickets

USAGE = "usage: python3 scripts/flow-status.py <feature> [--next | --ready | --counts | --check | --lint | --mermaid [plain] | --json | --width | --clean [--yes] | --eval [--later] | --import <tasks.md or folder> [--dry-run] | --fix <diagnosis.md> [--dry-run] | --page (or --brainstorm-page) [--style NAME] [--fragment | --live DIR | --asks STATE | --answer STATE N TEXT | --apply STATE FIGURE VERSION | --picks STATE]]"


def _env(name, default):
    return os.environ.get(name) or default


def _under(cwd, path):
    """path read from cwd: the path itself when cwd is None or the path is absolute."""
    return path if cwd is None else os.path.join(cwd, path)


def jstr(s):
    out = ['"']
    for c in s:
        if c == "\\":
            out.append("\\\\")
        elif c == '"':
            out.append('\\"')
        elif c == "\t":
            out.append("\\t")
        elif c == "\001":
            out.append("\\n")
        elif c < " ":
            pass
        else:
            out.append(c)
    out.append('"')
    return "".join(out)


def run(argv, out, err, cwd=None):
    """Write what the bash script would to out and err, and return its exit code. cwd is the folder the plan
    is read under, None for the working folder; the paths it prints stay relative."""
    feature = argv[0] if len(argv) > 0 else ""
    mode = argv[1] if len(argv) > 1 and argv[1] != "" else "table"
    opt = argv[2] if len(argv) > 2 else ""
    if feature == "":
        err.write(USAGE + "\n")
        return 2
    root = _env("FLOW_DIR", "plans")
    folder = "%s/%s/%s" % (root, feature, _env("FLOW_TICKETS", "tasks"))
    if not os.path.isdir(_under(cwd, folder)):
        err.write("no ticket folder: %s\n" % folder)
        err.write(suggest.hint(feature, suggest.features(_under(cwd, root))))
        return 2
    paths = tickets.ticket_files(_under(cwd, folder))
    if not paths:
        err.write("no tickets in %s\n" % folder)
        return 2

    if mode in ("--check", "--lint"):
        learnings = "%s/%s/learnings.md" % (root, feature)
        if os.path.isfile(_under(cwd, learnings)):
            lines = sum(1 for line in tickets.records(_under(cwd, learnings)) if line.strip(" \t\n\v\f\r") != "")
            if lines > 40:
                out.write("warning: learnings.md has %d lines. every session reads it, so a human should prune it\n"
                          % lines)

    g = tickets.Graph(paths)
    if cwd is not None:  # print the paths as found from the working folder
        g.path = {t: "%s/%s" % (folder, p.rsplit("/", 1)[-1]) for t, p in g.path.items()}
    return _report(g, mode, opt, feature, out, err, root, cwd)


def _report(g, mode, opt, feature, out, err, root="plans", cwd=None):
    n = len(g.order)
    count = {"resolved": 0, "open": 0, "claimed": 0, "waiting": 0, "parked": 0, "unknown": 0}
    ready = {}
    first = None
    unfinished = 0
    for t in g.order:
        ready[t] = False
        count[g.stat[t]] += 1
        if g.stat[t] == "open":
            if all(d in g.seen and g.stat[d] == "resolved" for d in g.blk[t]):
                ready[t] = True
                if first is None:
                    first = t
        if g.stat[t] not in ("resolved", "parked"):
            unfinished += 1
    nready = sum(1 for t in g.order if ready[t])

    if mode in ("--next", "--ready"):
        if first is not None:
            out.write("\n".join(g.path[t] for t in g.order if ready[t] and (mode == "--ready" or t == first)) + "\n")
            return 0
        if unfinished == 0:
            err.write("COMPLETE\n")
            return 10
        err.write("stuck: %d claimed, %d waiting, %d open but blocked, %d unknown status\n"
                  % (count["claimed"], count["waiting"], count["open"], count["unknown"]))
        return 11

    counts = (n, count["resolved"], count["open"], count["claimed"], count["waiting"], count["parked"],
              count["unknown"], nready)

    if mode == "--counts":
        out.write("total=%d resolved=%d open=%d claimed=%d waiting=%d parked=%d unknown=%d ready=%d\n" % counts)
        return 0

    if mode == "--json":
        parts = []
        for t in g.order:
            bl = ",".join(jstr(g.lab[d] if d in g.seen else "%02d" % d) for d in g.blk[t])
            parts.append('{"id":%d,"label":%s,"title":%s,"status":%s,"type":%s,"test_first":%s,"blocked_by":[%s],'
                         '"ready":%s,"file":%s}'
                         % (t, jstr(g.lab[t]), jstr(g.title[t]), jstr(g.stat[t]), jstr(g.typ.get(t) or "task"),
                            jstr(g.tf.get(t, "")), bl, "true" if ready[t] else "false", jstr(g.path[t])))
        out.write('{"feature":%s,"tickets":[%s],"counts":{"total":%d,"resolved":%d,"open":%d,"claimed":%d,'
                  '"waiting":%d,"parked":%d,"unknown":%d,"ready":%d}}\n' % ((jstr(feature), ",".join(parts)) + counts))
        return 0

    if mode == "--width":
        return width(g, "%s/%s/commands.md" % (root, feature), cwd, out)

    if mode == "--mermaid":
        out.write("flowchart TD\n")
        for t in g.order:
            cls = g.stat[t]
            if cls == "open":
                cls = "ready" if ready[t] else "open"
            if cls == "unknown":
                cls = "open"
            suffix = "" if opt == "plain" else ":::" + cls
            out.write('  T%s["%s %s"]%s\n' % (g.lab[t], g.lab[t], g.title[t].replace('"', "'"), suffix))
        for t in g.order:
            for d in g.blk[t]:
                if d in g.seen:
                    out.write("  T%s --> T%s\n" % (g.lab[d], g.lab[t]))
        if opt != "plain":
            out.write("  classDef resolved fill:#d4edda,stroke:#2e7d32\n"
                      "  classDef ready fill:#fff3cd,stroke:#b8860b\n"
                      "  classDef open fill:#f5f5f5,stroke:#999999\n"
                      "  classDef claimed fill:#cfe2ff,stroke:#1d4ed8\n"
                      "  classDef waiting fill:#fde2e2,stroke:#b91c1c\n"
                      "  classDef parked fill:#eeeeee,stroke:#bbbbbb,stroke-dasharray:4 3\n")
        return 0

    if mode in ("--check", "--lint"):
        extra = lint(g, "%s/%s" % (root, feature), cwd) if mode == "--lint" else ([], [])
        return _check(g, ready, nready, unfinished, out, extra)

    for t in g.order:
        bl = ",".join("%02d" % d for d in g.blk[t])
        out.write("%s  %-9s %-6s %-12s %s\n" % (g.lab[t], g.stat[t], "READY" if ready[t] else "-",
                                                 "after " + bl if bl else "", g.title[t]))
    return 0


def lint(g, plan_dir, cwd=None):
    """(errors, warnings) the stricter plan lint adds to --check: every ticket carries a check block or
    says `Check: none <why>`, and commands.md names a Test command that can be found. Paths are read under
    cwd when given."""
    errors, warnings = [], []
    for t in g.order:
        lab = g.lab[t]
        if g.typ.get(t) == "settle":
            continue
        if t not in g.haslevel:
            warnings.append("%s: no `Level:` line. set 1, 2 or 3 (plan guide, ticket rule 8a); without it the "
                            "ticket gets the review rules of 0.8.0" % lab)
        lines = tickets.records(_under(cwd, g.path[t]))
        has_block = any(line.startswith("```check") for line in lines)
        none = next((line for line in lines[:20] if line.startswith("Check:")), None)
        if none is not None:
            reason = none[len("Check:"):].strip()
            if not reason.lower().startswith("none") or not reason[4:].strip(" \t:-"):
                errors.append(lab + ": `Check:` must read `Check: none <why>`")
        elif not has_block:
            errors.append(lab + ": no check block. add one under Done when, or `Check: none <why>` in the header")
        for line in lines:
            if line.strip().startswith("##"):
                continue
            for ref in re.findall(r"`([A-Za-z0-9_./-]+/[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)`", line):
                if "new" not in line.lower() and "plans/" not in ref and not os.path.exists(_under(cwd, ref)):
                    warnings.append("%s: names `%s`, which does not exist here (say `new` if it will be created)" % (lab, ref))
    commands = "%s/commands.md" % plan_dir
    test = tickets.commands_value(_under(cwd, commands), "Test")
    if not os.path.isfile(_under(cwd, commands)):
        errors.append("commands.md is missing")
    elif not test:
        errors.append("commands.md has no Test command (a placeholder in angle brackets does not count)")
    else:
        try:
            first = shlex.split(test, posix=(os.name != "nt"))[0].strip("\"'")
        except (ValueError, IndexError):
            first = test.split()[0]
        if "=" not in first and shutil.which(first) is None and first not in ("cd", "set", "export"):
            warnings.append("commands.md Test starts with `%s`, which is not on PATH here" % first)
    return errors, list(dict.fromkeys(warnings))


def _check(g, ready, nready, unfinished, out, extra=([], [])):
    errors = list(extra[0])
    for t in g.order:
        lab = g.lab[t]
        if t in g.dup:
            errors.append(lab + ": two tickets share this number")
        if not g.hasstatus[t]:
            errors.append(lab + ": no Status line in the first 20 lines")
        elif g.stat[t] == "unknown":
            errors.append(lab + ": unrecognised Status value")
        if not g.hasdone[t]:
            errors.append(lab + ": no ## Done when section")
        if t in g.hastf and g.tf[t] not in ("yes", "no"):
            errors.append(lab + ": Test first must be yes or no")
        if t in g.hasreview and g.review[t] not in ("full", "auto"):
            errors.append(lab + ": Review must be full or auto")
        if t in g.hasbuilder and g.builder[t] not in builders.NAMES:
            errors.append(lab + ": Builder must be %s" % ", ".join(builders.NAMES))
        if t in g.haslevel and g.level[t] not in ("1", "2", "3"):
            errors.append(lab + ": Level must be 1, 2 or 3")
        if t in g.hastouches and not g.touches[t]:
            errors.append(lab + ": Touches must name at least one path")
        for d in g.blk[t]:
            if d == t:
                errors.append(lab + ": blocked by itself")
            elif d not in g.seen:
                errors.append("%s: blocked by %d, which does not exist" % (lab, d))

    placed = set()
    progress = True
    left = len(g.order)
    while progress and left > 0:
        progress = False
        for t in g.order:
            if t in placed:
                continue
            if all(not (d in g.seen and d != t and d not in placed) for d in g.blk[t]):
                placed.add(t)
                progress = True
                left -= 1
    if left > 0:
        errors.extend(g.lab[t] + ": part of a dependency cycle" for t in g.order if t not in placed)
    if nready == 0 and unfinished > 0:
        errors.append("no ticket is ready to start")

    reach = set()
    for _ in range(len(g.order)):
        changed = False
        for t in g.order:
            for d in g.blk[t]:
                if d not in g.seen:
                    continue
                if (t, d) not in reach:
                    reach.add((t, d))
                    changed = True
                for x in g.order:
                    if (d, x) in reach and (t, x) not in reach:
                        reach.add((t, x))
                        changed = True
        if not changed:
            break
    for t in g.order:
        for m in g.mentions.get(t, []):
            if m == t or m not in g.seen or (t, m) in reach or (m, t) in reach:
                continue
            out.write("warning: %s: mentions ticket %s but is not ordered against it. add it to Blocked by, or reword\n"
                      % (g.lab[t], g.lab[m]))
    for w in extra[1]:
        out.write("warning: " + w + "\n")
    if errors:
        for e in errors:
            out.write(e + "\n")
        return 1
    out.write("OK: %d tickets, %d ready now\n" % (len(g.order), nready))
    return 0


def width_of(g, commands):
    """(how many of the plan's open tickets can build at once, [(ticket, the one it waits for, why)]), from the
    tickets' Touches:, Level: and Blocked by: lines and the Shared: line of commands.md."""
    from feature_flow import lanes
    shared = lanes.touches("Touches: " + (tickets.commands_value(commands, "Shared") or "")) or [] \
        if os.path.isfile(commands) else []
    items = [(t, g.touches.get(t) if t in g.hastouches else None,
              int(g.level[t]) if g.level.get(t, "").isdigit() else 0, g.blk[t],
              g.stat[t] in ("resolved", "parked")) for t in g.order]
    return lanes.plan_width(items, shared)


def width(g, commands, cwd, out):
    wide, waits = width_of(g, _under(cwd, commands))
    out.write("up to %d ticket%s can build at once\n" % (wide, "" if wide == 1 else "s"))
    for t, other, why in waits:
        out.write("  %s waits for %s: %s\n" % (g.lab[t], g.lab[other], why))
    return 0


class _Bytes:
    """Writes text to a byte stream, keeping the bytes awk would have passed through untouched."""

    def __init__(self, stream):
        self.stream = stream

    def write(self, text):
        self.stream.write(text.encode("utf-8", "surrogateescape"))
        self.stream.flush()


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) > 1 and argv[1] == "--eval":  # the run's record, written by feature_flow/evaluate.py
        from feature_flow import evaluate
        return evaluate.main(argv[:1] + argv[2:])
    if len(argv) > 1 and argv[1] in ("--brainstorm-page", "--page"):  # the brainstorm as a review page, feature_flow/brainstorm_page.py
        from feature_flow import brainstorm_page
        return brainstorm_page.main(argv[:1] + argv[2:])
    if len(argv) > 1 and argv[1] == "--clean":  # the brainstorm's spent files, feature_flow/clean.py
        from feature_flow import clean
        return clean.main(argv[:1] + argv[2:], sys.stdout, sys.stderr)
    if len(argv) > 2 and argv[1] == "--import":  # start the plan from a Spec Kit or OpenSpec task list
        from feature_flow import importer
        return importer.main(argv[2:] + argv[:1])
    if len(argv) > 2 and argv[1] == "--fix":  # a one-ticket plan from the session's diagnosis, guides/fix.md
        from feature_flow import fixer
        return fixer.main(argv[2:] + argv[:1])
    sys.stdout.flush()
    return run(argv, _Bytes(sys.stdout.buffer), _Bytes(sys.stderr.buffer))
