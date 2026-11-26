// The side panel folds to a rail of icons on wide screens (shammai): the pages and layers stay
// one click away, each with a tooltip, and a button at the left of the top bar folds and opens it. The
// library's own collapse hides every page and is not used (its brand button takes no clicks).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const RAIL_KEY = "sky-brain.rail";

function rememberedRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "on";
  } catch {
    return false;
  }
}

/** Whether the panel is folded to its rail; remembered per browser, marked on <html>. */
export function useRail(): [boolean, () => void] {
  const [rail, setRail] = useState(rememberedRail);
  useEffect(() => {
    document.documentElement.dataset.rail = rail ? "on" : "off";
  }, [rail]);
  const toggle = () =>
    setRail((r) => {
      try {
        localStorage.setItem(RAIL_KEY, r ? "off" : "on");
      } catch {
        // Storage refused: the panel still folds, just not remembered.
      }
      return !r;
    });
  return [rail, toggle];
}

export function RailToggle(props: { rail: boolean; onToggle: () => void }) {
  const label = props.rail ? "Open the side panel" : "Fold the side panel";
  return (
    <button
      type="button"
      className="rail-toggle"
      aria-label={label}
      aria-expanded={!props.rail}
      aria-controls="pf-dashboard-sidebar"
      title={label}
      onClick={props.onToggle}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
        <path d="M7.5 3.5v13" />
        <path d={props.rail ? "M11 8l2 2-2 2" : "M13 8l-2 2 2 2"} />
      </svg>
    </button>
  );
}

/** On the rail, a pointer or keyboard focus on an icon shows its name beside it. */
export function RailTips({ rail }: { rail: boolean }) {
  const [tip, setTip] = useState<{ text: string; top: number } | null>(null);
  useEffect(() => {
    if (!rail) {
      setTip(null);
      return;
    }
    const show = (e: Event) => {
      const el =
        e.target instanceof Element
          ? e.target.closest<HTMLElement>(".pf-sidebar [data-tip]")
          : null;
      if (!el) return setTip(null);
      const r = el.getBoundingClientRect();
      setTip({ text: el.dataset.tip ?? "", top: r.top + r.height / 2 });
    };
    const hide = () => setTip(null);
    document.addEventListener("mouseover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mouseover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [rail]);
  if (!tip) return null;
  return createPortal(
    <div
      className="pf-tooltip rail-tip"
      role="tooltip"
      style={{ top: tip.top }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
