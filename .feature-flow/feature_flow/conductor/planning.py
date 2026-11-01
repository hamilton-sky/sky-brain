"""The planning commands: stateless, the brief and the draft are all there is.

The facade's methods of the same names forward here, with the run's paths and settings.
"""

import os
import shutil
from pathlib import Path

from feature_flow import brainstorm_mode, checks, prompts, scouts, state
from feature_flow.conductor.errors import NoPhase, Stop
from feature_flow.conductor.phases.base import lane_runner


BRAINSTORM = "brainstorm.md"  # the user's chosen approach, copied from the state folder into the draft and the plan
LENSES = brainstorm_mode.LENSES  # guides/lenses/<name>.md
HELPERS = dict({"scout": "scout", "web": "scout", "architect": "consult", "designer": "consult", "po": "consult",
                "skeptic": "skeptic"}, **{lens: "lens" for lens in LENSES})  # a brainstorm helper and its limit's group


def one_scout(c, found, k, workdir=None, top="."):
    """The whole prompt of scout k of found: a phase's scouts (the facade's scout_prompt) or the plan's."""
    if not k.isdigit() or not 1 <= int(k) <= len(found):
        raise Stop("no scout %s: there are %d" % (k, len(found)))
    agent, role, question = found[int(k) - 1]
    try:
        role_text = prompts.role(c.scripts, agent + ".md", top)
    except FileNotFoundError as err:
        raise Stop(str(err))
    if workdir is not None:  # a lane's scout: its role text as prompts gave it from the lane's folder
        role_text = lane_runner(role_text, c.scripts)
    return scouts.prompt(role_text, role, question, workdir, codeintel=agent == "flow-scout" and c.settings.scout_code != "light",
                         top=top)


class Planner:
    def __init__(self, conductor):
        """The paths and settings the plan commands read, taken from the conductor; log stays its own."""
        self.feature = conductor.feature
        self.scripts = conductor.scripts
        self.plan = conductor.plan
        self.draft_root = conductor.draft_root
        self.draft = conductor.draft
        self.brief_file = conductor.brief_file
        self.brainstorm_file = conductor.brainstorm_file
        self.state_file = conductor.state_file
        self.scouts_on = conductor.scouts_on
        self.settings = conductor.settings
        self.scout_code = conductor.settings.scout_code
        self.scout_web = conductor.settings.scout_web
        self.brainstorm_type = conductor.settings.brainstorm_type
        self.brainstorm_helpers = conductor.settings.brainstorm_helpers
        self.log = conductor.log

    def consult_prompt(self, role, question_file):
        """A consultant's prompt for a question the planner raised. Stateless, like the other plan commands."""
        self.no_plan_yet()
        if "ask-" + role not in prompts.ROLES:
            raise Stop("consult takes architect, designer or po, not %s" % role)
        question = self.read_text(question_file, "question").strip("\n")
        if not question:
            raise Stop("the question %s is empty" % question_file)
        if self.brief_file.is_file():
            source = ("the planner of the feature `%s`, who is drafting its plan from the brief in `%s`. Read the brief "
                      "and the repository." % (self.feature, self.brief_file.as_posix()))
        else:
            source = ("the brainstorm before the feature `%s` is planned: the user is choosing how to build it, and no "
                      "brief is written yet. Read the repository; the question says what is being weighed." % self.feature)
        task = ("Your question comes from %s\n\nThe question:\n\n%s\n\nDo not edit any file. Your final reply must end "
                "with exactly `ANSWER: GIVEN` or `ANSWER: USER`." % (source, question))
        try:
            role_text = prompts.role(self.scripts, prompts.ROLES["ask-" + role])
        except FileNotFoundError as err:
            raise Stop(str(err))
        self.log("CONSULT-%s" % role.upper())
        return "%s\n\n---\n\n%s\n" % (role_text, task)

    def asked(self, stop):
        """Logs that the session stopped to ask the user at one of the guided flow's three stops, for eval."""
        if stop not in brainstorm_mode.STOPS:
            raise Stop("asked takes %s, not %s" % (", ".join(brainstorm_mode.STOPS), stop))
        self.log("GUIDED-%s" % stop.upper())
        return "OK asked %s" % stop

    def brainstorm_prompt(self, helper, question_file):
        """A brainstorm helper's prompt. The script counts the helpers per brainstorm and refuses past the limit."""
        self.no_plan_yet()
        if helper not in HELPERS:
            raise Stop("brainstorm-prompt takes %s, not %s" % (", ".join(HELPERS), helper))
        question = self.read_text(question_file, "question").strip("\n")
        if not question:
            raise Stop("the question %s is empty" % question_file)
        profile = "careful" if os.environ.get("FLOW_PROFILE", "").strip().lower() == "careful" else "normal"
        group = HELPERS[helper] if helper != "web" else "web"
        kind = self.brainstorm_type or "standard"
        caps = brainstorm_mode.limits(profile, {"code": self.scout_code, "web": self.scout_web}, kind)
        limit = caps[group]
        picked = self.brainstorm_helpers
        if picked is not None:
            too_many = brainstorm_mode.over(picked, caps)
            if too_many:
                raise Stop("the brainstorm's Helpers: line picks %d %s helper(s), and %s with type %s allows %d. fix the "
                           "header of the brainstorm of %s" % (too_many[1], too_many[0], profile, kind, too_many[2],
                                                               self.feature))
            if group not in ("scout", "web") and helper not in picked:
                raise Stop("the brainstorm's Helpers: line (%s) does not pick %s. go on without, or add it to the line"
                           % (brainstorm_mode.helpers_text(picked), helper))
        counts_file = self.state_file.parent / ("brainstorm-%s.helpers" % self.feature)
        counts = dict(line.split("=", 1) for line in (state.read_text(counts_file) or "").splitlines() if "=" in line)
        used = int(counts.get(group, "0")) if counts.get(group, "0").isdigit() else 0
        if used >= limit:
            raise Stop("the brainstorm of %s has used its %d %s helper(s) (%s; type %s, scouts code=%s web=%s). go "
                       "on without, or delete %s to start a new brainstorm"
                       % (self.feature, limit, group, profile, kind, self.scout_code, self.scout_web,
                          counts_file.as_posix()))
        try:
            role_text = prompts.role(self.scripts, prompts.ROLES[group if group in ("skeptic", "lens") else
                                                               helper if group in ("scout", "web") else "ask-" + helper])
            lens = prompts.lens(self.scripts, helper) if group == "lens" else ""
        except FileNotFoundError as err:
            raise Stop(str(err))
        about = ("The user's session is brainstorming how to build the feature `%s`, before it is planned: no brief "
                 "and no plan exist yet." % self.feature)
        if group in ("scout", "web"):
            out = scouts.prompt(role_text, "planner", about + "\n\n" + question,
                                codeintel=group == "scout" and self.scout_code != "light")
        elif group == "lens":
            out = ("%s\n\n---\n\nYour lens is `%s`. Its guide follows.\n\n%s\n\n---\n\n%s The options it drafted "
                   "follow. Read the repository.\n\n%s\n\nDo not edit any file. Your final reply must end with exactly "
                   "`LENS: DONE`.\n" % (role_text, helper, lens, about, question))
        elif helper == "skeptic":
            out = ("%s\n\n---\n\n%s The options it drafted follow. Read the repository.\n\n%s\n\nDo not edit any "
                   "file. Your final reply must end with exactly `SKEPTIC: DONE`.\n" % (role_text, about, question))
        else:
            out = ("%s\n\n---\n\nYour question comes from the brainstorm. %s Read the repository.\n\nThe question:"
                   "\n\n%s\n\nDo not edit any file. Your final reply must end with exactly `ANSWER: GIVEN` or "
                   "`ANSWER: USER`.\n" % (role_text, about, question))
        counts[group] = str(used + 1)
        counts_file.write_text("".join("%s=%s\n" % kv for kv in sorted(counts.items())), encoding="utf-8")
        self.log("BRAINSTORM-%s" % helper.upper())
        return out.rstrip("\n")

    def plan_scout_key(self):
        return self.state_file.parent / ("scout-%s-plan.key" % self.feature)

    def save_brief(self, brief):
        """The brief's text, saved where the planner and the plan reviewer read it."""
        self.no_plan_yet()
        text = self.read_text(brief, "brief")
        if not text.strip():
            raise Stop("the brief %s is empty" % brief)
        if Path(brief).resolve() != self.brief_file.resolve():
            self.brief_file.write_text(text, encoding="utf-8")
        return text

    def plan_scouts(self, brief):
        """The scouts before planning: saves the brief and lists `SCOUT` lines as `scouts` does."""
        text = self.save_brief(brief)
        folder = self.state_file.parent
        scouts.clear(folder, self.feature, "plan")
        found = self.plan_scout_list(text)
        self.plan_scout_key().write_text(scouts.brief_key(text) + "\n", encoding="utf-8")
        self.log("PLAN-SCOUTS")
        return scouts.listing(folder, self.feature, "plan", found)

    def plan_scout_prompt(self, k):
        self.no_plan_yet()
        key = state.read_text(self.plan_scout_key())
        text = self.read_text(self.brief_file, "brief") if self.brief_file.is_file() else None
        if not self.scouts_on or text is None or key is None or key.strip() != scouts.brief_key(text):
            raise NoPhase("run plan-scouts first: no scouts are listed for the brief of %s" % self.feature)
        return one_scout(self, self.plan_scout_list(text), k)

    def plan_scout_list(self, text):
        return scouts.by_level(scouts.plan(text), self.scout_code, self.scout_web) if self.scouts_on else []

    def no_plan_yet(self):
        if self.plan.is_dir():
            raise Stop("%s already exists. pick another name: a plan is never overwritten" % self.plan.as_posix())

    def draft_text(self):
        return self.draft.as_posix() + "/"

    def read_text(self, path, what):
        try:
            return Path(path).read_text(encoding="utf-8", errors="replace")
        except OSError as err:
            raise Stop("cannot read the %s %s: %s" % (what, path, err.strerror))

    def plan_prompt(self, brief, findings=None):
        """The feature-planner's prompt. Saves the brief; a first round (no findings) starts an empty draft."""
        text = self.save_brief(brief)
        notes = self.read_text(findings, "review findings") if findings else ""
        if not findings and self.draft.is_dir():
            if self.draft.resolve().parent != self.draft_root.resolve():
                raise Stop("the draft folder %s is outside %s" % (self.draft_text(), self.draft_root.as_posix()))
            shutil.rmtree(str(self.draft))
        (self.draft / (os.environ.get("FLOW_TICKETS") or "tasks")).mkdir(parents=True, exist_ok=True)
        brainstorm = self.brainstorm_for(text)
        if brainstorm:
            shutil.copyfile(str(self.brainstorm_file), str(self.draft / BRAINSTORM))  # again on a findings round
        self.log("PLAN-PROMPT")
        try:
            found = ""
            key = state.read_text(self.plan_scout_key())
            if not findings and key is not None and key.strip() == scouts.brief_key(text):
                found = scouts.section(self.state_file.parent, self.feature, "plan", len(self.plan_scout_list(text)))
            return prompts.plan("plan", self.scripts, self.feature, self.draft_text(), text, notes,
                                brainstorm) + found
        except FileNotFoundError as err:
            raise Stop(str(err))

    def brainstorm_for(self, text):
        """True when the brief names the brainstorm on its `Brainstorm:` line; it must be this feature's file."""
        line = next((l for l in text.splitlines() if l.startswith("Brainstorm:")), None)
        name = (line or "")[len("Brainstorm:"):].strip().strip("`")
        if not name or name.startswith("<"):
            return False
        if Path(name).resolve() != self.brainstorm_file.resolve():
            raise Stop("the brief's Brainstorm: line must name %s, not %s" % (self.brainstorm_file.as_posix(), name))
        if not self.brainstorm_file.is_file():
            raise Stop("the brief names the brainstorm %s, which does not exist. write it as the brainstorm guide "
                       "says, or drop the Brainstorm: line" % self.brainstorm_file.as_posix())
        return True

    def plan_review_prompt(self):
        """The plan-reviewer's prompt: the saved brief and the draft, nothing from the planner."""
        self.no_plan_yet()
        if not self.brief_file.is_file():
            raise Stop("no brief for %s. run plan-prompt first" % self.feature)
        if not self.draft.is_dir():
            raise Stop("no draft plan in %s. run the planner first" % self.draft_text())
        self.log("PLAN-REVIEW-PROMPT")
        try:
            return prompts.plan("plan-review", self.scripts, self.feature, self.draft_text(),
                                self.read_text(self.brief_file, "brief"),
                                brainstorm=(self.draft / BRAINSTORM).is_file())
        except FileNotFoundError as err:
            raise Stop(str(err))

    def plan_accept(self):
        """Copy a draft that passes the check into the plan folder. Never overwrites, never commits."""
        self.no_plan_yet()
        if not self.draft.is_dir():
            raise Stop("no draft plan in %s. run the planner first" % self.draft_text())
        check = checks.flow_status(self.scripts, self.feature, "--lint", root=self.draft_root)
        if not check.ok:
            raise Stop("the draft fails the plan check, fix it first: %s"
                       % " ".join(check.out.split())[:400])
        self.plan.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(str(self.draft), str(self.plan))
        check = checks.flow_status(self.scripts, self.feature, "--check")
        if not check.ok:
            raise Stop("the accepted plan in %s fails the plan check: %s"
                       % (self.plan.as_posix(), " ".join(check.out.split())[:400]))
        self.log("PLAN-ACCEPT")
        return "OK %s" % self.plan.as_posix()
