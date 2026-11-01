"""Finds Forkboard, the review page feature-flow's brainstorm uses (packages/forkboard/ in this repository).

It sits in one of three places: feature_flow/_forkboard/ (a repo or home install, and the installed package),
packages/forkboard/forkboard/ beside feature_flow/ (a checkout, or the Claude Code plugin), or wherever Python
finds an installed forkboard (pip install forkboard). The first two are loaded by path, as feature_flow itself is,
so a run under python3 -I finds them too.
"""

import importlib
import importlib.util
import sys
from pathlib import Path

MAJOR = "bundle/1"  # the review document format this feature-flow writes


def load():
    """The forkboard package, or None when there is none or it reads another major of the document format."""
    module = sys.modules.get("forkboard")
    if module is None:
        here = Path(__file__).resolve().parent
        for folder in (here / "_forkboard", here.parent / "packages" / "forkboard" / "forkboard"):
            if (folder / "__init__.py").is_file():
                spec = importlib.util.spec_from_file_location("forkboard", str(folder / "__init__.py"),
                                                              submodule_search_locations=[str(folder)])
                module = importlib.util.module_from_spec(spec)
                sys.modules["forkboard"] = module
                try:
                    spec.loader.exec_module(module)
                except Exception:
                    del sys.modules["forkboard"]
                    raise
                break
        else:
            try:
                module = importlib.import_module("forkboard")
            except ImportError:
                return None
    if str(getattr(module, "SCHEMA", "")).split(".")[0] != MAJOR:
        return None
    for name in ("doc", "graph", "page", "live"):
        importlib.import_module("forkboard." + name)
    return module


MISSING = ("forkboard is not here, so there is no review page: reinstall feature-flow (install.py or "
           "pip install -U feature-flow-cli), or pip install forkboard\n")
