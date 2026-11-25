// Pathly's file-overlap rule (pathly-adapters `supervisor/file_claims.py`, spec.md Decisions),
// written out here: two tasks overlap when a path of one equals a path of the other or is a
// folder of it. A null or empty list means the task touches everything.

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function pathsOverlap(a: string, b: string): boolean {
  return a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`);
}

export function overlaps(
  a: readonly string[] | null,
  b: readonly string[] | null,
): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return true;
  const right = b.map(normalize);
  return a.some((p) => {
    const left = normalize(p);
    return right.some((q) => pathsOverlap(left, q));
  });
}
