# Red 2: data integrity, concurrency and SQL correctness

Lens: does the blue SQL run, do the invariants hold under concurrency, what is left behind when
versions change or things are forgotten, and can the migration ship through Drizzle.
Date: 23 Nov 2026.

## How this was tested

- A throwaway **PostgreSQL 16.15** cluster (system binaries, no install). Applied today's
  `apps/server/drizzle/0000-0004` migrations, then every SQL block of blue-1 in order
  (M1 enums, `item_types`, `memories` + guards, M3 rename, `entries`, `entry_versions`, the head
  triggers, deferred checks, `entry_links`, `episodes`, `entry_evidence`, `entry_chunks`,
  `memory_grants`, `entry_uses`, `forget_entry`, the goals change). `halfvec(1024)` was swapped
  for `real[]` (pgvector is not installed here); nothing else was changed.
- Two-session race tests ran with two `psql` clients and `pg_sleep` to force the interleaving.
- Blue-2/3/4 SQL was run where it stands alone (generated column, Hebrew normalizer,
  partitioned table with identity + FK); the rest is reasoned and marked so.
- Scripts and outputs: `red2/`.
- PGlite was not run (no `node_modules`). The repo pins `@electric-sql/pglite` 0.5.14, which is
  Postgres 17 based, so everything that ran on 16 should run there; the race findings cannot be
  tested in PGlite at all (one connection), only in the `*.pg.test.ts` suite.

**Headline: blue-1's DDL runs cleanly on Postgres 16** (once two legacy names are renamed, R2-10).
The defects are in behaviour, not syntax.

---

## Findings

### R2-01 (high) The DB guards are switched off by a setting any session can set

**Where:** blue-1 §4.3 `entries_guard`, `entry_versions_append_only`; §10 `forget_entry`.

**Scenario (run):** any connection, including the app role, runs

```sql
BEGIN; SELECT set_config('sky_brain.head_sync','on',true);
UPDATE entries SET trust='approved', title='forged' WHERE id=:e; COMMIT;
-- result: entries.trust='approved', title='forged'; entry_versions still says v1 'proposed'
BEGIN; SELECT set_config('sky_brain.forget','on',true);
UPDATE entry_versions SET trust='approved', changed_by_kind='human' WHERE entry_id=:e; COMMIT;
-- result: history rewritten; append-only and ev_agent_never_approves both bypassed
```

Custom `sky_brain.*` settings are writable by every role. Decision 12 ("the DB makes a bug fail
closed") is not met: one stray `set_config` in route code, or any SQL injection, turns off the
head-cache guard and append-only. The head cache can also drift from the versions silently,
and nothing ever compares them.

**Fix (tested):** do not trust a setting. For head sync, let the guard allow head columns only
when the update comes from inside a trigger:

```sql
IF pg_trigger_depth() < 2 AND (NEW.head_version, ...) IS DISTINCT FROM (OLD.head_version, ...) THEN
  RAISE EXCEPTION 'entries content changes only through a new entry_versions row';
END IF;
```

Run: with the GUC set to `on`, a direct `UPDATE entries SET trust` is refused; a new version
still updates the head. For forget, make `forget_entry` `SECURITY DEFINER` owned by the migration
role and have the append-only trigger allow UPDATE only when `current_user = '<owner role>'`
(inside a definer function `current_user` is the owner; the app role can never be it). Add a
nightly check query: head columns = the row of `entry_versions` at `head_version`.

### R2-02 (high) Every version write takes a lock that deadlocks with FK inserts

**Where:** blue-1 §4.3 `entry_versions_before_insert` (`FOR UPDATE` on `entries`),
`entry_versions_after_insert` (`seq = nextval(...)` with `entries_seq_unique`, and
`SELECT ... FROM memories ... FOR UPDATE` for the core cap).

**Why:** inserting any row with an FK to `entries` (a link, a use, evidence, a chunk, a
retrieval hit) takes `FOR KEY SHARE` on that entry until commit. `FOR UPDATE` conflicts with
`KEY SHARE`. Worse, the head-sync `UPDATE` changes `seq`, which has a UNIQUE index, so Postgres
treats every head sync as a key update and takes `FOR UPDATE` too, even if the trigger is
softened.

**Scenario 1 (run): two consolidations of the same short item S**, as blue-1 §7 orders the
writes (new entry L, link `L derived_from S@1`, then S v2 `consolidated`):

```
C1: insert L1, link L1->S (KEY SHARE on S) ... sleep ... insert S v2 -> waits for C2
C2: insert L2, link L2->S (KEY SHARE on S), insert S v2 -> waits for C1
=> ERROR: deadlock detected (one aborted after deadlock_timeout)
```

**Scenario 2 (run): two concurrent core writes** (not even over the cap). Both `INSERT INTO
entries` (FK → KEY SHARE on the core `memories` row), then each version's after-trigger asks
`FOR UPDATE` on that row → deadlock.

Same shape: a packet transaction that logs `entry_uses` for 8 entries blocks every edit of
those 8 entries until it commits.

**Fix (tested):**

```sql
-- before-insert trigger
SELECT * INTO e FROM entries WHERE id = NEW.entry_id FOR NO KEY UPDATE;
-- core cap
SELECT * INTO m FROM memories WHERE id = NEW.memory_id FOR NO KEY UPDATE;
-- seq: keep the sequence, drop the unique constraint (nextval is already unique)
ALTER TABLE entries DROP CONSTRAINT entries_seq_unique;
CREATE INDEX entries_seq_idx ON entries (seq);
```

After the fix, scenario 1 ends with C2 committed and C1 refused cleanly with
`stale write: entry ... is at version 2` (no deadlock), and scenario 2 serializes: with
`max_items = 2` and one item present, the second concurrent add is refused with
`core memory is full`. `FOR NO KEY UPDATE` still serializes writers to one entry, which is all
the version check needs.

### R2-03 (high) Forget is incomplete in blue-1 and impossible in blue-2/blue-4

**Where:** blue-1 §10 `forget_entry`; blue-2 §4.1 `entry_summaries` (append-only + `ON DELETE
CASCADE`), §4.3 `entry_vectors`, §6 `retrievals.query`, `entry_uses`; blue-4 §2.3
`entry_lifecycle_events` (FK NO ACTION), §4.2 `entry_uses`, `packet_items`, §6.4 `entry_evidence`,
§6.5 `review_events` (append-only + `ON DELETE CASCADE`), §6.1 `episodes.body`; blue-3 §7.5.

**Scenario (run on blue-1):** an entry about "my divorce lawyer Dana Cohen" is linked and used,
then forgotten with `forget_entry`. After forget:

| What survives | Shown by |
|---|---|
| `entry_versions.content_hash` = sha256(title‖body) of the real text | a guessed text hashes to the stored value (`hash_still_confirms_text = t`); also the near-dup index will flag a re-capture of the same text |
| `entry_links.reason` "both are about my divorce lawyer Dana Cohen" | selected after forget |
| `entry_uses.cue` `{"q": "divorce lawyer fees"}` | selected after forget |
| blue-2 `entry_summaries.summary`, `entry_vectors` (summary inversion) | `forget_entry` never touches them |
| blue-4 `episodes.body` (verbatim sealed scratch), `proposals.reason`, `entry_uses.query_text` | same |

**Scenario (run) on the blue-2/blue-4 path:** they rely on `ON DELETE CASCADE` from `entries`
into tables that are append-only. Postgres fires the child's BEFORE DELETE trigger on a
cascade, so the parent delete aborts:

```
DELETE FROM plain_parent WHERE id=1;
ERROR:  audit_log is append-only: DELETE is not allowed
SQL statement "DELETE FROM ONLY "public"."plain_child" WHERE $1 OPERATOR(pg_catalog.=) "pid""
```

blue-4 also points `entry_lifecycle_events` at `entries` with NO ACTION and keeps it forever,
so an `entries` row with any event can never be deleted. "A privileged role" does not help
(triggers still fire unless `session_replication_role = replica`, which needs superuser, which
a managed Nanogres role does not have).

**Fix:** pick blue-1's tombstone model (keep ids, kill text) and make forget **one function
with an explicit scrub list over every table**, not cascades:

- `entry_versions`: title/body/summary/props/capture_context/change_note scrubbed and
  `content_hash` set to a constant (e.g. `'\x00'`; drop it from the near-dup index for
  `redacted_at IS NOT NULL`).
- `entry_summaries`: summary/questions scrubbed; `entry_vectors`, `entry_chunks`,
  `embedding_jobs`: deleted.
- `entry_links.reason`, `entry_evidence.note/ref`, `entry_uses.cue/query_text`,
  `retrievals.query` (for retrievals that hit it), `proposals.reason`: scrubbed.
- Episodes whose text the entry came from: forgotten by the same function or listed for the
  person ("this text also exists in 2 episodes: forget those too?").
- Every append-only trigger allows exactly this through the `current_user` check of R2-01.
- Remove `ON DELETE CASCADE` from append-only children (it can only ever fail), and say in one
  place that entries are never deleted. A real "delete the brain" is `forget_workspace()`.

A test should list every column of type text/jsonb/vector in the schema and assert that forget
either scrubs it or that it holds no entry-derived text.

### R2-04 (high) Denormalized `memory_id` goes stale when an entry moves, and the hybrid query does not re-check it

**Where:** blue-1 §7 (refile = new version with a new `memory_id`), §9.1 `entry_chunks.memory_id`
("refile updates chunks in the same tx": app code); blue-2 §4.3 `entry_vectors.memory_id`,
§7 hybrid query; blue-3 `entry_links.from_memory_id/to_memory_id`; blue-4 §3 "short → long
as-is = new version with the long `memory_id`".

**Scenario (run):** entry R1 in the shared "Family inbox", with a summary chunk. The owner
refiles it to the private "Inbox":

```
 entry_mem (after refile)              | chunk_mem
 ...05a1 (private inbox)               | ...05a2 (family inbox, still)
```

blue-2's vector route filters `v.memory_id = ANY($1)` and then `fused → cand → scored` join
`entries` **without** re-checking `memory_id` or status (only `seeds`, used for spreading, does).
So a family member's search returns the moved entry's title and summary until a re-embed job
runs, and blue-2's job reasons (`level_changed`, no `refile`) may never run one. The same hole
returns quarantined entries whose vectors are still waiting for the async delete, and blue-1's
forget never deletes vectors at all. With blue-3's RLS on `entries` the final join hides the row,
but the RRF ranks of visible items are still computed with it (rank side channel), and blue-1's
M6 plan is app-level filtering, not RLS.

**Fix, two layers:**

1. Make the copy impossible to go stale (tested on a hash-partitioned table in PG16):

```sql
ALTER TABLE entries ADD CONSTRAINT entries_id_memory_unique UNIQUE (id, memory_id);
-- on entry_chunks, entry_vectors (partitioned is fine), entry_summaries, links ends:
FOREIGN KEY (entry_id, memory_id) REFERENCES entries (id, memory_id)
  ON UPDATE CASCADE ON DELETE CASCADE   -- (no CASCADE delete into append-only tables, R2-03)
```

Run: after refile the vector row's `memory_id` followed in the same transaction, and inserting
a vector with the old `memory_id` is refused by the FK.

2. In blue-2's query, re-filter in `scored`:
`WHERE e.memory_id = ANY($1) AND e.trust <> 'quarantined' AND e.lifecycle = 'active' AND e.forgotten_at IS NULL`,
and delete vectors synchronously (same transaction) on quarantine and forget, not through the job.

Better still, see the layer ruling below: forbid moving an entry between memories at all.

### R2-05 (high) Grant changes and flow-checked writes race (write skew)

**Where:** blue-3 §5.4 `flow_allowed`, §5.6 `grant_memory` / `revoke_grant`, §7.1
("checked when a grant is added, too"). Reasoned, not executed.

**Scenario A (grant vs derived write):** memory M has no readers but the owner. The owner's
Consolidator computes `flow_allowed(M, {Health})` = true and starts inserting a gist of Health
entries into M. In parallel the owner (other tab) runs `grant_memory(M, Dana)`; its "M holds 0
entries built from memories Dana cannot see" check runs before the gist commits. Both commit.
Dana now reads Health text in M, and neither check saw the other. Nothing locks: the flow check
reads `memory_grants`, the grant check reads `entries`, each writes the other table.

**Scenario B (revoke vs write):** Dana's agent passes the RLS `WITH CHECK` (statement snapshot)
and then holds its transaction open (embedding call, evidence rows); the owner's `revoke_grant`
commits and releases Dana's task claims; Dana's insert commits after the revoke, and a claim
taken in that window outlives the cleanup.

**Fix:** one lock per memory, ordered:

```sql
-- every write that relied on a permission or flow check, at the start of its transaction,
-- for the target and every source memory, in uuid order:
SELECT pg_advisory_xact_lock_shared(hashtextextended('mem:' || m::text, 0)) FROM unnest(:mems) m ORDER BY m;
-- grant_memory / revoke_grant / accept_grant / bind_invites, before reading anything:
SELECT pg_advisory_xact_lock(hashtextextended('mem:' || p_memory::text, 0));
```

Then re-run the permission and flow checks **after** taking the lock. The repo already uses
transaction advisory locks (`onSignIn`, the board), so this fits PgBouncer transaction mode.
Equivalent row-lock form: writers `SELECT ... FROM memory_grants WHERE id=:g AND revoked_at IS NULL FOR SHARE`
(a revoke's UPDATE takes `FOR NO KEY UPDATE`, which waits for it; after the revoke, the writer's
re-check finds no row and refuses).

### R2-06 (medium) "An observation needs evidence" breaks every later version of an observation

**Where:** blue-1 §4.4 `entries_commit_checks`.

**Scenario (run):** observation O v1 with one `entry_evidence` row commits fine. The steward's
`resummarize` v2 (or a person's approve, or the `consolidated` lifecycle version) fails at commit:
`ERROR: an observation needs evidence`, because the check looks for evidence on
`version_no = head_version` and evidence attaches to one version.

**Fix:** evidence belongs to the *content* version:

```sql
IF e.kind = 'observation' AND NOT EXISTS (
     SELECT 1 FROM entry_evidence ev JOIN entry_versions v
       ON v.entry_id = e.id AND v.version_no = e.head_version
     WHERE ev.entry_id = e.id AND ev.version_no = v.content_from_version) THEN ...
```

### R2-07 (medium) The version rules both block a needed write and allow a wrong one

**Where:** blue-1 §4.3 before-insert trigger vs §7.

- **Blocked (run):** consolidating an approved short capture. §7 says the S version
  `lifecycle='consolidated'` is "the one lifecycle an agent may set", but the trigger refuses
  any agent version of an approved entry except `resummarize`:
  `ERROR: agents do not version an approved entry`. A person's own captures are often approved,
  so the normal case fails. Fix: either record the accepting person as `changed_by` (blue-4 has
  consolidation applied on a person's accept anyway), or add the exception
  `NEW.change='lifecycle' AND NEW.lifecycle='consolidated' AND NEW.content_hash = prev.content_hash AND NEW.trust = prev.trust`.
- **Allowed (run):** an agent writes `change='resummarize'` on a non-approved entry with a new
  body (`TOTALLY NEW BODY` stored as v3). The content-unchanged check only runs for approved
  entries. Fix, for everyone:
  `IF NEW.change='resummarize' AND (NEW.content_hash <> prev.content_hash OR NEW.content_from_version <> prev.content_from_version) THEN RAISE`.
  Same for `refile`, `trust`, `lifecycle`.

### R2-08 (medium) Stale-summary detection trusts the wrong version, and late summaries win

**Where:** blue-1 §4.2 (`summary_for_version`), blue-2 §4.1 (`for_body_hash`,
`entries.summary_id`), blue-2 §4.3 pipeline step 4. Reasoned.

- **Server-stamped freshness.** The Consolidator reads v3, a person saves v4 with new text,
  then the Consolidator's summary arrives. If the server stamps `summary_for_version` /
  `for_body_hash` from the *current head* at write time, a summary of v3 is recorded as fresh
  for v4, and `needs_summary` / `summaries_needing_work` never fire. Rule: the summarize call
  carries the version (or body hash) the writer was served; the DB compares it with the head
  and refuses with 409 if they differ. In blue-1 this holds only if the API passes the caller's
  base version as `version_no`, never `head_version + 1` computed by the server; say so.
- **Head pointer regression (blue-2).** `entries.summary_id` has no rule, so a late steward
  summary for v3 can replace a person's summary for v4. Fix: the trigger that moves the head
  pointer only advances when `NEW.for_version >= (for_version of the current head summary)`,
  and `FOREIGN KEY (summary_id, id) REFERENCES entry_summaries (id, entry_id)` so the head
  can only point at its own entry's summary (needs `UNIQUE (id, entry_id)` there).
- **Embedding job check-then-act.** The worker checks `current_version` before the model call
  (100-300 ms) and upserts after it; a v2 job finishing after the v3 job overwrites v3's vector.
  Fix: make the upsert itself monotonic:
  `ON CONFLICT (owner_id, entry_id, facet, ordinal, model_id) DO UPDATE SET ... WHERE entry_vectors.version <= EXCLUDED.version`,
  and delete surplus ordinals only `WHERE version < :v`.

Recommendation on the two summary designs: keep blue-2's separate append-only
`entry_summaries` (one row per summary, `for_version`, author) and drop blue-1's "resummarize =
a whole new entry version". Blue-1's way copies a body of up to 256 KB per re-summary, bumps
`head_version` (so a steward re-summary makes the person's open edit fail as a stale write),
and needs the "agent may version an approved entry" exception that R2-07 shows is leaky. The
owner's rule ("each summary belongs to one entry version and records its author") is exactly
`entry_summaries(entry_id, for_version) → entry_versions`.

### R2-09 (medium) Two lifecycle columns, and blue-4's event log can lie

**Where:** blue-1 `entries.lifecycle` (head cache of `entry_versions.lifecycle`:
active/superseded/closed/rejected/retracted/consolidated, writable only via a version);
blue-4 `entries.lifecycle_state` (active/sealed/faded/archived/merged/superseded/closed/forgotten,
a mutable field + `entry_lifecycle_events`). Reasoned.

- Conflict: blue-1's `entries_guard` refuses blue-4's direct `lifecycle_state` change only if it
  is the same column; with two columns, "superseded" and "closed" exist in both and will drift.
- Race: blue-4 records `from_state` in app code. Two accepts of overlapping merge proposals
  (A+B → G1, A+C → G2, two tabs) both read A as `active`, both insert an `active → merged` event
  (valid per `lifecycle_transitions`) and both update A. A is merged into two gists; the event
  log shows two transitions from `active`. Same for the fade sweep vs. a use that reactivates.

**Fix:** split by meaning. *Epistemic status* (superseded, closed, rejected, retracted) is
content history: versioned, blue-1. *Retention state* (active, sealed, faded, archived, merged,
forgotten) is bookkeeping like `expires_at`: one mutable column, changed only by

```sql
UPDATE entries SET retention = :to WHERE id = :id AND retention = :from RETURNING id;  -- 0 rows → 409
```

and an `AFTER UPDATE OF retention` trigger writes the event from `OLD.retention`/`NEW.retention`
(so `from_state` cannot be wrong) and checks the transition table.

### R2-10 (medium) The migration plan: what breaks between M1 and M7

**Where:** blue-1 §11.2-11.3, blue-3 §10; repo `db/migrate-cli.ts` (migrations run in the
Vercel build, before the new code is live), `auth/on-sign-in.ts`.

1. **M3 name collisions (run).** `ALTER TABLE entries RENAME TO entries_legacy` keeps the
   constraint `entries_seq_unique` and index `entries_search_idx`; the new `entries` reuses both
   names: `ERROR: relation "entries_seq_unique" already exists`, and the whole new table fails.
   Rename both (`ALTER TABLE entries_legacy RENAME CONSTRAINT ...`, `ALTER INDEX ... RENAME`);
   with that, all blue-1 DDL ran.
2. **Simpler M3.** No route reads or writes `entries` today (only `entries-view.ts`, unused by a
   router), so production almost certainly holds no rows. Replace rename + copy + M7 with
   `DO $$ BEGIN IF EXISTS (SELECT 1 FROM entries) THEN RAISE EXCEPTION 'legacy entries not empty'; END IF; END $$;`
   then `DROP TABLE entries` and create the new one. That removes the 11.3 mapping, the
   `entries_legacy` table and the old enums in one step. If the guard ever fires, write the copy
   then. (The copy as specced can also fail: more than 60 legacy workspace-scope rules exceed the
   core `max_items`.)
3. **Deploy window (run for the trigger).** Migrations run before the alias swap, so for a few
   minutes the old `onSignIn` runs against M1. It inserts a workspace without a core memory; the
   deferred trigger refuses it at commit (`workspace ... has no core memory`); `onSessionCreated`
   catches and logs the error, so a new person signs in with no brain, silently. Ship the code
   that creates memories first (tolerant of both schemas) and add the deferred trigger in the
   *next* migration.
4. **M2 backfill** assumes every project has a working memory. Projects created by old code
   between M1 and M2 have none, and `SET NOT NULL` fails the build. The M2 migration must first
   `INSERT ... SELECT` missing working memories.
5. **`onSignIn`'s test** "no `members` row → create a workspace" must become "no workspace with
   `owner_user_id = me`"; otherwise a person who is only a member elsewhere never gets a core
   (requirement 2).
6. **Drizzle.** drizzle-orm 0.45 / drizzle-kit 0.31 cannot express: constraint triggers,
   `DEFERRABLE`, `ON DELETE SET NULL (project_id)` (column list), `PARTITION BY`, untyped
   `halfvec` with a per-model expression HNSW index, `FORCE ROW LEVEL SECURITY`, and plpgsql
   functions. The repo already has the pattern (`0001`, `0004` are `--custom` migrations).
   The trap: a custom migration copies the previous snapshot, so a table created in custom SQL
   *and* declared in `schema.ts` is emitted again by the next `drizzle-kit generate`. Rule:
   tables Drizzle can model (memories, entries, entry_versions, links...) go through normal
   generated migrations; triggers, functions, deferred constraints, SET NULL (col) FKs, RLS force
   go in a following custom migration. Partitioned `entry_vectors` is declared in a second file
   that is **not** in `drizzle.config.ts`'s `schema` (typed queries, no generated DDL), with its
   DDL only in custom SQL. Composite FKs, partial unique indexes and `generatedAlwaysAs` are fine
   in Drizzle.
7. **Hebrew search depends on a UTF-8 database (run).** blue-2's `sb_norm` in a `SQL_ASCII`
   database strips every Hebrew letter (the niqqud byte range covers the letters' bytes): a
   title `צה"ל הבית` indexed to nothing. In UTF-8 it gives `'צהל' 'הבית' 'בראשית'` as intended.
   Add `DO $$ BEGIN IF current_setting('server_encoding') <> 'UTF8' THEN RAISE ...` to the
   migration that creates it.

### R2-11 (low) Three `entry_uses` and two stat rollups

blue-1 §9.3 (`use_kind` incl. `shown`, `counted` generated, FK NO ACTION), blue-2 §6.1
(`weight`, `episode_key`, unique dedupe, CASCADE), blue-4 §4.2 (enum incl. `created`,
`contradicted`, `pinned`, `hour_bucket` unique, CASCADE); plus blue-2 `entry_strength` and
blue-4 `entry_stats`. Pick one table (blue-4's kinds, blue-2's `retrieval_id` link, no
`shown`: exposures go to `retrieval_hits`/`packet_items`) and one rollup. Two details either way:
blue-4's partial unique index means every use insert must be
`ON CONFLICT (entry_id, actor, hour_bucket) WHERE kind IN ('opened','cited','acted_on') DO NOTHING`
or a duplicate aborts the whole `report_task`; and it drops a `cited` that follows an `opened`
in the same hour, so citation counts are lost (put `kind` in the key). The rollup trigger should
use `greatest(last_used_at, NEW.at)` (out-of-order commits) and `(NEW.at AT TIME ZONE 'UTC')::date`
(not the session time zone) for "distinct days".

### R2-12 (low) blue-3 audit trigger writes a NULL action on a no-op update

`memory_grants_audit` has a `CASE` with no `ELSE`; any UPDATE that changes none of the four
transitions inserts `action = NULL` into `audit_log.action NOT NULL` and fails. Add
`ELSE RETURN NEW` (skip) or `WHEN ... ` guard `IF v_action IS NULL THEN RETURN NEW; END IF;`.

---

## The key types: one root, one owner column

blue-1 keys everything by `workspace_id uuid`; blue-2 and blue-4 by `owner_id uuid`; blue-3 by
`owner_id text` and retires `workspaces`. Better Auth's `"user".id` is **text**, so blue-2's
`entry_vectors.owner_id uuid` (its partition key) and blue-4's `owner_id uuid` cannot hold a user
id at all.

**Ruling: keep `workspaces` as the brain root (blue-1), with `owner_user_id text UNIQUE`.**
Partition and filter by `workspace_id uuid`. Retire `members` and `invites` as blue-3 says, but
not the `workspaces` row. Reasons: `projects`, `goals`, `tasks`, `run_tokens`, `audit_log` all
carry `workspace_id` with composite FKs today; dropping it rewrites every one for no gain
(it is 1:1 with the person); and the composite FK `(memory_id, workspace_id, layer)` is what
makes cross-brain rows impossible (below). blue-3's grant table becomes
`FOREIGN KEY (memory_id, workspace_id, layer) REFERENCES memories (id, workspace_id, layer)`,
and `memory_role()` reads the owner from `workspaces.owner_user_id`.

## Ruling: layer on the memory or on the entry?

**The layer belongs to the memory. The entry carries a read-only copy. An entry never changes
memory.**

- Truth on the memory (blue-1, blue-3, blue-4 agree): grants, TTL, caps and "one core" are
  memory rules.
- Copy on the entry (blue-1) is safe and worth it: per-layer `CHECK`s need it, the composite FK
  `(memory_id, workspace_id, layer) → memories` plus "a memory never changes layer" makes drift
  impossible. Verified: an `entry_versions` row with another layer is refused by the trigger.
- **No moves, not even within a layer.** Overrule blue-4's "short → long as-is is a field change"
  and blue-1's same-layer `refile`. Use blue-3 §7.7: a move is a new entry in the target memory
  with a `derived_from` (or `supersedes`) link pinned to the source version, and the source goes
  `consolidated`/`superseded`. Reasons from this lens:
  1. Every derived table (chunks, vectors, summaries, uses, link ends in blue-3) copies
     `memory_id` for filtering; a move makes all of them stale at once (R2-04).
  2. A move changes who can read the text; a new entry goes through the flow rule and RLS
     `WITH CHECK` on insert, which a moved row skips (blue-3 policies only check the new
     `memory_id` on UPDATE, not that the sources' readers agree).
  3. Two memories in one layer can have different readers (shared "Family inbox" vs private
     "Inbox"), so "same layer" is not "same audience".
  4. blue-4's reason for moves (keep use history) is met by seeding the new entry's stats from
     the source's uses, which blue-4 already does for merges.
  Then `entries.memory_id` is immutable (add it to `entries_guard`'s identity list) and the
  `ON UPDATE CASCADE` FKs of R2-04 become a belt-and-braces check.
- Per-layer grants (blue-1 §9.2): drop them, as blue-3 says. A layer grant cannot be checked by
  the flow rule (its reader set changes when a memory is created), and with consolidation it
  makes ageing a sharing act.

## Cross-brain links

blue-1's FKs `(from_entry, workspace_id)` and `(to_entry, workspace_id)` make a link across two
brains impossible (held). blue-3 §9.2 assumes they exist ("links the grantee made from their own
memories into the owner's"). Keep blue-1's rule. A real FK across brains can only be NO ACTION
(the grantee's link then blocks the owner's forget) or CASCADE (the owner's delete destroys the
grantee's rows). If a grantee needs to point at the owner's entry, store a soft reference in
the grantee's brain (`external_refs(from_entry, target_entry_id, target_workspace_id)`, no FK,
no relation semantics, never walked by spreading activation), resolved through RLS at read time
and shown as "unavailable" after a revoke or forget.

## Cascades that destroy history

- Good in blue-1: `entries → memories` and `entry_versions → entries` are NO ACTION, so
  `DELETE FROM workspaces` with history fails (run: refused on `entries_in_memory_fk`), and the
  `"user"` delete is refused by `workspaces_owner_user_id_fkey` (run). Make that explicit in the
  account-deletion story (it needs `forget_workspace()` first).
- Bad: blue-1 `memory_grants.grantee_user_id ... ON DELETE CASCADE` erases who had access when a
  grantee account is deleted (only the audit rows remain). Use NO ACTION plus a revoke, like
  blue-3's guard does.
- Bad: blue-2 `retrieval_hits`, `entry_summaries`, `entry_uses`, and blue-4 `entry_uses`,
  `entry_evidence`, `review_events`, `packet_items` cascade from `entries`; with append-only
  triggers these cascades can only fail (R2-03), and without them they would erase summary
  authorship and evidence lineage. Use NO ACTION everywhere and the scrub function.

---

## What I tried to break and could not

| Attack | Result |
|---|---|
| blue-1 DDL on Postgres 16 (enums, composite FKs, partial unique indexes, `ON DELETE SET NULL (project_id)`, constraint triggers, `tstzrange` + GiST, generated `counted`) | All created without error (after the R2-10 renames). |
| Two agents edit the same entry from v1 at the same time | Second gets `stale write: entry ... is at version 2`; history has exactly v1, v2. Holds (only if the API sends the caller's base version). |
| Direct `UPDATE entries SET trust=...` without the GUC | Refused by `entries_guard`. |
| Layer change through a new version | Refused by the trigger and the composite FK. |
| Delete the core memory directly | Refused (`the core memory cannot be deleted`). |
| Delete a brain that has only memories | Cascade passes the guard (the parent is already gone in the cascade); 0 memories left. Holds on PG16. |
| A workspace without a core | Refused at commit by the deferred trigger. |
| `ON DELETE SET NULL (project_id)` | Long memory survives with `project_id` NULL; a project with a working memory cannot be deleted (CHECK refuses). Works on PG16, so on PGlite 0.5 (PG17) too. |
| Delete a brain that has entries; delete its owner's user row | Both refused (history pins it). |
| Two cores per person under concurrent sign-in | `onSignIn`'s advisory lock + `workspaces_one_brain_per_person` + `memories_one_core_per_workspace` (or blue-3's partial unique on owner) leave no path to two. |
| Core cap under concurrent writes | With the R2-02 fix: serialized, the over-cap write is refused, no deadlock. |
| Cross-brain link row in blue-1 | Impossible by the `(entry, workspace_id)` FKs. |
| blue-2 generated `search` column with `sb_norm`/`sb_join` | Accepted as IMMUTABLE; correct Hebrew tokens in a UTF-8 database. |
| blue-2 hash-partitioned table with an identity column, composite PK and FK to `entries` | Works on PG16 (insert through the parent). FK `ON UPDATE CASCADE` into partitions works. |
| blue-3 two concurrent `grant_memory` for the same person and memory | The partial unique `memory_grants_one_open_user` makes the second fail closed. |
| blue-1 `entries_head_filled` CHECK precedence (`OR` / `AND` without outer parentheses) | Parses as intended (`head_version = 0 OR (... AND ...)`). |

One more caution from the generated-column test: blue-2 makes `entries.search` a generated
column over `entries.body`, but blue-1's `entries` has no `body` and its head trigger writes
`search` itself; a trigger write to a generated column fails (run:
`column "search" can only be updated to DEFAULT`). Keep blue-1's trigger-maintained `search` and
move blue-2's expression (normalizer, variants, English D layer) into that trigger.

---

## Summary

Blue-1's DDL runs on Postgres 16 as written, once two legacy names that collide in M3 are
renamed. The defects show up in behaviour.

1. **R2-01:** the database guards (head cache, append-only versions) switch off with a
   `set_config` that any session can call. Fix: `pg_trigger_depth()`, and a `current_user`
   check inside a SECURITY DEFINER forget.
2. **R2-02:** `FOR UPDATE`, plus a unique index on a `seq` that every version bumps, deadlocks
   with any FK insert. Shown: two consolidations of one item deadlock, and two core writes
   deadlock. Fix (tested): `FOR NO KEY UPDATE` and a non-unique `seq` index.
3. **R2-03:** forget leaves recoverable traces behind. The content hash still confirms the
   text, and link reasons, use cues, summaries and vectors survive. Blue-2 and blue-4 rely on
   cascades into append-only tables, and those cascades can only fail.
4. **R2-04:** moving an entry leaves the denormalized `memory_id` stale on chunks and vectors.
   Blue-2's final query does not re-check memory or quarantine.
5. **R2-05:** grant changes race with flow-checked writes. Fix: per-memory advisory locks.
6. Medium: observation evidence breaks every later version; resummarize can change the body;
   summary freshness is stamped from the wrong version; there are two lifecycle columns; and
   migration and Drizzle traps.

**Rulings:**
- Layer lives on the memory, with a guarded copy on the entry.
- An entry never changes memory. A move is a new derived entry.
- No per-layer grants.
- Keep `workspaces` as the root (user ids are text).
- Use blue-2's separate `entry_summaries`.
- No cross-brain foreign keys.
