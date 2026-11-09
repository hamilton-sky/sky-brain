# sky-brain

A shared brain for people and AI agents.

sky-brain is one place in the cloud where you, your team, Claude, Codex and claude.ai read
and write the same knowledge: rules, decisions, questions and answers, artifacts and lessons.
Later it also holds live documents that people and agents edit together.

**It is a place for context, not a place to run agents.** Agents run where the code is: a
laptop, a cloud session, claude.ai. They come to sky-brain to pull context before they work,
and to write back what they learned after.

## Why it is different

- **Knowledge has a type.** A rule is not a claim, and a claim is not a decision.
- **Knowledge stays true.** A decision ends only when a newer one supersedes it. Unconfirmed
  claims expire.
- **People hold the top authority.** Agents propose; people approve. Only people write rules.
- **Every tool shares one brain.** Claude, Codex, claude.ai and Pathly all read the same entries.

## How you reach it (planned)

| Who | How |
|---|---|
| You and your team, on web or phone | Sign in with Google |
| claude.ai, Claude desktop, Claude phone app | Add sky-brain as a custom connector |
| Claude Code and Codex CLIs | Add the MCP server |
| Pathly | Its fragments read and write sky-brain |

## Status

Layer 1's offline core is being built: the monorepo, the server and its trust rules, tested on
PGlite. It deploys to Vercel with Postgres on Nanogres (docs/DECISIONS.md D16). Login is not in
yet, so the deployed API refuses every request that needs an actor.

- [docs/PLAN.md](docs/PLAN.md): what we build and how
- [docs/ROADMAP.md](docs/ROADMAP.md): the five layers and when each is done
- [docs/DECISIONS.md](docs/DECISIONS.md): the choices made so far, and why
- [docs/layer-1/TICKETS.md](docs/layer-1/TICKETS.md): Layer 1 broken into tickets

## License

MIT. See [LICENSE](LICENSE).
