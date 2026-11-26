// The brain view (D40): the header's star brain opens big in the middle of the screen and splits
// into its layers: About me in the middle, the Board in front, the Inbox below, the Notebooks
// behind. Clicking a part shows its agents and what it holds; clicking an item goes there.
// The stars are brain.js's own (public, same as the sign-in page); this file feeds it data.
import { Alert, Button } from "panel-frame-ui";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { entriesApi } from "../api.ts";
import { navigate } from "../router.ts";
import { BrainPanel } from "./BrainPanel.tsx";
import {
  activeColours,
  countText,
  entryItem,
  linkOf,
  loadBrain,
  PART_NAMES,
  PARTS,
  type BrainData,
  type Part,
  type PartItem,
  type PartLink,
} from "./brainData.ts";
import { makeOverlay, type OverlayState } from "./brainOverlay.ts";
import "./brain.css";

interface BrainCanvas extends HTMLCanvasElement {
  skyBrain?: {
    highlight: (p: Part | null) => void;
    split: (on: boolean) => void;
    agents: (m: Partial<Record<Part, string>>) => void;
  };
  skyBrainOverlay?: ReturnType<typeof makeOverlay>;
}

const PART_KEY = "sky-brain.brain-part";
const SPLIT_AFTER_MS = 900;
const REFRESH_MS = 20_000;

function rememberedPart(): Part | null {
  try {
    const v = localStorage.getItem(PART_KEY) as Part | null;
    return v && PARTS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function rememberPart(p: Part): void {
  try {
    localStorage.setItem(PART_KEY, p);
  } catch {
    // Storage refused: the view opens with nothing picked next time.
  }
}

/** Searches one part: the server's word search for entries, the loaded goals for the Board. */
function useSearch(data: BrainData | null, part: Part | null, query: string) {
  const [results, setResults] = useState<PartItem[] | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!part || !q || !data) return setResults(null);
    if (part === "work") {
      const low = q.toLowerCase();
      return setResults(
        data.work.items.filter((i) => i.title.toLowerCase().includes(low)),
      );
    }
    let live = true;
    const t = setTimeout(() => {
      entriesApi.list(part, q, 20).then(
        (rows) => live && setResults(rows.map(entryItem)),
        () => live && setResults([]),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [data, part, query]);
  return results;
}

export function BrainView({ onClose }: { onClose: () => void }) {
  const canvas = useRef<BrainCanvas>(null);
  const [data, setData] = useState<BrainData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Part | null>(rememberedPart);
  const [query, setQuery] = useState("");
  const [tip, setTip] = useState<{ part: Part; x: number; y: number } | null>(
    null,
  );
  const [split, setSplit] = useState(false);
  const overlay = useRef<OverlayState>({
    labels: Object.fromEntries(
      PARTS.map((p) => [p, { name: PART_NAMES[p], count: "" }]),
    ) as OverlayState["labels"],
    waiting: {},
    link: null,
    still: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  const results = useSearch(data, picked, query);
  // The part under the pointer, as brain.js last reported it.
  const hovered = useRef<Part | null>(null);

  const pick = useCallback((p: Part | null) => {
    setPicked(p);
    setQuery("");
    if (p) rememberPart(p);
  }, []);

  // Draw the brain, hang the overlay on it, and split it once it has formed.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.skyBrainOverlay = makeOverlay(() => overlay.current);
    window.skyBrainInit?.(c);
    const onPick = (e: Event) => pick((e as CustomEvent<Part>).detail);
    const onHover = (e: Event) => {
      hovered.current = (e as CustomEvent<Part | null>).detail;
      if (!hovered.current) setTip(null);
    };
    c.addEventListener("brain:pick", onPick);
    c.addEventListener("brain:hover", onHover);
    const t = setTimeout(() => {
      c.skyBrain?.split(true);
      setSplit(true);
    }, SPLIT_AFTER_MS);
    return () => {
      clearTimeout(t);
      c.removeEventListener("brain:pick", onPick);
      c.removeEventListener("brain:hover", onHover);
    };
  }, [pick]);

  // Read again every 20 seconds, so agents that start or stop working show up while it is open.
  useEffect(() => {
    let live = true;
    const read = () =>
      loadBrain().then(
        (d) => live && (setData(d), setError(null)),
        (e: Error) => live && setError(e.message),
      );
    void read();
    const t = setInterval(() => void read(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!data) return;
    for (const p of PARTS) overlay.current.labels[p].count = countText(data[p]);
    overlay.current.waiting = Object.fromEntries(
      PARTS.map((p) => [p, data[p].waiting > 0]),
    );
    canvas.current?.skyBrain?.agents(activeColours(data));
  }, [data]);

  useEffect(() => {
    canvas.current?.skyBrain?.highlight(picked);
  }, [picked, split]);

  const showLink = useCallback((l: PartLink | null) => {
    overlay.current.link = l ? [l.from, l.to] : null;
  }, []);
  const linkFor = useMemo(
    () => (item: PartItem) =>
      data && picked ? linkOf(data, picked, item) : null,
    [data, picked],
  );

  const go = (route: Parameters<typeof navigate>[0]) => {
    onClose();
    navigate(route);
  };
  const step = (by: number) => {
    const i = picked ? PARTS.indexOf(picked) : -1;
    pick(PARTS[(i + by + PARTS.length) % PARTS.length]!);
  };
  const swipeFrom = useRef<number | null>(null);

  // On <body>, so the view sits above the shell and its tooltips, not inside its main area.
  return createPortal(
    <div
      className="bv"
      role="dialog"
      aria-modal="true"
      aria-label="Your brain"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        const by = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
          e.key
        ];
        if (by) {
          step(by);
          e.preventDefault();
        }
        if (e.key === "Enter" && picked && e.target === canvas.current) {
          go(
            picked === "work"
              ? { page: "board" }
              : { page: "layer", layer: picked },
          );
        }
      }}
    >
      <div className="bv-stage">
        <canvas
          ref={canvas}
          tabIndex={0}
          data-brain=""
          data-regions="on"
          data-pick=""
          role="img"
          aria-label="Your brain made of stars, split into About me in the middle, the Board in front, the Inbox below and the Notebooks behind. Use the arrow keys to move between parts."
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const part = split ? hovered.current : null;
            setTip(
              part
                ? { part, x: e.clientX - r.left, y: e.clientY - r.top }
                : null,
            );
          }}
          onPointerLeave={() => setTip(null)}
          onTouchStart={(e) =>
            (swipeFrom.current = e.touches[0]?.clientX ?? null)
          }
          onTouchEnd={(e) => {
            const from = swipeFrom.current;
            swipeFrom.current = null;
            const dx = (e.changedTouches[0]?.clientX ?? 0) - (from ?? 0);
            if (from !== null && Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
          }}
        />
        <div className="bv-title">
          <h2>Your brain</h2>
          <p>
            {split
              ? "Click a part, or use the arrow keys. Coloured sparks are agents working now."
              : "Opening…"}
          </p>
        </div>
        <Button variant="secondary" className="bv-close" onClick={onClose}>
          Close
        </Button>
        {tip && data && (
          <div className="bv-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
            <strong className={`part-${tip.part}`}>
              {PART_NAMES[tip.part]}
            </strong>
            <span>
              {countText(data[tip.part])}
              {data[tip.part].waiting > 0 &&
                ` · ${data[tip.part].waiting} waiting for you`}
            </span>
          </div>
        )}
        <div className="bv-legend" aria-label="Parts of the brain">
          {PARTS.map((p) => (
            <button
              key={p}
              type="button"
              className={`bv-chip part-${p}`}
              aria-pressed={picked === p}
              onClick={() => pick(p)}
            >
              <i aria-hidden="true" />
              <span>{PART_NAMES[p]}</span>
              {data && data[p].waiting > 0 && <em>{data[p].waiting}</em>}
            </button>
          ))}
        </div>
      </div>
      <aside className="bv-panel" aria-live="polite">
        {error && <Alert tone="error">{error}</Alert>}
        <BrainPanel
          data={data && picked ? data[picked] : null}
          intro={data !== null}
          query={query}
          onQuery={setQuery}
          results={results}
          linkOf={linkFor}
          onLink={showLink}
          onItem={(it) =>
            go(
              it.kind === "entry"
                ? { page: "doc", entryId: it.id }
                : { page: "board", goal: it.id },
            )
          }
          onOpen={(p) =>
            go(p === "work" ? { page: "board" } : { page: "layer", layer: p })
          }
          onReview={() => go({ page: "approvals" })}
        />
      </aside>
    </div>,
    document.body,
  );
}
