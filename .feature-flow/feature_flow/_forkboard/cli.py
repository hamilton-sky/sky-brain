"""forkboard: make a review page from a review document, and read back what people did on it.

usage: forkboard render DOC [--theme NAME] [--fragment] [--out FILE]
       forkboard live DOC DIR [--theme NAME]
       forkboard asks STATE
       forkboard answer STATE <ask number> <text>
       forkboard version STATE <figure> <original or a person id>
       forkboard picks STATE
       forkboard themes
       forkboard --version
DOC is a review document (doc.py), or - to read it from stdin. render writes the page beside DOC (same name, .html),
to --out, or to stdout when DOC is -. live writes DIR/index.html and DIR/state.json, to publish together as an
artifact that saves itself; it keeps what people saved in a state.json already there. STATE is that state.json, or
its folder. asks lists the open questions, answer answers one, version prints a version of a figure as mermaid, picks prints
what people picked on the page's choices as JSON ({key: value}). themes lists
the themes and what each one suits.
"""

import json
import sys
from pathlib import Path

from . import __version__, doc as docs, live, page

USAGE = __doc__.split("\n\n")[1].strip()


def read_doc(arg, err):
    try:
        text = sys.stdin.read() if arg == "-" else Path(arg).read_text(encoding="utf-8")
        return docs.check(json.loads(text))
    except (OSError, ValueError) as e:
        err.write("cannot read the review document %s: %s\n" % (arg, e))
        return None


def read_state(arg, err):
    path = Path(arg)
    if path.is_dir():
        path = path / "state.json"
    st = live.load(path)
    if st is None:
        err.write("no page state at %s: save the published page's state.json there first\n" % path.as_posix())
    return path, st


def main(argv, out=None, err=None):
    out = out or sys.stdout
    err = err or sys.stderr
    flags = {"--theme": None, "--out": None}
    fragment, args, i = False, [], 0
    while i < len(argv):
        a = argv[i]
        if a in flags and i + 1 < len(argv):
            flags[a] = argv[i + 1]
            i += 1
        elif a == "--fragment":
            fragment = True
        elif a == "--version":
            out.write("forkboard %s\n" % __version__)
            return 0
        elif a in ("-h", "--help"):
            out.write(USAGE + "\n")
            return 0
        elif a.startswith("-") and a != "-":
            err.write(USAGE + "\n")
            return 2
        else:
            args.append(a)
        i += 1
    command, rest = (args[0], args[1:]) if args else ("", [])
    sizes = {"render": 1, "live": 2, "asks": 1, "answer": 3, "version": 3, "picks": 1, "themes": 0}
    if sizes.get(command) != len(rest):
        err.write(USAGE + "\n")
        return 2
    if command == "themes":
        names = page.themes()
        width = max(map(len, names)) if names else 0
        out.write("".join("%s  %s\n" % (n.ljust(width), page.suits(n)) for n in names))
        return 0
    if command in ("render", "live"):
        name = (flags["--theme"] or page.DEFAULT_THEME).strip().lower()
        css = page.theme_css(name)
        if css is None:
            err.write("no theme %s: pick one of %s\n" % (name, ", ".join(page.themes())))
            return 1
        doc = read_doc(rest[0], err)
        if doc is None:
            return 1
        if command == "live":
            folder = Path(rest[1])
            folder.mkdir(parents=True, exist_ok=True)
            st = live.state(doc, live.load(folder / "state.json"))
            (folder / "index.html").write_text(page.render(doc, css, name, True, True), encoding="utf-8")
            (folder / "state.json").write_text(live.dump(st), encoding="utf-8")
            out.write("wrote %s and %s (round %d, %d figures, %d open asks)\n" % (
                (folder / "index.html").as_posix(), (folder / "state.json").as_posix(), st["round"],
                len(st["figures"]), sum(1 for a in st["asks"] if not a.get("answer"))))
            return 0
        html = page.render(doc, css, name, fragment)
        if rest[0] == "-" and not flags["--out"]:
            out.write(html)
            return 0
        dest = Path(flags["--out"]) if flags["--out"] else Path(rest[0]).with_suffix(".html")
        dest.write_text(html, encoding="utf-8")
        out.write("wrote %s\n" % dest.as_posix())
        return 0
    path, st = read_state(rest[0], err)
    if st is None:
        return 1
    try:
        if command == "asks":
            out.write(live.asks(st) + "\n")
        elif command == "picks":
            out.write(json.dumps(live.picks(st), ensure_ascii=False, sort_keys=True) + "\n")
        elif command == "answer":
            if not rest[1].isdigit():
                raise ValueError("the ask number must be a number, not %s" % rest[1])
            path.write_text(live.dump(live.answer(st, int(rest[1]), rest[2])), encoding="utf-8")
            out.write("answered ask %s in %s\n" % (rest[1], path.as_posix()))
        else:
            out.write(live.mermaid(live.version(st, rest[1], rest[2])[0]) + "\n")
    except ValueError as e:
        err.write("%s\n" % e)
        return 1
    return 0


def main_exit():
    """The forkboard console script."""
    sys.exit(main(sys.argv[1:]))
