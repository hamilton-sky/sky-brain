// Undo and redo for the document draft: a pure history of texts, so the rules are tested.
// Typing within `COALESCE_MS` of the last change folds into one step (Ctrl+Z undoes a burst of
// typing, not one letter); a toolbar action or a section move is always its own step.

export interface History {
  past: string[];
  present: string;
  future: string[];
  /** When the present text was last typed into, for coalescing. */
  typedAt: number;
}

export const COALESCE_MS = 800;
const DEPTH = 200;

export const start = (text: string): History => ({
  past: [],
  present: text,
  future: [],
  typedAt: 0,
});

/** `typing` true folds into the last step when it was typing too, recently. */
export function record(
  h: History,
  text: string,
  now: number,
  typing: boolean,
): History {
  if (text === h.present) return h;
  if (typing && h.typedAt > 0 && now - h.typedAt < COALESCE_MS) {
    return { ...h, present: text, future: [], typedAt: now };
  }
  return {
    past: [...h.past, h.present].slice(-DEPTH),
    present: text,
    future: [],
    typedAt: typing ? now : 0,
  };
}

export function undo(h: History): History {
  const prev = h.past.at(-1);
  if (prev === undefined) return h;
  return {
    past: h.past.slice(0, -1),
    present: prev,
    future: [h.present, ...h.future],
    typedAt: 0,
  };
}

export function redo(h: History): History {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return {
    past: [...h.past, h.present],
    present: next,
    future: rest,
    typedAt: 0,
  };
}
