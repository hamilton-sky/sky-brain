# Prove the bar on a fresh clone and say what now works

Type: task
Status: open
Blocked by: 01, 05, 06, 07, 08, 09, 10
Test first: no
Level: 1
Builder: docs
Touches: README.md

The acceptance ticket. Run the brief's bar end to end against what is committed, not against the
working folder, and bring README's Status up to date with what the feature delivered.

1. Clone the repository's committed `HEAD` into a temporary folder and run the bar there:
   `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test`. A fresh clone
   proves nothing depends on an untracked file, an ignored build output or a local database.
2. Run `node tools/dev-smoke.mjs` (`pnpm dev` answers `GET /healthz` with 200).
3. Check that the seven bar properties each have at least one passing test, by name, in the
   test output (the list in the check block below), and report the test names in the Answer.
4. `README.md` Status: say that Layer 1's offline core is built (schema, entries API with the
   trust rules, context packet), that sign-in is not in yet, and how to try it locally:
   `pnpm dev`, then a request with the `X-Dev-Actor` header (development only, see
   `docs/DECISIONS.md`). Keep the README's existing framing and links.

If a bar property has no passing test, do not write one here: stop and say which, so the plan
gets a ticket for it.

## Not in this ticket

- The tester's acceptance tests under `plans/brain-core/acceptance/`: the conductor runs them
  itself once every ticket is resolved.
- Deploying or a real-Postgres run: the deploy feature.

## Done when

- The bar passes on a fresh clone of `HEAD` (check block, first command).
- `node tools/dev-smoke.mjs` prints `healthz 200`.
- The server tests include a passing test for each of the seven bar properties.
- README's Status says what the core does now and shows a local request with `X-Dev-Actor`.

```check
# The conductor runs this block before review.
$ d=$(mktemp -d) && git clone -q . "$d/repo" && cd "$d/repo" && pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test; rc=$?; rm -rf "$d"; exit $rc
exit 0
needs network (pnpm install into a fresh clone fetches packages)
$ node tools/dev-smoke.mjs
prints healthz 200
$ pnpm --filter @sky-brain/server exec vitest run --reporter=verbose
prints agent cannot write a rule
prints agent cannot approve
prints agent cannot write to the workspace scope
prints agent supersede of an approved decision stays proposed
prints old decision stays in force after an agent supersede
prints refuses a body with an API key
prints quarantines ignore previous instructions
prints cannot read another workspace through get
prints author comes from the actor
prints leaves out superseded and quarantined entries
prints keeps the markdown within the budget
prints a header injected in a body cannot forge a section
$ grep -n "X-Dev-Actor" README.md
prints X-Dev-Actor
```

## Reference

- spec.md § Goal and the bar
- map.md § The bar
- The test names in the earlier tickets' check blocks

## Answer
