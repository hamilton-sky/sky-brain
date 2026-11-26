// Pure geometry for a goal's task diagram (no DOM, so it is unit tested). Ported from Pathly's
// TaskDagView layout: a task's layer is its longest dependency chain, tasks in one layer sit side
// by side, and every dependency inside the goal becomes an edge. "snake" ignores depth and packs
// the tasks in order into a compact zig-zag grid, which reads better for a long straight chain.
import type { Task } from "../api.ts";

export type GraphOrient = "vertical" | "horizontal" | "snake";

export interface Pt {
  x: number;
  y: number;
}
export interface Rect extends Pt {
  w: number;
  h: number;
}
export interface GraphNode extends Rect {
  id: string;
  /** 1-based position in the goal's task order, the same number the list shows. */
  index: number;
  task: Task;
}
export interface GraphEdge {
  from: string;
  to: string;
}
export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

export const NODE_W = 196;
export const NODE_H = 52;
const GAP_MAIN = 56; // between layers (or snake rows)
const GAP_CROSS = 24; // between tasks inside a layer
const PAD = 24;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;

export function graphLayout(
  tasks: Task[],
  orient: GraphOrient = "vertical",
): GraphLayout {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indexOf = new Map(tasks.map((t, i) => [t.id, i + 1]));
  const edges: GraphEdge[] = [];
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      if (byId.has(dep)) edges.push({ from: dep, to: t.id });
    }
  }
  const place = (t: Task, x: number, y: number): GraphNode => ({
    id: t.id,
    x,
    y,
    w: NODE_W,
    h: NODE_H,
    index: indexOf.get(t.id) ?? 0,
    task: t,
  });

  if (orient === "snake") {
    const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(tasks.length))));
    const nodes = tasks.map((t, i) => {
      const row = Math.floor(i / cols);
      const c0 = i % cols;
      const col = row % 2 === 0 ? c0 : cols - 1 - c0;
      return place(
        t,
        PAD + col * (NODE_W + GAP_CROSS),
        PAD + row * (NODE_H + GAP_MAIN),
      );
    });
    const rows = Math.max(1, Math.ceil(tasks.length / cols));
    return {
      nodes,
      edges,
      width: cols * NODE_W + (cols - 1) * GAP_CROSS + PAD * 2,
      height: rows * NODE_H + (rows - 1) * GAP_MAIN + PAD * 2,
    };
  }

  // Depth = longest chain of dependencies; a cycle is cut where it is found.
  const depthOf = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (t: Task): number => {
    const known = depthOf.get(t.id);
    if (known !== undefined) return known;
    if (visiting.has(t.id)) return 0;
    visiting.add(t.id);
    let d = 0;
    for (const dep of t.depends_on) {
      const parent = byId.get(dep);
      if (parent) d = Math.max(d, depth(parent) + 1);
    }
    visiting.delete(t.id);
    depthOf.set(t.id, d);
    return d;
  };
  const layers = new Map<number, Task[]>();
  for (const t of tasks) {
    const d = depth(t);
    layers.set(d, [...(layers.get(d) ?? []), t]);
  }

  const horiz = orient === "horizontal";
  const mainSize = horiz ? NODE_W : NODE_H;
  const crossSize = horiz ? NODE_H : NODE_W;
  const depths = [...layers.keys()].sort((a, b) => a - b);
  const widest = Math.max(1, ...[...layers.values()].map((l) => l.length));
  const crossExtent = widest * crossSize + (widest - 1) * GAP_CROSS;
  const nodes: GraphNode[] = [];
  depths.forEach((d, li) => {
    const layer = layers.get(d) ?? [];
    const span = layer.length * crossSize + (layer.length - 1) * GAP_CROSS;
    const start = PAD + (crossExtent - span) / 2; // centre each layer on the widest one
    layer.forEach((t, i) => {
      const main = PAD + li * (mainSize + GAP_MAIN);
      const cross = start + i * (crossSize + GAP_CROSS);
      nodes.push(place(t, horiz ? main : cross, horiz ? cross : main));
    });
  });
  const mainExtent =
    depths.length * mainSize + Math.max(depths.length - 1, 0) * GAP_MAIN;
  return {
    nodes,
    edges,
    width: (horiz ? mainExtent : crossExtent) + PAD * 2,
    height: (horiz ? crossExtent : mainExtent) + PAD * 2,
  };
}

/** Where the ray from `from` towards the rect's centre crosses its border. */
export function borderPoint(from: Pt, r: Rect): Pt {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = from.x - cx;
  const dy = from.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** A straight dependency line from box `a` to box `b`, trimmed to both borders. */
export function edgePath(a: Rect, b: Rect): string {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const s = borderPoint(cb, a);
  const e = borderPoint(ca, b);
  return `M${s.x},${s.y} L${e.x},${e.y}`;
}

/** The tasks directly before and after `id`: what lights up when a task is picked. */
export function neighbours(edges: GraphEdge[], id: string): Set<string> {
  const out = new Set<string>([id]);
  for (const e of edges) {
    if (e.from === id) out.add(e.to);
    if (e.to === id) out.add(e.from);
  }
  return out;
}

/** Pan and zoom that fit the whole layout inside a viewport (never zooming past 100%). */
export function fitView(
  layout: { width: number; height: number },
  vw: number,
  vh: number,
): { tx: number; ty: number; scale: number } {
  const scale = Math.max(
    MIN_SCALE,
    Math.min(1, (vw - 16) / layout.width, (vh - 16) / layout.height),
  );
  return {
    tx: (vw - layout.width * scale) / 2,
    ty: (vh - layout.height * scale) / 2,
    scale,
  };
}

export const clampScale = (v: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
