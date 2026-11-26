// Reciprocal Rank Fusion (BUILD-PLAN step 4): merges ranked lists by position alone, so word
// scores and vector distances never have to be put on one scale. score = sum of 1 / (k + rank).

/** The usual constant (Cormack et al. 2009); larger k flattens the head of each list. */
export const RRF_K = 60;

export function fuseRrf<T>(
  lists: readonly (readonly T[])[],
  key: (item: T) => string,
  k = RRF_K,
): { item: T; score: number }[] {
  const fused = new Map<string, { item: T; score: number; first: number }>();
  let order = 0;
  for (const list of lists) {
    list.forEach((item, i) => {
      const id = key(item);
      const prev = fused.get(id);
      const add = 1 / (k + i + 1);
      if (prev) prev.score += add;
      else fused.set(id, { item, score: add, first: order++ });
    });
  }
  // Ties (the same rank in different lists) keep the earlier list's order: words first.
  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.first - b.first)
    .map(({ item, score }) => ({ item, score }));
}
