// A goal's tasks as a diagram of nodes (ported from Pathly's TaskDagView, drawn as a constellation):
// each task is a star with its title, each dependency a line. Drag the sky to pan, the wheel or the
// buttons to zoom, a task to move it. Picking a task lights up what it waits on and what waits on
// it, and opens the same task card the list shows, under the diagram.
import {
  type PointerEvent as RPointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Task } from "../api.ts";
import { ViewSwitch } from "../ViewSwitch.tsx";
import { STEP_LABEL } from "./Step.tsx";
import {
  clampScale,
  edgePath,
  fitView,
  type GraphNode,
  type GraphOrient,
  graphLayout,
  neighbours,
  type Pt,
} from "./taskGraph.ts";
import "./task-graph.css";

const ORIENT_KEY = "sky-brain.diagram-orient";
const ORIENTS = [
  ["vertical", "Down"],
  ["horizontal", "Across"],
  ["snake", "Compact"],
] as const;

function rememberedOrient(): GraphOrient {
  try {
    const v = localStorage.getItem(ORIENT_KEY);
    return v === "horizontal" || v === "snake" ? v : "vertical";
  } catch {
    return "vertical";
  }
}

export function TaskGraph(props: {
  tasks: Task[];
  renderTask: (task: Task, index: number) => ReactNode;
}) {
  const [orient, setOrient] = useState<GraphOrient>(rememberedOrient);
  const [picked, setPicked] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, Pt>>({});
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [panning, setPanning] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);
  const pan = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(
    null,
  );

  const layout = useMemo(
    () => graphLayout(props.tasks, orient),
    [props.tasks, orient],
  );
  const nodes = useMemo(
    () => layout.nodes.map((n) => ({ ...n, ...(moved[n.id] ?? {}) })),
    [layout, moved],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const lit = picked ? neighbours(layout.edges, picked) : null;

  const fit = () => {
    const el = wrap.current;
    if (el) setView(fitView(layout, el.clientWidth, el.clientHeight));
  };
  // Re-fit when the layout direction changes; polling refreshes keep the person's view.
  useLayoutEffect(() => {
    setMoved({});
    fit();
  }, [orient]);

  // Wheel zoom towards the pointer. React's onWheel is passive, so the page would scroll too.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => {
        const scale = clampScale(v.scale * (e.deltaY < 0 ? 1.1 : 0.9));
        const k = scale / v.scale;
        return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoom = (f: number) =>
    setView((v) => {
      const el = wrap.current;
      const cx = (el?.clientWidth ?? 0) / 2;
      const cy = (el?.clientHeight ?? 0) / 2;
      const scale = clampScale(v.scale * f);
      const k = scale / v.scale;
      return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
    });

  const nodeDown = (e: RPointerEvent<HTMLButtonElement>, n: GraphNode) => {
    e.stopPropagation();
    drag.current = {
      id: n.id,
      sx: e.clientX,
      sy: e.clientY,
      ox: n.x,
      oy: n.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const nodeMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4)
      d.moved = true;
    if (!d.moved) return;
    const x = d.ox + (e.clientX - d.sx) / view.scale;
    const y = d.oy + (e.clientY - d.sy) / view.scale;
    setMoved((m) => ({ ...m, [d.id]: { x, y } }));
  };
  const nodeUp = (n: GraphNode) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) setPicked((cur) => (cur === n.id ? null : n.id));
  };

  const skyDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".tg-node, .tg-tools")) return;
    pan.current = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
    setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const skyMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p) return;
    setView((v) => ({
      ...v,
      tx: p.tx + e.clientX - p.sx,
      ty: p.ty + e.clientY - p.sy,
    }));
  };
  const skyUp = (e: RPointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    pan.current = null;
    setPanning(false);
    // A click on empty sky (no drag) puts the picked task down.
    if (p && Math.abs(e.clientX - p.sx) + Math.abs(e.clientY - p.sy) < 4)
      setPicked(null);
  };

  const pickedNode = picked ? byId.get(picked) : undefined;

  return (
    <div className="tg">
      <div className="tg-head">
        <ViewSwitch
          label="Layout"
          value={orient}
          onChange={(v) => {
            setOrient(v);
            try {
              localStorage.setItem(ORIENT_KEY, v);
            } catch {
              // Storage may be refused; the layout still changes.
            }
          }}
          views={ORIENTS}
        />
        <span className="tg-hint">Tap a task to open it</span>
      </div>
      <div
        ref={wrap}
        className="tg-sky"
        data-panning={panning}
        onPointerDown={skyDown}
        onPointerMove={skyMove}
        onPointerUp={skyUp}
        onPointerCancel={() => {
          pan.current = null;
          setPanning(false);
        }}
      >
        <div
          className="tg-canvas"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          }}
        >
          <svg
            className="tg-edges"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
            data-dim={lit !== null}
          >
            <defs>
              <marker
                id="tg-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 Z" fill="context-stroke" />
              </marker>
            </defs>
            {layout.edges.map((e) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const on =
                picked !== null && (e.from === picked || e.to === picked);
              return (
                <path
                  key={`${e.from}>${e.to}`}
                  className="tg-edge"
                  data-done={a.task.status === "done"}
                  data-on={on}
                  d={edgePath(a, b)}
                  markerEnd="url(#tg-arrow)"
                />
              );
            })}
          </svg>
          {nodes.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`tg-node ${n.task.status}`}
              data-picked={picked === n.id}
              data-dim={lit !== null && !lit.has(n.id)}
              aria-pressed={picked === n.id}
              aria-label={`Task ${n.index}: ${n.task.title}, ${STEP_LABEL[n.task.status]}`}
              title={n.task.title}
              style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
              onPointerDown={(e) => nodeDown(e, n)}
              onPointerMove={nodeMove}
              onPointerUp={() => nodeUp(n)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setPicked((cur) => (cur === n.id ? null : n.id));
                }
              }}
            >
              <span className="tg-star" aria-hidden="true">
                {n.task.status === "done" ? "✓" : n.index}
              </span>
              <span className="tg-title">{n.task.title}</span>
              {!n.task.pinned && (
                <span className="tg-flag" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
        <div className="tg-tools">
          <button
            type="button"
            onClick={() => zoom(1 / 1.2)}
            aria-label="Zoom out"
          >
            −
          </button>
          <span>{Math.round(view.scale * 100)}%</span>
          <button type="button" onClick={() => zoom(1.2)} aria-label="Zoom in">
            +
          </button>
          <button
            type="button"
            onClick={() => {
              setMoved({});
              fit();
            }}
            aria-label="Fit and tidy"
          >
            Fit
          </button>
        </div>
        <div className="tg-legend" aria-hidden="true">
          <i className="done" /> done <i className="in_progress" /> running{" "}
          <i className="pending" /> waiting <i className="failed" /> failed
        </div>
      </div>
      {pickedNode && props.renderTask(pickedNode.task, pickedNode.index - 1)}
    </div>
  );
}
