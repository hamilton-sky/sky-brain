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

## How you reach it

| Who | How | State |
|---|---|---|
| You and your team, on web or phone | Sign in with Perminister at https://sky-brain.vercel.app | Live |
| claude.ai, Claude desktop, Claude phone app | Add the custom connector `https://sky-brain.vercel.app/mcp` | Live (claude.ai and phone app verified) |
| Claude Code and Codex CLIs | Add the same MCP server | Built, not yet verified |
| Pathly | Device login and run tokens; its client lives in pathly-adapters | Server side built, client planned |

Setup and the verified list: [docs/CONNECT.md](docs/CONNECT.md).

## Status (15 Nov 2026)

**Built and live** at https://sky-brain.vercel.app, on Vercel with Postgres on Nanogres
([D16](docs/DECISIONS.md)):

- **Sign-in.** Perminister through Better Auth. Anyone Perminister lets into the `sky-brain`
  product may enter, and each person gets their own workspace (D17). A pending invite is accepted
  at sign-in, but there is no route to send one yet. Better Auth stays for now (D19).
- **MCP connector** at `/mcp`, OAuth 2.1 with CIMD and PKCE. Tools: `whoami` and the ten task board
  tools.
- **Task board v1** (D20): projects, goals and a task DAG. Agents propose goals; only you approve
  them. Workers pull, claim with a 10-minute lease, and report. Web page with Approve, Cancel
  and Release.
- **Device login and run tokens** for headless agents such as Pathly runs.
- **The Gatekeeper's base checks:** every query filtered by workspace, secret scan, quarantine
  of instruction-like text, size caps, rate limits, and an append-only audit log.
- **The `entries` table** (kind, status, author, source, supersedes, confidence, full-text
  index) exists in the schema, but it has **no API or MCP tools yet**.
- **pgvector 0.8.1** is enabled on the database (`halfvec`, HNSW), not used yet.

**Planned: the memory.** The next work turns sky-brain from a board into a brain: memory with
provenance and trust levels, a context packet with each claimed task, hybrid search, and
Steward agents that keep memory healthy. sky-brain itself never calls an LLM (except for
embeddings); agents and Stewards run in the model you connect. The proposal, not yet decided:

- [docs/vision/BUILD-PLAN.md](docs/vision/BUILD-PLAN.md): the ordered build plan
- [docs/vision/hub/](docs/vision/hub/README.md): the architecture page and the other design pages
- [docs/vision/VISION.md](docs/vision/VISION.md) and [docs/vision/REVIEW.md](docs/vision/REVIEW.md):
  the research and the latest outside review

**The current contract and history:**

- [docs/PLAN.md](docs/PLAN.md): what is built and the rules it follows
- [docs/DECISIONS.md](docs/DECISIONS.md): the choices made so far, and why
- [docs/ROADMAP.md](docs/ROADMAP.md): the layers and what each one ships
- [docs/layer-1/TICKETS.md](docs/layer-1/TICKETS.md): Layer 1's tickets and where each stands

## License

MIT. See [LICENSE](LICENSE).
