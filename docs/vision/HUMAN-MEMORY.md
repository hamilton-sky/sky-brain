# How human memory retrieves and preserves: lessons for sky-brain

Research, 23 Nov 2026. Live doc: https://claude.ai/artifact/XeikKAahzyCFfoRv8wdoRZ

The human brain retrieves well because it stores two things per memory (a fast verbatim episode and a slow, linked gist), indexes them by the context they were learned in, and strengthens whatever gets used. It preserves well by replaying recent memories against old ones during sleep, spacing out re-use, and letting unused things fade from reach without erasing them. sky-brain can copy all of this, and improve on the parts where human memory fails (distortion on recall, lost sources).

The main principles for sky-brain (the full table of 14 is under [Design principles](#design-principles-for-sky-brain)):

1. Track two strengths per entry: storage strength (only grows) and retrieval strength (decays, resets on use).
2. Log every access, and score activation from that log with a power-law decay.
3. Only a retrieval that was used should strengthen a memory.
4. Store the context an entry was learned in, and match it at retrieval.
5. Keep both the verbatim episode and its gist. Embed the gist, search the body by keywords.
6. Keep what is salient, relevant to open goals, repeated, or a fit with existing structure.
7. Consolidate by replaying new items together with related old ones.
8. Treat a used entry as open to update, but write updates as new versions.
9. Fight interference: merge near-duplicates, keep cues distinctive, diversify results.
10. Resurface important but fading entries on an expanding schedule.
11. Hand agents a few chunks plus pointers, never a dump.
12. Keep core memory small, always loaded, and changed only by the user.

## Memory systems and sky-brain's layers

The brain has several memory systems with different speeds and jobs, and sky-brain's four layers map onto them well, with one naming catch.

| Human system | What it does | sky-brain layer |
| --- | --- | --- |
| Working memory ([Baddeley, 2000](https://doi.org/10.1016/S1364-6613(00)01538-2)) | Holds and manipulates about 4 chunks for the task at hand ([Cowan, 2001](https://pubmed.ncbi.nlm.nih.gov/11515286/)) | Working memory: the blackboard for a goal or task |
| Hippocampal episodic store | Learns fast, one-shot, keeps verbatim episodes with time and place | Short memory: recent episodes, days to weeks |
| Neocortical semantic memory ([McClelland et al., 1995](https://pubmed.ncbi.nlm.nih.gov/7624455/)) | Learns slowly, stores gist and structure, richly linked | Long memory: consolidated facts, decisions, patterns |
| Self-memory system ([Conway & Pleydell-Pearce, 2000](https://research-information.bris.ac.uk/en/publications/the-construction-of-autobiographical-memories-in-the-self-memory-/)) | Goals and self-image that steer what is encoded and recalled | Core memory: identity, values, standing rules |

The catch: in psychology, short-term memory lasts seconds and is close to working memory. What sky-brain calls "short memory" is really the recent-episode store. Naming it "recent" or "episodic" in the schema would avoid confusion.

Two more distinctions matter. Episodic memory holds specific events, and semantic memory holds general knowledge distilled from many events. Over time, episodes lose detail and become semantic ([trace transformation, Winocur & Moscovitch, 2011](https://www.cambridge.org/core/product/18511C7CFD1671AA7A5F2A3E93BED12D)). And people run several working memories in sequence but not in parallel. Software can run many in parallel, which is why per-task blackboards are a sound choice.

## Encoding: what makes a memory retrievable later

How a memory is stored decides how it can be found. The brain stores meaning, links and context, not raw text.

- **Depth of processing.** Material processed for meaning is remembered far better than material processed for surface form ([Craik & Lockhart, 1972](https://psych205.stanford.edu/papers/CraikLockhart72.pdf)). For sky-brain, an entry should be stored with what it means: a gist, its kind (fact, decision, hypothesis) and why it matters.
- **Elaboration and links.** Memories tied to many existing memories have more routes back to them. Linking at write time is not overhead, it is what makes retrieval work.
- **Schemas.** New information that fits an existing framework is integrated much faster, in rats within a day instead of weeks ([Tse et al., 2007](https://pubmed.ncbi.nlm.nih.gov/17412951/)). Entries that fit an existing project, topic or pattern can be promoted quickly. Novel ones need more review.
- **Salience and emotion.** Emotionally arousing events get stronger consolidation through amygdala signals to the hippocampus ([McGaugh, 2004](https://doi.org/10.1146/annurev.neuro.27.070203.144157)). sky-brain's equivalent is an importance signal: the user flagged it, it was a decision, it surprised or contradicted something.
- **Context is stored with the content.** The time, place, task and mood of learning become part of the memory, and later serve as cues (next section).

Design consequence: the write path should capture gist, kind, links, context and importance at the moment of writing, because they cannot be reliably recovered later.

## Consolidation: how the brain decides what to keep

The brain keeps two learning systems on purpose. The hippocampus learns new episodes in one shot. The neocortex learns slowly and extracts structure. If the neocortex learned new things fast and alone, they would overwrite old knowledge ("catastrophic interference"). So the hippocampus replays new memories interleaved with old ones, and the neocortex slowly absorbs them ([McClelland, McNaughton & O'Reilly, 1995](https://pubmed.ncbi.nlm.nih.gov/7624455/)).

Much of this replay happens during sleep. Slow-wave sleep reactivates recent memories and transfers them to long-term networks, and sleep favours abstraction and gist over detail ([Diekelmann & Born, 2010](https://www.nature.com/articles/nrn2762.pdf)). Replay of overlapping memories extracts what they have in common, which builds schemas ([Lewis & Durrant, 2011](https://orca.cardiff.ac.uk/111453/1/Lewis.%20How%20memory%20replay.pdf)).

Consolidation is selective. One study found sleep boosted memories people expected to need later more than others ([Wilhelm et al., 2011](https://pubmed.ncbi.nlm.nih.gov/21289163/)), though a later attempt did not replicate that ([PLOS ONE, 2021](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8568116/)). Salience (above) and repetition are more robust selection signals.

What this means for the nightly Consolidator:

1. Work on recent episodes **together with** related long-term entries, not on new items alone. That is where links, contradictions and duplicates show up.
2. Write gist entries into long memory, linked back to their source episodes. Do not delete the episodes.
3. Look for what repeats across several episodes and promote that as a pattern or schema.
4. Rank candidates by importance, links to open goals, and repetition. Leave the rest to fade from reach.

## Retrieval: the best way to pull a memory

Most forgetting is a failure to find, not a loss of storage. Retrieval works when the cue at recall overlaps with what was stored at encoding.

- **Encoding specificity.** A cue helps only if it was part of the original encoding ([Tulving & Thomson, 1973](https://www.lancaster.ac.uk/fas/psych/glossary/recall_memory/encoding_specificity)). Reinstating the learning context improves recall, as in the classic divers who recalled better underwater when they had learned underwater. For sky-brain: match the current project, goal, persona and source against the context stored with each entry.
- **Many routes beat one route.** Memories are reached through several cues at once: words, meaning, context and associations. A single vector search is one route. Fusing keyword search, semantic search, context match and links gives the multi-cue retrieval people use.
- **Spreading activation.** Activating one concept partly activates linked ones, fading with distance ([Collins & Loftus, 1975](https://doi.org/10.1037/0033-295X.82.6.407)). For sky-brain: after the first hits, follow links one or two hops with a decay factor.
- **Need probability.** How often and how recently something was needed predicts the odds it is needed now, and memory tracks those odds closely ([Anderson & Schooler, 1991](https://dyurovsky.github.io/learning-humans-machines/class/13-class/papers/anderson1991.pdf)). ACT-R turns this into a formula, base-level activation = ln(sum of t^-d) over past uses, with d about 0.5. It captures recency, frequency and spacing in one number.
- **Retrieval strengthens memory.** Recalling something builds retention more than re-reading it. In one study, students who were tested remembered more after a week than students who restudied ([Roediger & Karpicke, 2006](https://pubmed.ncbi.nlm.nih.gov/16507066/)).
- **Retrieval can suppress neighbours.** Practising some items from a category makes the unpractised ones harder to recall ([Anderson, Bjork & Bjork, 1994](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/Anderson_RBjork_EBjork_1994.pdf)). In software this shows up as rich-get-richer ranking.

Design consequence: retrieve with several fused cue routes plus spreading activation, score with an activation formula over an access log, strengthen only what was actually used, and add diversity to results so neighbours are not buried.

## Preservation: keeping memories over time

Memories fade fast at first and then slowly, following a power law rather than a straight exponential. A modern replication of Ebbinghaus confirmed the shape and found a small rise after a night's sleep ([Murre & Dros, 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4492928)).

- **Two strengths, not one.** Bjork's theory of disuse separates storage strength (how well learned, which never drops) from retrieval strength (how easy to reach right now, which decays). Retrieving something when it is hard to reach raises storage strength the most ([Bjork lab](https://bjorklab.psych.ucla.edu/research/)). So "forgotten" usually means "out of reach", and an entry with low retrieval strength should be demoted, not deleted.
- **Spacing.** Spread-out reviews beat massed ones. The best gap grows with how long you need to remember, roughly 10 to 20 percent of the retention horizon for long horizons ([Cepeda et al., 2008](https://pubmed.ncbi.nlm.nih.gov/19076480/)). For sky-brain: resurface important entries on an expanding schedule (a day, a week, a month), for example in the daily digest.
- **Interference.** Similar memories compete, and new ones can disrupt old ones and the reverse. Distinctive cues and merging near-duplicates reduce competition.
- **Reconsolidation.** A retrieved memory becomes briefly unstable and can be changed before it is stored again ([Nader, Schafe & LeDoux, 2000](https://pubmed.ncbi.nlm.nih.gov/10963596/)). This lets people update knowledge, but it also causes distortion and false memories. sky-brain should open a used entry to update, then write the update as a new version with a reason, keeping the old one.
- **Forgetting is useful.** Letting stale details fade cuts interference and helps generalization. The goal is not to remember everything equally, it is to keep the right things reachable.

## Design principles for sky-brain

Each principle below names the evidence behind it and what it asks of the schema or the agents.

| # | Principle | Based on | Schema or agent implication |
| --- | --- | --- | --- |
| 1 | Two strengths per entry | Bjork's storage vs retrieval strength | Columns `storage_strength` (grows only) and a computed retrieval score. Low score demotes or archives, never deletes. |
| 2 | Score from an access log | Anderson & Schooler; ACT-R | Table of access events: entry, time, cue, context, actor, used or not. Activation = ln(sum of t^-0.5). |
| 3 | Only used retrievals strengthen | Testing effect | Agents report which entries they actually cited or acted on. Showing up in results does not count. |
| 4 | Store and match encoding context | Encoding specificity | Each entry keeps project, goal or task, persona, source and time. Retrieval boosts entries whose context matches. |
| 5 | Episode plus gist | Complementary learning systems; trace transformation | Short memory holds immutable verbatim episodes. Long memory holds gist entries with `derived_from` links to them. |
| 6 | Embed the gist, not the body | Depth of processing | Vector of the summary, plus the questions it answers and key cues. Full text search covers the body. Long bodies can add chunk vectors later if tests show a need. |
| 7 | Multi-cue retrieval plus spreading | Multiple cues; Collins & Loftus | Fuse keyword, vector, context and activation scores (for example with reciprocal rank fusion), then follow links 1 to 2 hops with decay. |
| 8 | Keep what matters | Salience; repetition; schema fit | Signals on each entry: user flag, kind (decision, surprise, contradiction), links to open goals, repeat count, fits a known schema. |
| 9 | Interleaved consolidation | McClelland et al.; sleep replay | The nightly Consolidator pulls related old entries alongside new episodes to link, merge, flag conflicts and extract patterns. |
| 10 | Versioned reconsolidation | Nader et al. | A used entry is open to update, but updates are new versions with a supersedes link and a reason. |
| 11 | Manage interference | Interference; retrieval-induced forgetting | Merge near-duplicates, keep cues distinctive, add diversity (maximal marginal relevance) to result lists. |
| 12 | Spaced resurfacing | Cepeda et al. | Important entries with falling retrieval scores come back in the digest on an expanding schedule. |
| 13 | Small context packets | Cowan's ~4 chunks | An agent receives a few gists plus pointers to expand, not a dump. |
| 14 | Core is the self-schema | Conway's self-memory system | Core memory is small, always loaded, changed only with user approval, and biases encoding and retrieval. |

On the question about vectors: yes, the vector should come from a summary, not from a long body. A long body averages many topics into one vector that matches none of them well. Embedding a short gist, plus the questions the entry answers, is the analogue of how the brain indexes meaning. Keyword search still runs over the full body, so exact terms are never lost.

How working memory should behave: a blackboard per goal or task, holding a few active items. When the task ends, the blackboard is cleared and its outcome is written as an episode into short memory. That is where consolidation picks it up.

## Where the analogy breaks

Copy the brain's strategies, not its flaws.

- **Distortion on recall.** People rewrite memories when they recall them. sky-brain should keep every version and its source.
- **Lost sources.** People often remember a fact but not where it came from. sky-brain should always keep provenance, which the build plan already requires.
- **One working memory.** People hold one focus at a time. sky-brain can run many per-task blackboards, but each agent should still get a small packet.
- **Real deletion.** The brain rarely erases on purpose. sky-brain needs real deletion for privacy and for user requests, separate from fading.
- **Shared memory.** Brains are private. When other people are invited into some layers, provenance must also record who wrote each entry, and retrieval strength may need to be tracked per person, since what one person uses often is not what another does.

Open question for testing: whether gist-only vectors miss detail questions in practice. The benchmark step in the build plan should compare gist vectors, body chunk vectors, and both.

## Sources

- Anderson, Bjork & Bjork (1994). [Remembering can cause forgetting](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/Anderson_RBjork_EBjork_1994.pdf). Journal of Experimental Psychology: Learning, Memory, and Cognition.
- Anderson & Schooler (1991). [Reflections of the environment in memory](https://dyurovsky.github.io/learning-humans-machines/class/13-class/papers/anderson1991.pdf). Psychological Science.
- Baddeley (2000). [The episodic buffer](https://doi.org/10.1016/S1364-6613(00)01538-2). Trends in Cognitive Sciences.
- Bjork lab. [Research overview: new theory of disuse, desirable difficulties](https://bjorklab.psych.ucla.edu/research/). UCLA.
- Cepeda et al. (2008). [Spacing effects in learning: a temporal ridgeline of optimal retention](https://pubmed.ncbi.nlm.nih.gov/19076480/). Psychological Science.
- Collins & Loftus (1975). [A spreading-activation theory of semantic processing](https://doi.org/10.1037/0033-295X.82.6.407). Psychological Review.
- Conway & Pleydell-Pearce (2000). [The construction of autobiographical memories in the self-memory system](https://research-information.bris.ac.uk/en/publications/the-construction-of-autobiographical-memories-in-the-self-memory-/). Psychological Review.
- Cowan (2001). [The magical number 4 in short-term memory](https://pubmed.ncbi.nlm.nih.gov/11515286/). Behavioral and Brain Sciences.
- Craik & Lockhart (1972). [Levels of processing](https://psych205.stanford.edu/papers/CraikLockhart72.pdf). Journal of Verbal Learning and Verbal Behavior.
- Diekelmann & Born (2010). [The memory function of sleep](https://www.nature.com/articles/nrn2762.pdf). Nature Reviews Neuroscience.
- Lewis & Durrant (2011). [Overlapping memory replay during sleep builds cognitive schemata](https://orca.cardiff.ac.uk/111453/1/Lewis.%20How%20memory%20replay.pdf). Trends in Cognitive Sciences.
- McClelland, McNaughton & O'Reilly (1995). [Why there are complementary learning systems](https://pubmed.ncbi.nlm.nih.gov/7624455/). Psychological Review.
- McGaugh (2004). [The amygdala modulates the consolidation of memories of emotionally arousing experiences](https://doi.org/10.1146/annurev.neuro.27.070203.144157). Annual Review of Neuroscience.
- Murre & Dros (2015). [Replication and analysis of Ebbinghaus' forgetting curve](https://pmc.ncbi.nlm.nih.gov/articles/PMC4492928). PLOS ONE.
- Nader, Schafe & LeDoux (2000). [Fear memories require protein synthesis in the amygdala for reconsolidation after retrieval](https://pubmed.ncbi.nlm.nih.gov/10963596/). Nature.
- Roediger & Karpicke (2006). [Test-enhanced learning](https://pubmed.ncbi.nlm.nih.gov/16507066/). Psychological Science.
- Tse et al. (2007). [Schemas and memory consolidation](https://pubmed.ncbi.nlm.nih.gov/17412951/). Science.
- Tulving & Thomson (1973). [Encoding specificity](https://www.lancaster.ac.uk/fas/psych/glossary/recall_memory/encoding_specificity) (glossary summary). Psychological Review.
- Wilhelm et al. (2011). [Sleep selectively enhances memory expected to be of future relevance](https://pubmed.ncbi.nlm.nih.gov/21289163/), and the failed replication, [Future-relevant memories are not selectively strengthened during sleep](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8568116/) (2021).
- Winocur & Moscovitch (2011). [Memory transformation and systems consolidation](https://www.cambridge.org/core/product/18511C7CFD1671AA7A5F2A3E93BED12D). Journal of the International Neuropsychological Society.

Three links (Baddeley, Collins & Loftus, McGaugh) are DOI links written from memory, not taken from search results.
