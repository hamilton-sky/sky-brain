# Red 1: security and privacy attack on the four blue designs

Lens: leaks between memories and between people, RLS and pooled connections, invites, revocation,
agent escalation and injection through `summary`/`questions`, hard forget, core exposure, and the
CLAUDE.md hard rules. Targets: blue-1 (data model), blue-2 (retrieval), blue-3 (sharing),
blue-4 (lifecycle).

**Proof.** Findings marked **[PROVEN]** were run on a throwaway Postgres 16.15 cluster
(`app_owner` is a non-superuser table owner, like the Nanogres owner; `sky_app` is the runtime role
from blue-3 §5.5). The scripts are in `scratchpad/red1/t1.sql`, and the follow-up queries are quoted
inline. The cluster was stopped afterwards. Everything else is reasoned from the designs' own SQL.

---

## Severity table

| ID | Sev | Where | One line |
|---|---|---|---|
| R1-01 | critical | blue-1 §10 `forget_entry`; blue-3 §5.5 | Hard forget has no permission check and is executable by PUBLIC: any request can wipe any entry in any brain **[PROVEN]**. Under FORCE RLS it silently does nothing **[PROVEN]**. A cascade into an append-only table blocks it **[PROVEN]** |
| R1-02 | high | blue-3 §5.5/§8.2 + blue-2 §4.3 worker + blue-4 sweeps | FORCE RLS with policies `TO sky_app` only means every SECURITY DEFINER or system path sees zero rows. The rollout order also makes grants live before RLS exists |
| R1-03 | high | blue-1 §4.3 head trigger + blue-2 §7 `vec`/`cand`/`scored` + §4.3 job reasons | Quarantine bypass: a quarantined new version becomes the head, and the vector route serves its summary |
| R1-04 | high | blue-1 §4.2 `resummarize`; blue-2 §2.3/§4.1 | An agent can replace the summary of an approved entry. The summary is what gets embedded and what packets show, so this edits approved content in effect |
| R1-05 | high | blue-2 §6 `entry_uses`/`entry_strength`/`retrievals`; blue-1 §9.3; blue-4 §4.2 | Use logs and activation are shared per entry. They leak who read what, and with which query text, between owner and grantees. A grantee's agents can also pump the owner's ranking |
| R1-06 | high | blue-2 §8 packet part 1; blue-1 §9.2/§1; blue-3 §10 order | Core exposure: "core of the brain owner" goes into a grantee's packet. Blue-1 allows a viewer grant on the core layer and keeps `members` with access to the whole brain |
| R1-07 | high | blue-3 §5.5 `entries_insert` + `entries_read` profile branch | A contributor's agent inserts `in_profile=true` text into a shared memory, and every grantee of every other memory of the owner can read it **[PROVEN]** |
| R1-08 | high | blue-3 §7 flow rule vs blue-2 §8, blue-4 §6.2/§3, blue-1 §7 | The flow rule is bypassed by core in every packet, by Consolidator replay sets, by refile / "as-is" promote, by server rule writes, and by admin grants |
| R1-09 | medium | blue-1 §7 refile × blue-2 `entry_vectors.memory_id` × blue-2 §7 | After a refile, the stale `memory_id` on vectors still serves a now-private entry to the old memory's readers |
| R1-10 | medium | blue-3 `entries_update`; blue-1 `entries_guard` | RLS lets an agent set `trust='approved'` by UPDATE **[PROVEN]**. Blue-1's guard is bypassed by a GUC that any session can set **[PROVEN]**. Bookkeeping columns are open to contributors |
| R1-11 | medium | blue-2/blue-4 new tables; blue-2 partitions | About 14 new tables have no `memory_id` and so no RLS pattern fits them. Querying a hash partition directly skips the parent's RLS **[PROVEN]** |
| R1-12 | medium | blue-3 §9.2; blue-4 cold storage; stored digests/packets | Revocation that does not revoke: Blob URLs work as bearer links, stored digests and packets survive, and grantee agents make derived copies automatically |
| R1-13 | medium | blue-1 §10 vs blue-2/blue-4 | Hard forget leaves residue: vectors, the summaries table, query text, `content_hash`, link reasons, derived gists, blobs |
| R1-14 | medium | blue-3 §6/§4.1 rules; packet fence; many text fields | Injection surfaces: memory name inside the fence label, admin-approved rules steering the owner's agents, fields that are not scanned, the shared blackboard in autonomous device runs, query magnets |
| R1-15 | medium | `db/client.ts` `role` option; blue-3 §8.2 | A session-level `SET ROLE` through PgBouncer transaction mode sticks to server connections. A non-local `set_config` would leak a person into the next request **[PROVEN]** |
| R1-16 | low | blue-3 §5.5 every policy | `memory_id = ANY ((SELECT f()))` does not compile on PG16 **[PROVEN]**. It fails closed, but needs a cast |
| R1-17 | low | blue-3 §5.4/§5.5/§5.6 | Oracles in PUBLIC SECURITY DEFINER functions **[PROVEN]**, forgeable `audit_log` rows, and a grant shown with one person's email while bound to another person's id |
| R1-18 | low | blue-2 §12.5 cache; blue-4 `sources` unique key | Cross-person existence oracles: a shared query-embedding cache, and `UNIQUE(owner_id, lineage_key)` on sources |

---

## R1-01 (critical): hard forget is unauthenticated, then a silent no-op, then blocked

**Where.** Blue-1 §10 `forget_entry(p_entry uuid, p_actor text)`, which is `SECURITY DEFINER` with no
check. Blue-3 §5.5 forces RLS on content tables with policies `TO sky_app` only. Blue-2 §4.1 and
blue-4 §4.2 put append-only triggers on tables that use `ON DELETE CASCADE`.

**Attack A: cross-brain wipe [PROVEN, T2].** Postgres grants EXECUTE on new functions to PUBLIC. Blue-3
revokes it only for the four grant functions. `forget_entry` checks neither the caller nor the
memory. Test setup: no FORCE (blue-3's migration steps 1 to 3 run this way). Bob is a stranger to A's
Health memory and calls `forget_entry('<A's entry>', 'human:A')` as `sky_app`. Result: `bob_sees_health
= 0`, `rows_bob_forgot = 1`, and the title is now `[forgotten]`. One bug in a route that passes an id
through, or one MCP tool that exposes forget, lets anyone destroy anyone's memory. `p_actor` also comes
from the caller, so the audit row lies (hard rule 2).

**Failure B: silent no-op under FORCE [PROVEN, T1].** After blue-3 step 4 (`FORCE`), the function runs as
`app_owner`, and FORCE applies to the owner too. No policy names `app_owner`, so the UPDATE matches 0
rows. Result: `rows_forgotten_under_force = 0`, with no error. A legal-grade "forget" reports success
and keeps everything.

**Failure C: cascade into append-only [PROVEN, T6].** A row trigger that refuses DELETE also fires on
FK cascade deletes. `DELETE FROM entries` raises `append-only: DELETE` from `entry_summaries`, and the
entry stays. This hits blue-2 `entry_summaries` and `entry_uses`, blue-4 `entry_uses` ("hard forget
cascades" plus append-only) and `entry_lifecycle_events` (FK NO ACTION plus append-only). Blue-4 says
"content rows are deleted"; blue-1 says tombstone by UPDATE. Both cannot hold at once.

**Smallest fix.**
```sql
-- 1. One owner-only entry point, actor taken from the session, never from an argument.
CREATE FUNCTION forget_entry(p_entry uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mem uuid;
BEGIN
  SELECT memory_id INTO v_mem FROM entries WHERE id = p_entry;
  IF v_mem IS NULL OR app_actor_kind() <> 'human'
     OR memory_role(app_person(), v_mem) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'no_data_found';
  END IF;
  ... -- purge list from R1-13; audit actor = app_actor()
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;          -- and ALTER DEFAULT PRIVILEGES
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION forget_entry(uuid) TO sky_app;
-- 2. Own privileged functions by a NOLOGIN role that has its own explicit policies (R1-02),
--    never rely on "owner bypasses RLS".
-- 3. Append-only triggers allow the purge only for that role, not on a GUC:
--    IF current_user = 'sky_purge' THEN RETURN OLD; END IF;
```
Ruling on the blue-1 vs blue-4 conflict: **tombstone the `entries` row (blue-1) and purge the content
rows explicitly in the function.** Do not rely on FK cascades through append-only tables.

---

## R1-02 (high): FORCE RLS starves every privileged path, and grants go live before RLS does

**Where.** Blue-3 §5.5 ("`memories` and `memory_grants` are not forced, so SECURITY DEFINER functions
can read them") and §10 (migration order). Blue-2 §4.3 (embedding worker in `waitUntil` and a Vercel
Cron sweep). Blue-4 §5 (nightly fade sweep, `actor_kind='rule'`) and §6 (queue scoring). Blue-3 §7.1
(the grant-time count "M holds 12 entries built from memories Dana cannot see").

**Failure.**
- All of these read content tables across owners or outside any `app.person`. Under FORCE, with
  policies only `TO sky_app`, the owner role sees nothing (T0: the owner's own INSERT was refused, and
  T1).
- Effects: the embedding worker embeds nothing, the fade sweep fades nothing, and the grant-time
  lineage warning always counts 0. The widening it is meant to catch therefore goes through silently.
- The natural quick fix under pressure is to drop FORCE or add `USING (true)` for the owner. Either one
  reopens R1-01 A for every definer function.
- **Rollout order.** Blue-3 backfills grants at step 2 and turns RLS on for real at step 4. Until then
  the runtime is the table owner and RLS is not applied at all.
  - Every query in blue-2 §7 is then the only barrier, through its `$1` parameter.
  - Any shared memory accepted in steps 2 to 3 is protected by app code alone. That is the situation
    RLS was chosen to avoid.

**Fix.**
```sql
CREATE ROLE sky_worker NOLOGIN;            -- embedding, sweeps, consolidation scoring
GRANT SELECT ON entries, entry_versions, entry_summaries TO sky_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON entry_vectors, embedding_jobs TO sky_worker;
CREATE POLICY entries_worker ON entries FOR SELECT TO sky_worker USING (true);
-- one such policy per table the worker needs, nothing else; worker code paths
-- do SET LOCAL ROLE sky_worker inside their own transaction and never return text to a request.
```
Gate the sharing UI: `accept_grant()` raises until a feature flag `rls_enforced` is set by the step-4
migration. Before that, no grant to another person is live.

---

## R1-03 (high): quarantine bypass through the vector route

**Where.**
- Blue-1 §4.3 `entry_versions_after_insert` copies `NEW.title`, `NEW.summary` and `NEW.trust` onto the
  head for any version, including a quarantined one.
- Blue-2 §7 `fts` and `trg` filter `status NOT IN ('quarantined','rejected')`. But `vec_raw`/`vec`
  filter only by memory. `cand` takes from `fused` directly, not from `seeds`. `scored` and `final` do
  not re-filter status, and they return `title, summary`.
- Blue-2 §4.3 says quarantine deletes vectors, but `embedding_jobs.reason` has no `quarantined` value,
  so nothing deletes them.

**Attack.**
1. An agent (or a contributor's agent in a shared memory) writes entry E v1 with a clean summary
   "Hosting decision: Vercel". It is embedded.
2. The agent writes v2 of its own proposed E. The new summary is instruction-like, so v2 is quarantined
   and the head now holds v2's title and summary.
3. v1's vectors stay, because no job removes them and the worker skips old versions.
4. Any packet whose cue is near "hosting" gets E through `vec`. `scored` returns the head summary,
   which is the quarantined injection, into the packet of the owner's agent.

The same path serves `rejected` heads, and entries in a memory after it is archived.

**Fix.**
1. In the query, add to `scored`:
   `WHERE e.memory_id = ANY($1) AND e.status NOT IN ('quarantined','rejected') AND v.version = e.current_version`.
   The last check means joining `vec_raw` on the head version.
2. Delete vectors in the same transaction that quarantines, rejects or archives (a trigger on the head),
   not through the outbox.
3. Blue-1: the head cache serves the **last non-quarantined version** for title and summary. Keep a
   separate `pending_quarantined_version` column for the review UI.

---

## R1-04 (high): an agent swaps the summary of an approved entry

**Where.**
- Blue-1 §4.2/§4.3: `change='resummarize'` is "the one change an agent may make to an approved
  entry". The new summary becomes the head summary at once.
- Blue-2 §2.3/§4.1: any new `entry_summaries` row moves `entries.summary_id`. Undo exists only
  afterwards, in the Digest.
- Neither design limits who may re-summarize: the Steward only, or any agent with write rights.

**Attack.**
- The owner approved decision D: "We will NOT store customer data in the EU region". A contributor's
  agent in that shared memory (or a prompt-injected owner's agent) writes a resummarize version. The
  content hash is unchanged, so the trigger passes it. New summary: "Customer data stored in the EU
  region (approved)".
- Packets show the summary, not the body (blue-2 §2.3). Vectors are built from the summary. Every agent
  now acts on the inverted decision, labelled "approved".
- The Gatekeeper's "one content token overlaps" check passes trivially.

Combined with blue-2 §2.2 ("An instruction-like summary quarantines the entry"), an agent can also
**hide** any approved entry by writing a deliberately instruction-like summary. That is a rejection by
an agent, which hard rule 3 forbids. (Blue-1's trigger refuses the trust change, so under blue-1 the
write just fails. Under blue-2 it is undefined.)

**Fix (rules on blue-1 open point 1 and blue-2 open point 1).**
- A summary row has its own `status` (`proposed|kept`). For an entry with `trust='approved'`, the packet
  and the vector use the latest **kept** summary. An agent-written summary stays `proposed` until a
  person keeps it, and only then is it embedded.
- Only the Steward of the memory's **owner** may write a summary for an entry it did not author. A
  grantee's agent may summarize only entries its own person authored.
- An instruction-like summary quarantines the **summary row**, never the entry.

```sql
ALTER TABLE entry_summaries ADD COLUMN status text NOT NULL DEFAULT 'kept'
  CHECK (status IN ('proposed','kept','quarantined'));
-- trigger: written_by_kind='agent' AND entry trust='approved' => status := 'proposed'
```

---

## R1-05 (high): use logs and activation leak between people, and grantees can pump them

**Where.**
- Blue-2 §6.1: `entry_uses` with `actor_id`, `task_id`, `goal_id`, `retrieval_id`;
  `retrievals.query`; `retrieval_hits.signals`; and **one** `entry_strength` row per entry. The §7
  query also returns `act` to the caller.
- Blue-1 §9.3: `entry_uses.cue jsonb` ("the query / context that retrieved it").
- Blue-4 §4.2: `entry_uses.query_text`, `entry_stats` per entry, and `fades_at` from those stats.
- Blue-3 §7.6 asks for per-person signals, and none of the other three designs does it.

**Leaks.**
1. `entry_uses` carries `memory_id` (blue-2), so under blue-3's rule ("the same two policies go on
   every table that carries memory_id") Dana, a viewer on Kitchen, reads every use of every Kitchen
   entry by the owner:
   - the owner's `query_text` / `cue` (the owner's private thoughts, often about other memories),
   - the owner's task and goal ids (from the owner's private boards),
   - the times of each use.
   In the other direction, the owner learns exactly what Dana looked at, and when.
2. Even with logs hidden, the shared `entry_strength` / `entry_stats` plus the returned `act` value
   tell each side the other's usage pattern. Dana's opens also stretch `fades_at` on the owner's shared
   inbox, which keeps it alive.

**Escalation.** Blue-4 limits counted uses to one per (entry, actor, hour). `actor` is an agent
identity string, and a person can run many agents or clients. A contributor's agents can cite their own
proposed entries every hour from several clients. That raises shared activation, so their entries rank
into the owner's packets (with the R1-14 query magnets).

**Fix.**
```sql
ALTER TABLE entry_uses ADD COLUMN reader_id text NOT NULL;          -- on_behalf_of person, from token
CREATE POLICY uses_own ON entry_uses FOR SELECT TO sky_app USING (reader_id = app_person());
-- same for retrievals, retrieval_hits (via retrievals.caller person), packet_items.
CREATE TABLE entry_strength (reader_id text, entry_id uuid, ..., PRIMARY KEY (reader_id, entry_id));
```
- Ranking for person P reads only P's strength row.
- `fades_at` and the review ladder use the owner's uses only.
- Never return `act` or `signals` outside the owner's own packets.
- `query_text` is secret-scanned (blue-4 says so) **and** covered by hard forget (R1-13).

---

## R1-06 (high): core memory exposure

1. **Packet part 1 (blue-2 §8):** "All approved core entries of the **brain owner**".
   - Scenario: Dana's device claims a task on shammai's shared working memory (blue-3 §4.2 allows it).
     The brain that owns the board is shammai's, so the literal rule loads **shammai's whole core**
     (identity, values, standing rules) into Dana's agent.
   - Blue-3 §3 says only `in_profile` entries may go, and A's core rules never travel. RLS would catch
     this only after step 4 (R1-02), and only if the packet builder runs under `withActor`.
   - **Fix:** part 1 is the **caller's** own core, plus the board owner's `in_profile` entries when the
     run draws on that owner's memory. Add a test: a grantee's packet holds no non-profile core entry of
     the owner.
2. **Blue-1 §9.2** allows `layer = 'core'` grants with `role='viewer'` (`grants_core_read_only`), and
   layer grants cover "present and future" memories.
   - **Ruling: blue-3 wins.** No layer grants, and a `CHECK (layer <> 'core')` carried on the grant
     through the composite FK.
   - Layer grants also silently share memories made later (blue-3 §2) and make consolidation a sharing
     act.
3. **Blue-1 §1** keeps `members` as "full access to the whole brain".
   - Every legacy editor or viewer reads core, and any query written in today's style (join `members`
     on workspace) leaks all memories.
   - **Ruling:** keep `workspaces.owner_user_id` as the root if blue-1 wants it. Constrain
     `members.role = 'owner'` (`CHECK`) and migrate other rows to grants per non-core memory (blue-3
     §10). RLS keys on memories, never on workspace membership.
4. **Core in every packet vs the flow rule**: see R1-08.

---

## R1-07 (high): profile laundering through `in_profile` [PROVEN]

**Where.** Blue-3 §5.5:
- `entries_read`: `... OR (in_profile AND owner_id = ANY(app_profile_owners()))`.
- `entries_insert` checks the memory, the owner and trust. It does not check `in_profile`, and it does
  not check that the memory is core. `entries_update` does not either.

**Attack (T4).** Bob holds contributor on A's Kitchen memory. Dana holds viewer on Garden only.
1. Bob's **agent** inserts into Kitchen an entry `in_profile=true, trust='proposed'` whose text is
   Kitchen content. The insert passes.
2. Dana selects from entries and gets `00..b1 | About A | Kitchen budget is 40k`.

Any contributor (or their agent) can therefore publish any memory they can read to **every** grantee of
the owner. It is also an injection path into all those people's packets (the profile is rendered as
"About <owner>").

**Fix.**
```sql
-- read: profile only from the owner's core memory
... OR (in_profile AND layer = 'core' AND owner_id = ANY ((SELECT app_profile_owners())::text[]))
-- write: only a human owner sets it
CREATE POLICY entries_insert ... WITH CHECK (... AND (NOT in_profile OR
   (app_actor_kind() = 'human' AND owner_id = app_person() AND layer = 'core')));
-- same predicate in entries_update WITH CHECK (or column-level REVOKE, R1-10)
```

---

## R1-08 (high): the flow rule leaks through five side doors

Blue-3 §7.1 checks `flow_allowed(target, sources)` on writes that **declare** lineage. These
paths carry content but no declared lineage, or skip the check:

| # | Path | Scenario | Fix |
|---|---|---|---|
| a | **Core in every packet** (blue-2 §8, blue-4 §10) | If packet ids count as sources (blue-3 §7.1), then every agent write into a shared memory fails, because core is readable by the owner only. Implementers will exempt core, and then core paraphrases flow into shared memories freely. | When the run's write set includes a memory with other readers ("sealed run", blue-3 §7.4), load only `in_profile` core. Core is never lineage-exempt. |
| b | **Consolidator replay set** (blue-4 §6.2 `consolidation_next`, `replayed_ids`) | Gisting an item of the shared "Family inbox" into shared "Family" long memory replays neighbours from private "Health". The gist's `derived_from` lists only the inbox item, so `flow_allowed` passes and Dana reads the Health detail. | `flow_allowed(target, sources ∪ memories_of(replayed_ids))`. The replay query is restricted to memories whose readers ⊇ the target's readers. |
| c | **Refile / "as-is" promote** (blue-1 §7 refile; blue-4 §3 short→long field change, `proposals.op='promote'`) | The owner's agent refiles a proposed note from private short "Health" into shared short "Family inbox" (blue-1 lets agents refile non-approved entries). This is not "derived", so no check runs. | Check in the DB, in `entry_versions_before_insert`: `IF NEW.memory_id <> prev.memory_id AND NOT flow_allowed(NEW.memory_id, ARRAY[prev.memory_id]) THEN` agents raise; a human needs `app.flow_override='on'` set by the confirm route, and writes `flow.override` audit. |
| d | **Server "rule" writes** (blue-4 §3 working→short seal into an episode; blue-1 consolidation link writes) | Scratch from a shared board (audience W) is sealed into an episode in a short memory with audience S ⊄ W. The rule actor is not covered by §7.1. | The seal target is chosen by `flow_allowed`. Default: an episode in the board's own audience, or the owner's private inbox (narrower). |
| e | **Admin grants** (blue-3 §5.6, §7.1) | Blue-3 says only the owner may widen, but `grant_memory` lets an admin add Dana to M whose entries derive from memories Dana cannot read. The grant-time warning is shown to the person granting (the admin), and it leaks lineage counts to them. It also counts 0 under FORCE (R1-02). | In `grant_memory`: if `v_mine <> 'owner'` and any entry of M has lineage outside memories the new grantee can read, raise `flow_widens_audience`. Only the owner may confirm. |

---

## R1-09 (medium): a refile leaves vectors with the old `memory_id`

**Where.** Blue-1 §7 refile changes the entry's `memory_id`. Blue-1 §9.1 says "Refile updates
`memory_id` on chunks in the same tx", but blue-2 owns `entry_vectors.memory_id`, which is
denormalized and assumed immutable (blue-3 §5.5: "memory_id on an entry is immutable"). Blue-2's worker
"calls the model only for hashes not already stored". The summary did not change, so the hash is the
same and the job may skip the upsert. Blue-2 §7 never re-checks `e.memory_id` after `vec`.

**Attack.** The owner refiles an entry from shared "Work" to private "Personal". The vector row still
says Work. Dana's search hits it through `vec` and gets the title and summary from `scored`. Without
RLS on `entries` (steps 1 to 3, R1-02) this is a direct leak. With RLS it is a ranking side channel
only: the row drops at the join, but it took a slot in `LIMIT 200`.

**Fix.** A trigger on the head's `memory_id` change does `UPDATE entry_vectors SET memory_id = NEW.memory_id
WHERE entry_id = NEW.id` in the same transaction (as `sky_worker`). The query re-checks
`e.memory_id = ANY($1)` in `scored` (same line as R1-03).

---

## R1-10 (medium): agents and contributors change trust and bookkeeping by plain UPDATE

**Where.** Blue-3 `entries_update` has no trust or actor predicate. Blue-1 `entries_guard` protects
the head columns unless `sky_brain.head_sync = 'on'`. Blue-1 §4.3 lists the bookkeeping columns
(`expires_at`, `salience`, `core_rank`, `consolidate_into`, `goal_id`, `task_id`) and blue-4 adds
`pinned`, `importance` and `lifecycle_state` as "plain UPDATEs through the API".

**Proof.**
- **T5 (blue-3 alone):** as Bob's agent, `UPDATE entries SET trust='approved'` succeeds. The row
  reads `approved`.
- **T8 (blue-1's guard):** the UPDATE is refused, then succeeds after the same session runs
  `SELECT set_config('sky_brain.head_sync','on',true)`. A GUC is not a privilege. Blue-1's stated aim
  ("the DB makes a bug fail closed") does not hold, and `sky_brain.forget` has the same weakness.

**Escalation without SQL injection.**
- A contributor (human or agent) in a shared short memory sets `expires_at = now()` on the owner's
  entries, so they fade out of retrieval. That is a delete by an agent (hard rule 3).
- `pinned` and `importance` are "person only" (blue-4) and are not enforced. `consolidate_into` can
  point at any memory id of the brain (the FK checks the workspace only).

**Fix.**
```sql
REVOKE UPDATE ON entries FROM sky_app;
GRANT UPDATE (goal_id, task_id, feature_id, expires_at, review_due_at, salience, core_rank,
              consolidate_into, pinned, importance, in_profile) ON entries TO sky_app;
CREATE POLICY entries_update ON entries FOR UPDATE TO sky_app
  USING (memory_role(app_person(), memory_id) >= 'editor' AND app_actor_kind() = 'human')
  WITH CHECK (memory_role(app_person(), memory_id) >= 'editor' AND app_actor_kind() = 'human');
-- head cache: the trigger tests nesting, not a GUC
IF pg_trigger_depth() < 2 AND (NEW.head_version, ...) IS DISTINCT FROM (OLD.head_version, ...) THEN RAISE ...
```
The head is written only from inside `entry_versions_after_insert`, where `pg_trigger_depth() = 2`. Agents
change nothing on `entries` directly; they write versions or proposals.

---

## R1-11 (medium): tables outside the RLS pattern, and partitions

Blue-3 §5.5 policies key on `memory_id`. These tables hold content, cues or signals and have **no
`memory_id`**, so the pattern cannot be applied as written:
- blue-2: `retrievals` (query text), `retrieval_hits` (signals), `entry_strength`, `cue_vectors` (goal
  and task text embedded), `embedding_jobs` (`last_error` can echo input).
- blue-4: `entry_stats`, `packet_items` (`score_parts`), `proposals` (`reason`, 500 chars of
  agent text), `consolidation_queue`, `sources` (`locator` URLs), `entry_evidence`,
  `review_schedule`, `review_events`, `entry_lifecycle_events`, `ranking_signals`.

If they get no RLS, any forgotten filter leaks them (the risk RLS was chosen to remove). If they get
RLS with no policy, features break (R1-02). **Fix:**
- Give each table either `memory_id` (copied from the entry and checked by a composite FK) or a
  `reader_id`/`owner_id` policy (`owner_id = app_person()` for proposals, queue, schedule, signals,
  stats).
- Add one test per table (hard rule 4).
- `proposals.to_memory_id` must satisfy `memory_role(app_person(), to_memory_id) >= 'contributor'` and
  the flow rule at accept time.

**Partitions [PROVEN, T9].** Blue-2 hash-partitions `entry_vectors` into 32 partitions. RLS on the
parent is not inherited by the partitions. After the common shortcut `GRANT SELECT ON ALL TABLES IN
SCHEMA public TO sky_app`, Bob's query on `vecs` returned 0 rows, while the same query on `vecs_p1`
returned A's row.

**Fix:** grant only on the parent (`REVOKE ALL ON entry_vectors_p0..p31 FROM sky_app`) and add a CI check
that no partition is granted to `sky_app`. Alternatively, enable RLS with the same policy on every
partition.

---

## R1-12 (medium): revocation that does not really revoke

Blue-3 §9.2 is right that what was read cannot be recalled. These cases are not "what was read":

1. **Cold storage URLs.** Blue-4 archives bodies to Blob (`cold_ref`), and blue-1 episodes hold
   `content_ref` ("Blob URL"). If the API hands the pointer to a reader, it works as a bearer link. It
   survives revocation and hard forget, and it puts a credential in a URL (hard rule 5).
   - **Fix:** private store only. The server streams the body after an RLS read of the owning row and
     never returns the blob URL. Forget deletes the blob.
2. **Stored digests and packets.** Blue-3 §7.4 allows a stored digest "in that person's private space".
   BUILD-PLAN step 2 stores packets for audit. If either stores rendered text, the grantee keeps A's
   text after revocation, and B's later API reads still serve it.
   - **Fix:** store ids and versions only (`packet_items` already does) and re-render through RLS. A
     digest is never persisted as text.
3. **Automatic derived copies.** B's agents (with the shared memory opted in) write lessons and
   gists derived from A's entries into **B's own** memories (narrower audience, so flow passes). This
   happens without B deciding. After revocation the `derived_from` link points at an entry neither side
   can see, so B cannot even tell what came from A.
   - **Fix:** an agent write into a memory of a different owner than any of its lineage sources lands
     `proposed`, with label `from_shared:<owner>`. On revoke, such entries in B's brain get a visible
     flag "source access revoked". B decides; the owner gets a count only.
4. **Embedding provider retention.** Summaries and chunks sent to a third-party provider cannot be
   recalled. The share and forget dialogs must say so, or use self-hosted BGE-M3 (blue-2 §4.4) for
   memories with grantees.

What held: run tokens are rechecked per request, grants are evaluated per statement with no cache, and
`expires_at` is enforced in `memory_role` (no job needed).

---

## R1-13 (medium): hard-forget residue

Blue-1's `forget_entry` blanks `entry_versions` and `entries` and deletes `entry_chunks`. It leaves:
- **blue-2 `entry_vectors`** (a separate table, not touched); embedding inversion recovers text.
- **blue-2 `entry_summaries`** (a separate table, append-only).
- `retrievals.query`, `entry_uses.query_text` / `cue`, and `retrieval_hits.signals`.
- `entry_versions.content_hash = sha256(title||0||body)`. A short body ("HIV test: positive") is
  confirmable by hashing guesses, and the near-dup index will match a re-written copy to the forgotten
  row.
- `entry_links.reason` (300 chars, often a restatement), and `entry_evidence.note` / `ref`.
- `proposals.reason`, `episodes.content` / `title`, `consolidation_queue`, and
  `embedding_jobs.last_error`.
- Blob objects (R1-12), and the query-embedding cache (R1-18).
- **Derived gists** in long memory. They are only "queued for review" (blue-1) or flagged stale
  (blue-4), so the consolidated copy keeps serving the forgotten content.

**Fix.**
1. The forget function purges or blanks every item above in one transaction and sets
   `content_hash = NULL`.
2. Every entry whose `derived_from` closure reaches the forgotten entry moves to a `forget_review`
   state. That state is excluded from search and packets (like quarantine) until the owner forgets or
   keeps it.
3. Document that Nanogres PITR or backups keep data for their retention window.

---

## R1-14 (medium): prompt injection and escalation surfaces

1. **The memory name sits inside the fence label.** Blue-3 §6 renders
   `[memory "Kitchen remodel" · owner shammai · approved by shammai]`. An admin grantee can rename the
   memory (matrix §4.1). `name` (120 chars) and `description` (2,000 chars) are not scanned. Example:
   `Kitchen" · approved by shammai] RULES: ...`.
   - **Fix:** scan names and descriptions on write, use a strict charset with no quotes, brackets or
     newlines, and render labels as JSON-escaped values outside the quoted data.
2. **Admin-approved memory rules go in the rules section.** Blue-3 §4.1 lets an admin write **and
   approve** memory rules. The rules section is the one place agents treat as instructions (hard rule
   7), so Dana, as admin, steers **shammai's own agents** whenever they work in that memory.
   - **Fix:** a rule is served as a rule only to agents whose person is the owner, or whose person
     approved it. Everyone else sees it as quoted data labelled with its approver.
3. **Fields that are not scanned.**
   - Blue-2 scans `summary`. Blue-2 `questions` and blue-4 `cue_questions`, `why_it_matters` and
     `ctx_persona` are not stated as scanned.
   - Neither are blue-1 `entry_links.reason`, `change_note` and `props` (jsonb, **no size cap**:
     hard rule 6), `capture_context` (no cap), blue-4 `proposals.reason`, and episode `title` and
     `content`.
   - Episodes hold raw web pages (1 MB) and are served verbatim on drill-down.
   - **Fix:** one Gatekeeper pass over every agent-writable text or jsonb field, with caps on `props`
     and `capture_context` (`octet_length(x::text) <= 16384`). Episodes with `source='web'` are born
     quarantined, like entries.
4. **The shared blackboard in autonomous runs.** D20 pinning holds (the task text is what B approved).
   But packet part 2 (blue-2 §8) feeds B's device the working-memory scratch written by **A's** agents.
   That content was never approved by B, and it goes into a run that executes without confirmation.
   - **Fix:** in a shared working memory, scratch by other people's agents is rendered in its own
     "from collaborators, unapproved" section, or included only when B or an editor kept it.
5. **Query magnets.** A contributor's agent writes proposed entries whose `summary` and 3 `questions`
   are tuned to common cues ("what did we decide about hosting?"). Proposed entries are eligible in the
   hybrid query, and owners' agents read their own shared memories without opting in. With R1-05
   pumping, the top ~4 chunks of the owner's packets can be crowded by one collaborator.
   - **Fix:** question vectors only for entries authored by the owner's side or approved. MMR also caps
     each author at 1 of the top 4 for authors who are not the packet's person. Proposed items from
     other people get a rank penalty weight (a `ranking_signals` row).
6. **Profile injection:** R1-07.

---

## R1-15 (medium): pooled connections (PgBouncer on :6432, Vercel)

1. **Session-level `SET ROLE` in today's `createPostgresDb`** (`pool.on("connect")` runs
   `SET ROLE "<role>"`).
   - Through PgBouncer transaction mode, that statement runs on whatever server connection is lent at
     that moment, and the role **stays on that server connection** for later clients. Transaction mode
     does not reset (`server_reset_query_always = 0` by default).
   - If the runtime ever sets an owner role this way (the comment suggests it is meant for DDL), system
     paths outside `withActor` run with whichever role the borrowed server connection happens to carry.
   - **Fix:** do not use session SET in the runtime. Make `sky_app` a LOGIN role with its own
     `DATABASE_URL`, so `withActor` needs no `SET ROLE` at all, and workers use `sky_worker` (R1-02) on
     a third URL.
2. **Non-local settings leak [PROVEN, T7].** After `set_config('app.person','A',false)` on a connection,
   a later transaction that sets nothing saw 3 rows as A.
   - Blue-3 is safe as written, because `withActor` sets **all four** keys with `is_local=true` on every
     transaction (empty string for "none").
   - Keep it that way with a lint ban on `set_config(..., false)`, `SET app.` and `SET hnsw.` without
     `LOCAL`, and a test that runs two `withActor` calls on one connection with different people.

---

## R1-16 (low): blue-3's RLS policies do not compile [PROVEN]

`memory_id = ANY ((SELECT app_readable_memories()))` fails with `operator does not exist: uuid = uuid[]`
on PG16, because `ANY (subquery)` is chosen. It fails closed (the migration errors), but the obvious
quick fix `= ANY (app_readable_memories())` drops the once-per-statement InitPlan.

**Fix:** `memory_id = ANY ((SELECT app_readable_memories())::uuid[])`. With that cast the T4/T5/T9
policies compiled and ran.

---

## R1-17 (low): definer oracles, forgeable audit, mislabelled grants

- **[PROVEN, T3]** `memory_role(p_person, p_memory)` is PUBLIC and SECURITY DEFINER. As Bob it returned
  `viewer` for Dana on Garden and `owner` for A on Health: the grant graph of any brain.
  `flow_allowed(target, sources)` is a similar oracle.
  - **Fix:** REVOKE from PUBLIC (R1-01). The exposed variant takes no person argument and uses
    `app_person()`.
- `audit_insert ... WITH CHECK (true)` lets any request write an audit row with any `actor`/`owner_id`,
  including into another person's audit view (hard rule 2).
  - **Fix:** `WITH CHECK (actor = app_actor() AND (memory_id IS NULL OR memory_role(app_person(),
    memory_id) IS NOT NULL))`.
- `grant_memory(p_user, p_email, ...)` stores the typed `p_email` next to a different `p_user`. The
  owner's share list then shows "dana@..." for a grant bound to someone else (an admin can do this).
  - **Fix:** when `p_user` is given, take the email from the `user` row inside the function, and refuse
    when both are given and disagree.

---

## R1-18 (low): cross-person existence oracles

- **Query-embedding cache** (blue-2 §12.5, "hash → vector, 1 day"). If it is global, a search returns
  about 200 ms faster when *someone* searched that exact text that day.
  - **Fix:** key it by `(person, hash)`. Blue-3 §7.5 says the same for document embeddings, so apply it
    to the worker's "only hashes not already stored" lookup as well: per owner.
- **`sources UNIQUE (owner_id, lineage_key)`** (blue-4 §6.4). A contributor's agent adding evidence
  `web:<url>` in A's shared memory gets a conflict, or an existing row with an older `observed_at`. That
  tells it A cited that URL somewhere, perhaps in Health.
  - **Fix:** key sources by `(memory_id, lineage_key)`, and count lineage across memories only inside
    a definer function that returns a number to the owner.

---

## Rulings on the known inconsistencies (security lens)

1. **Layer on entries, and moves (blue-1 new derived entry vs blue-4 `memory_id` change).** For
   security, any change of `memory_id` is an audience change.
   - Allow it only through the version trigger, with `flow_allowed` enforced in the database (R1-08c).
     Every denormalized `memory_id` (vectors, chunks, uses) is updated in the same transaction (R1-09).
   - Prefer blue-1: a change of level is a new entry, since level-specific rules differ. Blue-4's "as-is
     promote" is then a refile only within a layer.
2. **Per-layer grants (blue-1) vs none (blue-3).** None. Blue-1's version permits core-as-viewer and
   silently shares future memories (R1-06).
3. **Workspaces as root (blue-1) vs grants (blue-3).** A root row is fine. `members` must become
   owner-only, and all other access goes through `memory_grants` (R1-06.3).
4. **Type drift:** blue-1/3 use `text` user ids (Better Auth), while blue-2/4 use `owner_id uuid`. Not a
   leak, but a type mismatch in a policy comparison would fail the migration. Use `text`.

---

## CLAUDE.md hard rules: preserved?

| Rule | Status after the fixes above |
|---|---|
| 1 Context, not execution | Holds. D20 pinning plus the single `approved_by` means another person's tasks never run on B's device (checked in `tasks/eligibility.ts`). Gap: unapproved collaborator scratch in autonomous packets (R1-14.4). |
| 2 Identity from token only | Broken by `forget_entry(p_actor)` and `audit_insert WITH CHECK (true)` (R1-01, R1-17). Otherwise held: `written_by`, `actor`, `on_behalf_of` all come from the token. |
| 3 Agents cannot approve/reject/release/delete or write global | Broken by RLS UPDATE (R1-10, proven), summary swap (R1-04), and `expires_at` fading (R1-10). Core writes held (blue-1 `ev_core_is_human`, blue-3 `memories_insert` humans only). |
| 4 Every query filtered, with a refused-case test | At risk: 14 tables lack a policy key (R1-11), partitions (R1-11), and grants live before RLS (R1-02). |
| 5 Tokens only in the header | At risk from Blob URLs (R1-12.1). |
| 6 Secret scan, size cap, quarantine | Gaps: unscanned fields, uncapped jsonb (R1-14.3), and quarantine bypass by vector (R1-03). |
| 7 Fenced packet, only approved rules | Gaps: name inside the label, admin rules steering the owner's agents, summary shown in place of approved body (R1-14.1-2, R1-04). |

---

## What I tried to break and could not

- **Email invite takeover.** Better Auth `accountLinking: { enabled: false }` (auth.ts:50), so a reused
  or reassigned address cannot attach to an existing user. Sign-in is gated by `mayEnter` on the
  allowlist. Blue-3 binds only to the `user` row's email and then still needs an explicit `accept`.
  Unbound invites lapse after 14 days. Self-invite is blocked (`owner_id <> p_user`). (Note: today's
  `onSignIn` auto-accepts. Blue-3 must replace it, not add to it.)
- **Grant tampering.** `memory_grants_guard` freezes the terms. A role change is revoke plus a new row.
  A revoked grant is final. Agents cannot grant, revoke or accept (`app_actor_kind` defaults to
  `agent`, the least power).
- **Stale identity on pooled connections inside `withActor`.** All keys are set locally on every
  transaction. `SET LOCAL` outside a transaction is a no-op that fails closed (no person means no rows).
  The InitPlan is re-run on each execution of a prepared statement.
- **Link existence leak.** `links_read` requires both ends to be readable. Blue-2's hop CTEs filter
  every hop by the readable set, and with RLS on `entry_links` the `fan` count cannot see hidden edges.
  (Without RLS, `fan` counts hidden edges and dampens the spread, a small side channel. That is one
  more reason not to ship sharing before step 4, R1-02.)
- **Exact vs HNSW path timing.** The switch depends only on the caller's own readable vector count.
- **Cross-person 404 vs 403.** `resolveMemory` gives 404 for "no role" and "no row"; the grant functions
  raise `not found` for unauthorized callers.
- **Revoked run token.** It is rechecked per call (blue-3 §6). The 30-minute token dies on the next
  request.
