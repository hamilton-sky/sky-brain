"""Batches: in fast mode one builder builds a few small tickets, one commit range each. A serial run whose
next ticket may take others with it; whether it does is decided per ticket, since fast mode can switch on
(through the budget) in the same call."""

import re

from feature_flow import checks, git, lanes, proof, tickets
from feature_flow.conductor import buildchecks
from feature_flow.conductor.errors import Stop
from feature_flow.conductor.phases.ask import Ask
from feature_flow.conductor.phases.build import Build
from feature_flow.conductor.schedulers.serial import SerialScheduler
from feature_flow.conductor.settings import mode_ok


class BatchScheduler(SerialScheduler):
    def begin(self, first):
        """Start the ticket at first, give its builder the tickets it may build with it, hand out the build."""
        c = self.c
        self.start_ticket(first)
        more = self.batch_for(first)
        if more:
            c.st["batch"] = " ".join(more)
            c.log("BATCH %d" % (len(more) + 1))
        return Build.hand_out(c)

    def batch_for(self, first):
        """The ready tickets the builder of first also builds, in order, or [] for none. Only in fast mode
        with the gate on, no lanes and no relay. Each one is level 1 or 2 (never raised), has a `Touches:`
        line, and touches nothing another ticket of the batch, a `Sensitive:` path or a `Shared:` path touches:
        a ticket on a Shared path is built alone, as in lanes."""
        c = self.c
        size = c.batch_size
        if c.per_session > 0:
            size = min(size, c.per_session - c.num("session_done"))
        if not mode_ok("batch", size=size, fast_mode=c.fast(), gate_on=c.gate_on, relay=c.relay,
                       lanes=c.num("lanes")):
            return []
        sensitive = tickets.sensitive_patterns(c.show_head(c.commands))
        shared = lanes.touches("Touches: " + tickets.commands_text_value(c.show_head(c.commands), "Shared")) or []
        chosen = []
        alone = c.all.get("no_batch", "").split()
        for path in [first] + [p for p in checks.flow_status(c.scripts, c.feature, "--ready").out.split()
                               if p != first]:
            touched, level = self.footprint(path)
            if (touched is None or level not in (1, 2) or not lanes.disjoint(touched, sensitive)
                    or lanes.touches_shared(touched, shared) or tickets.number(path) in alone):
                if path == first:
                    return []
                continue
            if all(lanes.disjoint(touched, other) for _, other in chosen):
                chosen.append((path, touched))
            if len(chosen) == size:
                break
        return [path for path, _ in chosen[1:]]

    def batch_note(self):
        """What the builder of a batch is told on top of the build guide for the first ticket."""
        c = self.c
        rest = c.get("batch").split()
        return ("This build is a batch of %d small tickets: `%s` (above), then %s. Build them one at a time, in this "
                "order, each exactly as the guide says for one ticket, with that ticket's path and number in place of "
                "the first one's: finish one completely (its commits, its Status set to resolved, its Answer) before "
                "you start the next, and never put two tickets in one commit. The conductor checks each ticket on its "
                "own commits. If one cannot be finished, set it back to open with an Attempt note and stop: do not "
                "start the next. Reply with what you built for each ticket."
                % (len(rest) + 1, c.ticket(), ", ".join("`%s`" % p for p in rest)))

    def ticket_ends(self, paths):
        """[(path, the commit that resolved it, or None)], walking base..HEAD in order: a ticket's commits
        follow the last resolved ticket's."""
        commits = git._git("rev-list", "--reverse", "%s..HEAD" % self.c.get("base")).stdout.split()
        out, at = [], 0
        for path in paths:
            rel = proof.repo_relative(path)
            end = None
            for i in range(at, len(commits)):
                try:
                    text = git.show_text("%s:%s" % (commits[i], rel))
                except RuntimeError:
                    continue
                if re.search(r"^Status:[ \t]*(%s)\b" % "|".join(tickets.DONE), "\n".join(text.splitlines()[:20]),
                             re.MULTILINE | re.IGNORECASE):
                    end, at = commits[i], i + 1
                    break
            out.append((path, end))
        return out

    def judge_batch(self):
        """Judge every ticket of a batch on its own commits: the gate once at HEAD (each ticket's end only when
        that fails, to find the first that broke it), then the floor guard, the footprint, Done when and test
        first with HEAD detached at the ticket's last commit. A ticket that passes is deferred to the feature
        review; one that fails is reopened with its findings, to be built again alone."""
        c = self.c
        paths = [c.ticket()] + c.get("batch").split()
        c.st["batch"] = ""
        if not git.is_clean():
            raise Stop("working tree is dirty after the batch of %s, it should have been committed" % c.ticket_name())
        home = git._git("symbolic-ref", "-q", "--short", "HEAD", check=False).stdout.strip()
        if not home:
            raise Stop("HEAD is detached after the batch of %s. a builder must not switch branches" % c.ticket_name())
        ends = self.ticket_ends(paths)
        built = [(path, end) for path, end in ends if end]
        # a checkpointed gate runs only Quick here (nothing without a Quick command): the full gate is the checkpoint's
        quick = True if c.checkpointing() else c.gate_quick()
        gated = built and (c.has_quick() or not c.checkpointing())
        gate = checks.gate(c.scripts, c.feature, c.gate_timeout, quick=quick) if gated else None
        if gated:
            c.log("GATE-PASS" if gate.ok else "GATE-FAIL")
        broke = None
        results = []
        start = c.get("base")
        c.st["batch_restore"] = home
        c.save()
        try:
            for path, end in built:
                git._git("checkout", "-q", "--detach", end)
                c.st.update({"ticket": path, "num": tickets.number(path), "base": start, "due_checks": "",
                             "level_note": ""})
                c.st["level"] = c.base_level()
                failure = None
                if gate is not None and not gate.ok and broke is None:
                    result = checks.gate(c.scripts, c.feature, c.gate_timeout, quick=quick)
                    if not result.ok:
                        broke, failure = path, ("gate", result.out)
                if failure is None:
                    source, report, _ = buildchecks.run(c, buildchecks.pipeline(c, gate=False))
                    failure = (source, report) if source else None
                if failure is None and c.measure_level() >= 3:
                    failure = ("batch", "%s: a batch cannot defer its review, so build it alone"
                               % c.get("level_note"))
                results.append((path, start, failure, c.get("due_checks")))
                start = end
        finally:
            git._git("checkout", "-q", home)
            c.st["batch_restore"] = ""
            c.save()
        if gate is not None and not gate.ok and broke is None:  # it fails at HEAD but at no ticket's end: blame the last one
            path, base, _, due = results[-1]
            results[-1] = (path, base, ("gate", gate.out), due)
        for path, base, failure, due in results:
            c.st.update({"ticket": path, "num": tickets.number(path), "base": base, "due_checks": due,
                         "due_minors": ""})
            if failure:
                c.log("BATCH-FAIL")
                c.all["no_batch"] = " ".join(c.all.get("no_batch", "").split() + [c.get("num")])
                tickets.append_findings(path, 1, failure[0], failure[1])
                tickets.set_open(path)
                if not git.commit_file(path, "chore(%s): %s back to open from its batch" % (c.feature, c.get("num"))):
                    raise Stop("cannot commit %s. this session must be allowed to run git commit" % path)
                continue
            c.write_due("%s (left for later)" % c.ticket_name())
            items = [i for i in c.all.get("deferred", "").split() if not i.startswith(c.get("num") + ":")]
            c.all["deferred"] = " ".join(items + ["%s:%s" % (c.get("num"), base)])
            c.log("REVIEW-DEFERRED")
            c.st["done"] = c.num("done") + 1
            c.st["session_done"] = c.num("session_done") + 1
        left = [path for path, end in ends if not end]  # the builder stopped before these: each is built alone
        for path in left:
            c.all["no_batch"] = " ".join(c.all.get("no_batch", "").split() + [tickets.number(path)])
            if tickets.status(path) not in ("open", "parked", "wontfix"):
                tickets.set_open(path)
        if left and git.changes():
            git.commit_paths(left, "chore(%s): %s back to open, not built in the batch"
                             % (c.feature, ", ".join(tickets.number(p) for p in left)))
        c.st["phase"] = ""
        c.save()
        if left:  # the builder stopped on a question: ask it now, then build that ticket alone
            line = self.route_ask(left[0])
            if line is not None:
                return line
        return self.resume()

    def route_ask(self, path):
        """The ASK line for a `## Ask: <role>` the builder of a batch left in the ticket it stopped on, with that
        ticket started fresh at HEAD; None when it left no question."""
        c = self.c
        c.st.update({"ticket": path, "num": tickets.number(path)})
        role, _ = Ask.open_ask(c)
        if not role:
            return None
        self.start_ticket(path)
        role, question = Ask.open_ask(c)
        c.st["attempt"] = 1  # as if its own build had been handed out: the question is not a failed attempt
        c.log("BATCH-ASK")
        return Ask.hand_out(c, "build", role, question)
