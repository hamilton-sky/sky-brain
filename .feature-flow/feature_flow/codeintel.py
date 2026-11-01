"""codeintel: an optional code-intelligence tool the scouts and reviewers may ask, when it is installed.

feature-flow never imports or installs it (`pip install feature-flow-cli[codeintel]` does). When the `codeintel`
command is on PATH and its `doctor` says an engine is ready for this repository, the scout's and the reviewer's
prompts get a short section on when to ask it, and each agent ends its reply with one line per question it asked.
`feature-flow eval` counts the questions and those lines, so a run says whether codeintel helped. The doctor's
answer is kept for an hour in the state folder. FLOW_CODEINTEL=off leaves codeintel out.
"""

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

from feature_flow import state

CACHE = "codeintel.json"
FRESH = 3600  # seconds the doctor's answer is kept
TIMEOUT = 30  # seconds the doctor may take
OPS = {"graph": "callers, callees, impact, changed", "semantic": "search", "lsp": "symbol"}
VERDICTS = ("helped", "no answer", "wrong")
LINE = re.compile(r"^[\s>*-]*codeintel: (?!<)(\S+) (.+?): (helped|no answer|wrong)\b[:,]?\s*(.*)$")
QUERY = re.compile(r"\bcodeintel\s+query\b.*?--op[=\s]+([\w-]+)")


def ready(repo="."):
    """The engines codeintel has ready for repo, such as ["graph", "semantic"]; [] when it is off or missing."""
    if os.environ.get("FLOW_CODEINTEL", "auto") == "off":
        return []
    exe = shutil.which("codeintel")
    if exe is None:
        return []
    top = Path(repo).resolve()
    cache = top / state.STATE_DIR / CACHE
    try:
        saved = json.loads(cache.read_text(encoding="utf-8"))
        if saved.get("exe") == exe and 0 <= time.time() - float(saved.get("checked", 0)) < FRESH:
            return [e for e in saved.get("ready") or [] if e in OPS]
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    found = probe(exe, top)
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"exe": exe, "checked": time.time(), "ready": found}) + "\n", encoding="utf-8")
    except OSError:
        pass
    return found


def probe(exe, top):
    """Ask `codeintel doctor --json` which engines are installed, runnable and have top indexed."""
    try:
        result = subprocess.run([exe, "doctor", "--json", str(top)], cwd=str(top), stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, timeout=TIMEOUT)
        engines = json.loads(result.stdout).get("engines") or {}
        return sorted(name for name, row in engines.items()
                      if name in OPS and isinstance(row, dict) and row.get("status") == "ok")
    except (OSError, subprocess.SubprocessError, ValueError, AttributeError):
        return []


def note(role, repo=".", base=None):
    """The section a scout's or reviewer's prompt gets when codeintel is ready, else ""."""
    engines = ready(repo)
    if not engines:
        return ""
    ops = "; ".join("`%s` (%s engine)" % (OPS[e].replace(", ", "`, `"), e) for e in engines)
    if role == "reviewer" and "graph" in engines:
        ask = ("`codeintel query --op changed --target %s` lists each function this change removed, re-signed or "
               "rewrote, with the callers it did not update: check those callers. `--op callers` and `--op impact` "
               "with `--target <name>` answer who else relies on a function the change touched."
               % (base or "<base commit>"))
    elif role == "builder":
        ask = ("Before you change a function's behaviour or signature, ask who calls it (`--op callers --target "
               "<name>`) or what the change would break (`--op impact`), so you update every caller and the tests "
               "that pin it. `--op search` is a hint only: check what it finds with grep.")
    else:
        ask = ("Ask it who calls a function or what a change would break (`--op callers` or `--op impact` with "
               "`--target <name>`), or where the code that does something lives (`--op search --target \"<what it "
               "does>\"`). Trust callers and impact more than search: search often ranks the wrong files first, so "
               "check what it finds with grep.")
    return ("\n## codeintel\n\ncodeintel, a code-intelligence tool, is installed for this repository. Where grep "
            "would take several tries, ask it once with `codeintel query --op <op> --target <name>`, a read only "
            "command. Ready here: %s. %s Its answers can be wrong, empty or older than the code: check one before you "
            "rely on it, and fall back to grep.\n\nAt the end of your reply, before any last verdict line, add one "
            "line for each codeintel query you ran, so the run can judge the tool:\n\n"
            "    codeintel: <op> <target>: helped | no answer | wrong: <what it got wrong>\n" % (ops, ask))


# ---- what a run's transcripts say about codeintel, for eval ----------------------------

def use(records):
    """{"queries": {op: n}, "said": {verdict: n}, "wrong": [...]} from transcript records (dicts), or None
    when codeintel was never asked."""
    queries, said, wrong, seen = {}, {}, [], set()
    for item in records:
        message = item.get("message") if isinstance(item, dict) else None
        blocks = message.get("content") if isinstance(message, dict) else None
        if not isinstance(blocks, list):
            continue
        for block in blocks:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                op = _asked(block)
                if op and ("tool", block.get("id")) not in seen:
                    seen.add(("tool", block.get("id")))
                    queries[op] = queries.get(op, 0) + 1
            elif block.get("type") == "text" and "codeintel:" in str(block.get("text")):
                for line in str(block["text"]).splitlines():
                    found = LINE.match(line)
                    if not found or ("line", line.strip()) in seen:
                        continue
                    seen.add(("line", line.strip()))
                    op, target, verdict, why = found.groups()
                    said[verdict] = said.get(verdict, 0) + 1
                    if verdict == "wrong" and len(wrong) < 20:
                        wrong.append({"op": op, "target": target.strip("`"), "why": why.strip()})
    if not queries and not said:
        return None
    return {"queries": queries, "said": said, "wrong": wrong}


def _asked(block):
    """The op of a codeintel query made by this tool call, "" when it is not one."""
    name = str(block.get("name") or "")
    args = block.get("input") if isinstance(block.get("input"), dict) else {}
    if "codeintel" in name.lower():
        return str(args.get("op") or name.rsplit("__", 1)[-1])
    found = QUERY.search(str(args.get("command") or ""))
    return found.group(1) if found else ""


def keep_lines(path, key, text):
    """Append the `codeintel:` lines in text (the scouts' replies for the phase named key) to path, once each, so eval
    can count them after the scout files are cleared."""
    found = ["%s\t%s" % (key, line.strip()) for line in text.splitlines() if LINE.match(line)]
    if not found:
        return
    try:
        have = set(path.read_text(encoding="utf-8").splitlines())
    except OSError:
        have = set()
    new = [line for line in found if line not in have]
    if new:
        with open(str(path), "a", encoding="utf-8") as handle:
            handle.write("\n".join(new) + "\n")


def kept(path):
    """{"queries": {op: n}, "said": {verdict: n}, "wrong": [...]} from the lines keep_lines kept, or None."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    queries, said, wrong = {}, {}, []
    for line in lines:
        found = LINE.match(line.split("\t", 1)[-1])
        if not found:
            continue
        op, target, verdict, why = found.groups()
        queries[op] = queries.get(op, 0) + 1
        said[verdict] = said.get(verdict, 0) + 1
        if verdict == "wrong" and len(wrong) < 20:
            wrong.append({"op": op, "target": target.strip("`"), "why": why.strip()})
    return {"queries": queries, "said": said, "wrong": wrong} if said else None


def merge(first, second):
    """Two use() results as one; the scout lines kept in state count where the transcripts missed them."""
    if not first or not second:
        return first or second
    out = {"queries": dict(first["queries"]), "said": dict(first["said"]), "wrong": list(first["wrong"])}
    for key in ("queries", "said"):
        for name, n in second[key].items():
            out[key][name] = max(out[key].get(name, 0), n)
    out["wrong"] += [w for w in second["wrong"] if w not in out["wrong"]][:20 - len(out["wrong"])]
    return out
