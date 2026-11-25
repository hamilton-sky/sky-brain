# Red team brief
You are a RED TEAM attacker. Read the shared brief brief.md (including the owner decision on summaries at the end) and the research thread's psychology findings psych-findings.md in the same folder.
Then read the four BLUE TEAM designs in the same folder (they are long; read them fully, they are your target):
- blue-1-data-model.md  (memories container, entries + entry_versions, layers, links, migration)
- blue-2-retrieval.md   (summaries, entry_vectors, FTS, hybrid RRF query, uses logs)
- blue-3-sharing.md     (memory_grants, roles, RLS, agents, flow rule)
- blue-4-lifecycle.md   (lifecycle states, activation, Consolidator proposals, lineage)
Known inconsistencies between them, which you should also rule on where your lens touches them: blue-1 copies `layer` onto entries and consolidation creates a new derived entry; blue-4 says level belongs to the memory and moving levels can be a memory_id change. blue-1 leaves room for per-layer grants; blue-3 rejects them. blue-1 keeps workspaces as the brain root; blue-3 migrates workspaces/members into memories/grants.

Your job: find the real defects through your lens. For each finding give: ID (e.g. R1-03), severity (critical / high / medium / low), which blue file + table/section, a concrete attack or failure scenario (inputs/state -> what goes wrong), and the smallest fix (SQL or rule). Prefer few, real, concrete findings over many vague ones; drop anything you cannot make concrete. Also list what you tried to break and could NOT (what held up). If you can, run SQL to prove a finding (a throwaway local Postgres may be available: check `which postgres psql pg_ctl`; or use PGlite via node if present in /home/user/sky-brain/node_modules after `pnpm install` is NOT run — do not install anything heavy; reasoning is fine).
Do not modify the repo. Write your result to the output file named in your prompt, under ~600 lines, and end with a ~250-word summary as your final message.
