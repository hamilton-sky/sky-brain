# Human-memory findings from the research thread (doc: https://claude.ai/artifact/XeikKAahzyCFfoRv8wdoRZ)
1. Two strengths per entry (Bjork): storage_strength only grows; retrieval_strength decays and resets on use. Rank by retrieval; demote/archive, never delete, when it is low.
2. Access-event log (entry, at, cue/context, actor, was_used), not just last_accessed. ACT-R activation ln(sum t^-0.5) gives recency+frequency+spacing in one number. Decay is power law.
3. Only USED retrievals (cited/acted on) strengthen; appearing in results doesn't.
4. Store encoding context per entry (project, goal/task, persona, source, time); match it at retrieval. Fuse cue routes: FTS on body, vector on gist, context match, then 1-2 hop spreading activation over links.
5. Keep BOTH verbatim episode (short-term, immutable) and gist (long-term, derived_from link). Embed gist + questions-it-answers, not the long body.
6. Keep signals: salience (user flag, decision, surprise/contradiction), open-goal relevance, repetition, schema fit (fits = fast promotion; novel = longer in short-term).
7. Consolidator replays new episodes interleaved with related old entries (finds links/conflicts, avoids interference).
8. Reconsolidation: a used entry is open to update, but as append-only versions with supersedes + reason.
9. Merge near-duplicates, distinctive cues, MMR diversity in results.
10. Resurface important-but-fading entries on an expanding schedule (gap ~10-20% of retention horizon).
11. Context packet: ~4 chunks (Cowan) of gists + pointers. Working memory per task, cleared when done; outcome becomes an episode.
12. Core = self-schema: small, always loaded, user-approved changes only.
Naming: psychology's short-term memory is seconds; sky-brain's short layer is really the recent-episode (hippocampal) store, days to weeks.
