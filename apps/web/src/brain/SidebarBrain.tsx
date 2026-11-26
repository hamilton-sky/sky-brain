// The sidebar's brain (D41): the brand banner opens the brain view, and its arrow drops the
// brain's layers (About me, Notebooks, Inbox, Board) down under it as direct links.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { navigate } from "../router.ts";
import { PART_NAMES, type Part } from "./brainData.ts";

const OPEN_KEY = "sky-brain.layers-open";
const LAYERS: Part[] = ["core", "long", "short", "work"];

/** The sign-in page's 3D constellation brain, small (public brain.js draws it). */
export function BrainMark() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) window.skyBrainInit?.(ref.current);
  }, []);
  return (
    <canvas
      ref={ref}
      data-brain="mini"
      className="brain-mark"
      aria-hidden="true"
    />
  );
}

function rememberedOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "closed";
  } catch {
    return true;
  }
}

/** Whether the layer list is open; open by default, remembered per browser. */
export function useLayersOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(rememberedOpen);
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? "closed" : "open");
      } catch {
        // Storage refused: the list still opens and closes, just not remembered.
      }
      return !o;
    });
  return [open, toggle];
}

/**
 * The library makes the whole brand its sidebar toggle button, so these act on their own and stop
 * the event there: clicking the banner opens the brain view, the arrow opens the layer list.
 */
function act(run: () => void) {
  return {
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      run();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.stopPropagation();
      e.preventDefault();
      run();
    },
  };
}

export function BrandBanner(props: {
  onBrain?: () => void;
  open: boolean;
  onToggle: () => void;
}) {
  const word = (
    <span className="wordmark">
      <span className="wm-sky">sky</span>
      <span className="wm-brain">brain</span>
    </span>
  );
  if (!props.onBrain) {
    return (
      <span className="pf-brand">
        <BrainMark />
        {word}
      </span>
    );
  }
  return (
    // A click between the banner and its arrow stops here too, so the library's brand button
    // never folds the panel away (SidebarRail.tsx does that, keeping the icons).
    <span
      className="pf-brand brand-live"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <span
        role="button"
        tabIndex={0}
        className="brand-open"
        aria-label="Open your brain"
        data-tip="Open your brain"
        {...act(props.onBrain)}
      >
        <BrainMark />
        {word}
      </span>
      <span
        role="button"
        tabIndex={0}
        className="brand-caret"
        title={props.open ? "Hide the layers" : "Show the layers"}
        aria-label="Layers of your brain"
        aria-expanded={props.open}
        aria-controls="brain-layers"
        {...act(props.onToggle)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </span>
    </span>
  );
}

/** The layers as sidebar links, each in its layer's colour; `current` is the page shown now. */
export function LayerLinks(props: { current: Part | null }) {
  return (
    <div
      id="brain-layers"
      className="nav-layers"
      role="group"
      aria-label="Layers of your brain"
    >
      {LAYERS.map((p) => (
        <button
          key={p}
          type="button"
          className={`pf-sidebar-link nav-layer part-${p}`}
          data-tip={PART_NAMES[p]}
          aria-label={PART_NAMES[p]}
          aria-current={props.current === p ? "page" : undefined}
          onClick={() =>
            navigate(
              p === "work" ? { page: "board" } : { page: "layer", layer: p },
            )
          }
        >
          <i aria-hidden="true" data-icon />
          <span className="nav-label">{PART_NAMES[p]}</span>
        </button>
      ))}
    </div>
  );
}
