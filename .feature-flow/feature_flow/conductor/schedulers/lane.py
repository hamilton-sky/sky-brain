"""Lanes: tickets side by side in their own worktrees. A passed ticket waits in the merge phase and is merged into
the feature branch, in the integration worktree, before a new ticket is leased."""

from feature_flow import checks, gate, git, lanes, state, tickets
from feature_flow.conductor import checkpoint, guards
from feature_flow.conductor.errors import Stop
from feature_flow.conductor.phases import REGISTRY
from feature_flow.conductor.phases.build import Build
from feature_flow.conductor.phases.final import Final
from feature_flow.conductor.phases.merge import Merge
from feature_flow.conductor.phases.review import Review
from feature_flow.conductor.phases.test import Test
from feature_flow.conductor.schedulers.serial import SerialScheduler
from feature_flow.conductor.settings import MAX_LANES, mode_ok
from feature_flow.conductor.store import NOTE_SEP
from feature_flow.conductor.workspace import INTEGRATION, LANE, Workspace


class LaneScheduler(SerialScheduler):
    lanes = True

    def next(self, lane=None):
        return self.lane_next(lane)

    def on_passed(self, ws):
        """Queue the merge: None tells lane_next to dispatch, which merges it."""
        Merge.queue(ws)
        return None

    def resume(self):
        return self.dispatch()

    def finish(self):
        return self.end.finish()

    def lane_dir(self, lane):
        return lanes.lane_path(self.c.top, self.c.feature, lane)

    def workspace(self, k):
        """Lane k's Workspace, over its worktree; a STOP when the worktree is gone."""
        path = self.lane_dir(k)
        if not lanes.is_worktree(self.c.top, path):
            raise Stop("lane %d (%s) is gone. run reset to drop the lanes and start again" % (k, path))
        return Workspace(self.c, LANE, k, path)

    def lane_number(self, lane, command):
        c = self.c
        if lane is None:
            raise Stop("%s needs the lane: this run has %d lanes. pass the lane from the BUILD or REVIEW line"
                       % (command, c.num("lanes")))
        if not lane.isdigit() or not 1 <= int(lane) <= c.num("lanes"):
            raise Stop("no lane %s: this run has lanes 1 to %d" % (lane, c.num("lanes")))
        return int(lane)

    def lane_key(self, lane, key):
        return self.c.all.get("L%d.%s" % (lane, key), "")

    def busy_lanes(self):
        """The lanes that hold a ticket: built, in review, or passed and waiting for their merge."""
        return [k for k in range(1, MAX_LANES + 1) if self.lane_key(k, "phase") in ("build", "review", "ask", "merge")]

    def lane_next(self, lane):
        """`next` with lanes. With a lane: judge the phase that lane just finished. Then, or without a lane,
        merge what passed, lease ready tickets to free lanes, and hand out the next phase."""
        c = self.c
        mode_ok("lanes_relay", lanes=c.num("lanes"), relay=c.relay)
        if not c.plan.is_dir():
            raise Stop("no plan folder %s" % c.plan)
        if "limit" not in c.all:
            c.all["limit"] = c.run_limit()
            c.all.setdefault("runs", 0)
            c.all.setdefault("done", 0)
        if lane is None:
            return self.dispatch()
        k = self.lane_number(lane, "next")
        line = None
        with self.workspace(k).entered() as ws:
            if ws.get("restore"):
                try:
                    git._git("checkout", "-q", ws.get("restore"), cwd=ws.folder)
                except RuntimeError as err:
                    raise Stop("cannot put lane %d back after the test first check: %s. run `git checkout %s` in %s "
                               "by hand" % (k, err, ws.get("restore"), ws.folder.resolve()))
                ws.st["restore"] = ""
                ws.save()
            phase = ws.get("phase")
            if phase in ("build", "review", "ask"):
                name = lanes.branch(c.feature, ws.get("num"))
                on = git._git("symbolic-ref", "-q", "--short", "HEAD", check=False, cwd=ws.folder).stdout.strip()
                if on != name:
                    raise Stop("lane %d is on %s, not on its ticket's branch %s. a builder or reviewer must not switch "
                               "it. run reset to drop the lanes" % (k, on or "a detached HEAD", name))
            if phase in ("build", "review", "ask"):
                line = REGISTRY[phase].judge(ws).line
        return line if line is not None else self.dispatch()

    def dispatch(self):
        """Merge a passed ticket, else lease the next ticket that may run beside the busy ones, else say what to
        wait for, hand off, or finish."""
        c = self.c
        for k in self.busy_lanes():
            if self.lane_key(k, "phase") == "merge":
                return self.integrate(k)
        dirty = git.changes()
        if dirty:
            raise Stop("the main worktree is not clean, and only merges may change it while lanes run: %s"
                       % " ".join(dirty[:5]))
        busy = self.busy_lanes()
        if checkpoint.due(c):  # every N tickets: no new lease until the busy lanes are merged, then the checkpoint
            if busy:
                return c.emit("WAIT %s" % ",".join(map(str, busy)))
            if checkpoint.run(c) == checkpoint.PASSED:
                return Final.hand_out(c)
        if not busy and self.end.tests_due():
            guards.before_ticket(c, busy, only=("base",))
            return Test.hand_out(c)
        check = checks.flow_status(c.scripts, c.feature, "--check")
        if not check.ok:
            raise Stop("ticket check failed, fix the tickets first")
        ready = checks.flow_status(c.scripts, c.feature, "--ready")
        if ready.code not in (0, 10, 11):
            raise Stop("flow-status.py failed with exit code %d" % ready.code)
        line = guards.before_ticket(c, busy, only=("session",))
        if line is not None:
            return line
        leased = {self.lane_key(k, "ticket") for k in busy}
        running = [self.footprint(self.lane_key(k, "ticket")) for k in busy]
        shared = lanes.touches("Touches: " + tickets.commands_text_value(c.show_head(c.commands), "Shared")) or []
        free = [k for k in range(1, c.num("lanes") + 1) if k not in busy]
        if ready.code == 0 and free:
            guards.before_ticket(c, busy, only=("replan", "budget", "base"))  # with busy lanes: no re-plan check, no offer
            for path in ready.out.strip().splitlines():
                if path in leased:
                    continue
                if lanes.side_by_side(self.footprint(path), running, shared):
                    return self.lease(free[0], path)
        if busy:
            return c.emit("WAIT %s" % ",".join(map(str, busy)))
        if ready.code == 10:
            return self.finish()
        raise Stop("stuck: unfinished tickets remain but none is ready. run: python3 scripts/flow-status.py %s"
                   % c.feature)

    def lease(self, k, path):
        """Give the ticket at path to lane k on a fresh branch from the feature head, and hand out its build."""
        c = self.c
        head = git.head()
        self.make_worktree(Workspace(c, LANE, k, self.lane_dir(k)), "lane-%d" % k)
        with self.workspace(k).entered() as ws:
            ws.st.clear()
            dirty = git.changes(cwd=ws.folder)
            if dirty:
                raise Stop("lane %d is not clean: %s. run reset to drop the lanes" % (k, " ".join(dirty[:5])))
            try:
                lanes.git_in(ws.folder, "checkout", "-q", "-B", lanes.branch(c.feature, tickets.number(path)), head)
            except RuntimeError as err:
                raise Stop("cannot put lane %d on a branch for %s: %s" % (k, tickets.name(path), err))
            self.start_ticket(path, ws)
            ws.log("LEASE-%d" % k)
            return Build.hand_out(ws)

    def make_worktree(self, ws, name):
        """Create the worktree of ws when it is not there, and run commands.md's Setup in it once."""
        c = self.c
        path = ws.folder
        try:
            lanes.ensure(c.top, path)
        except RuntimeError as err:
            raise Stop("cannot create the %s worktree: %s" % (name, err))
        marker = path.with_name(path.name + ".ready")
        if marker.is_file():
            return
        cmd = tickets.commands_value(c.commands, "Setup")
        if cmd:
            result = checks.smoke(cmd, c.gate_timeout, cwd=path)
            if not result.ok:
                raise Stop("Setup failed in the %s worktree (%s): %s. the last lines: %s"
                           % (name, path, cmd, " ".join(gate.tail(result.out, 5).split())[:300]))
        marker.write_text("set up\n", encoding="utf-8")

    def merge_gate(self, ws):
        """True when a merge is gated: with the gate on, and at a checkpointed gate only when there is a Quick
        command to run (the full gate is the checkpoint's)."""
        return self.c.gate_on and (ws.has_quick() or not self.c.checkpointing())

    def integrate(self, k):
        """Merge lane k's passed ticket into the feature head in the integration worktree, gate the merge, and
        fast-forward the feature branch to it. A conflict or a red gate rebuilds the ticket on the new head."""
        c = self.c
        head = git.head()
        num, path = self.lane_key(k, "num"), self.lane_key(k, "ticket")
        name = lanes.branch(c.feature, num)
        if str(self.lane_key(k, "level")) == "3" and self.lane_key(k, "base") != head:
            return self.refresh(k, head)
        ws = Workspace(c, INTEGRATION, 0, lanes.integrate_path(c.top, c.feature))
        self.make_worktree(ws, "integration")
        with ws.entered():
            problem, report = self.merge_in_place(ws, name, head, "merge(%s): %s %s" % (
                c.feature, num, tickets.title(ws.at(path)) or tickets.name(path)))
            merged = git.head(cwd=ws.folder)
            if problem is None and self.merge_gate(ws):
                quick = True if c.checkpointing() else ws.gate_quick()
                result = checks.gate(c.scripts, c.feature, c.gate_timeout, quick=quick, cwd=ws.folder)
                ws.log("MERGE-GATE-%s-%s" % ("QUICK" if quick else "FULL", "PASS" if result.ok else "FAIL"))
                if not result.ok:
                    problem, report = "the gate on its merge failed", result.out
        if problem is not None:
            return self.rebuild(k, problem, report)
        try:
            git._git("merge", "-q", "--ff-only", merged)
            lanes.git_in(self.lane_dir(k), "checkout", "-q", "--detach")
            git._git("branch", "-q", "-d", name)
        except RuntimeError as err:
            raise Stop("cannot move the feature branch to the merge of %s: %s" % (tickets.name(path), err))
        for key in [key for key in c.all if key.startswith("L%d." % k)]:
            del c.all[key]
        c.all["done"] = c.num("done") + 1
        c.all["session_done"] = c.num("session_done") + 1
        c.save()
        state.log(c.log_file, num, "MERGED-%d" % k)
        return self.dispatch()

    def merge_in_place(self, ws, name, head, message):
        """Merge branch name into head in ws's worktree (a lane or the integration worktree), resolving only appends
        to the plan's append-only files. Returns (None, "") on success, else (what went wrong, a report), with the
        merge undone."""
        where = ws.folder
        git._git("merge", "--abort", check=False, cwd=where)
        git._git("reset", "-q", "--hard", check=False, cwd=where)
        try:
            git._git("checkout", "-q", "--detach", head, cwd=where)
        except RuntimeError as err:
            raise Stop("cannot reset the %s worktree: %s" % (where.resolve(), err))
        dirty = git.changes(cwd=where)
        if dirty:
            raise Stop("the worktree %s is not clean after a reset: %s. something left files there; remove them or "
                       "run reset" % (where.resolve(), " ".join(dirty[:5])))
        result = git._git("merge", "--no-ff", "--no-edit", "-m", message, name, check=False, cwd=where)
        if result.returncode == 0:
            return None, ""
        left = lanes.resolve_appends(where, ws.plan.as_posix()) if lanes.unmerged(where) else ["(git merge failed)"]
        if not left and git._git("commit", "-q", "--no-edit", check=False, cwd=where).returncode == 0:
            ws.log("MERGE-APPENDS")
            return None, ""
        git._git("merge", "--abort", check=False, cwd=where)
        return "it conflicted with the feature branch", (
            "git merge reported conflicts in: %s\n%s" % (", ".join(left), (result.stdout + result.stderr).strip()))

    def refresh(self, k, head):
        """A level 3 ticket whose base is behind the feature head: merge the feature head into its branch, gate it
        in the lane, and review it again on top of the code its reviewer never saw."""
        c = self.c
        with self.workspace(k).entered() as ws:
            name = lanes.branch(c.feature, ws.get("num"))
            problem, report = self.merge_in_place(ws, name, head, "merge(%s): %s onto the feature branch for its "
                                                  "review" % (c.feature, ws.get("num")))
            if problem is None:
                lanes.git_in(ws.folder, "checkout", "-q", "-B", name, "HEAD")
                if self.merge_gate(ws):
                    quick = True if c.checkpointing() else ws.gate_quick()
                    result = checks.gate(c.scripts, c.feature, c.gate_timeout, quick=quick, cwd=ws.folder)
                    ws.log("REFRESH-GATE-%s-%s" % ("QUICK" if quick else "FULL", "PASS" if result.ok else "FAIL"))
                    if not result.ok:
                        problem, report = "the gate failed on top of the feature branch", result.out
            if problem is None:
                moved = ws.get("base")
                ws.st["base"] = head
                ws.st["review_pass"] = "quality"
                ws.st["review_attempt"] = 0
                ws.st["review_notes"] = NOTE_SEP.join([n for n in (
                    ws.get("level_note"),
                    "the feature branch moved since this level 3 ticket was built (from %s to %s), so it is reviewed "
                    "again on top of it. the diff from the base below to HEAD is this ticket's change on the feature "
                    "branch as it is now: probe it against what the other tickets added" % (moved[:12], head[:12]))
                    if n])
                ws.log("REFRESH")
                return Review.hand_out(ws)
        return self.rebuild(k, problem, report)

    def rebuild(self, k, problem, report):
        """Build lane k's ticket again from the feature head, with what went wrong in the ticket. Once only."""
        c = self.c
        head = git.head()
        with self.workspace(k).entered() as ws:
            path, num = ws.ticket(), ws.get("num")
            if ws.num("rebuilds") >= 1:
                raise Stop("%s passed its review but %s, and it was rebuilt once already. its Touches line is likely "
                           "wrong: fix the plan, then run reset %s" % (ws.ticket_name(), problem, num))
            name = lanes.branch(c.feature, num)
            tip = lanes.git_in(ws.folder, "rev-parse", name).stdout.strip()
            base = ws.get("base")
            git._git("merge", "--abort", check=False, cwd=ws.folder)
            git._git("reset", "-q", "--hard", check=False, cwd=ws.folder)
            try:
                lanes.git_in(ws.folder, "checkout", "-q", "-B", name, head)
            except RuntimeError as err:
                raise Stop("cannot reset lane %d for the rebuild of %s: %s" % (k, ws.ticket_name(), err))
            ws.st.clear()
            self.start_ticket(path, ws)
            ws.st["rebuilds"] = 1
            tickets.append_section(ws.at(path), "Rebuild (%s)" % problem, (
                "This ticket was built and passed its review in a lane, but %s. It is built again from the feature "
                "branch as it is now. The earlier build is commit %s (its base was %s): reuse what still fits, "
                "for example with `git diff %s %s`.\n\n%s" % (problem, tip, base, base, tip, gate.tail(report, 60))))
            tickets.set_open(ws.at(path))
            if not git.commit_file(path, "chore(%s): %s rebuild after its merge" % (c.feature, num), cwd=ws.folder):
                raise Stop("cannot commit the rebuild note to %s. this session must be allowed to run git commit"
                           % ws.ticket_name())
            ws.log("REBUILD")
            return Build.hand_out(ws)

    def drop_lanes(self):
        """For reset: remove the feature's lane worktrees and delete its ticket branches. Returns what it did."""
        c = self.c
        done = []
        gone = lanes.remove_all(c.top, c.feature)
        if gone:
            done.append("removed the worktrees %s" % ", ".join(gone))
        names = lanes.branches(c.top, c.feature)
        for name in names:
            git._git("branch", "-q", "-D", name, check=False)
        if names:
            done.append("deleted the branches %s" % ", ".join(names))
        return done
