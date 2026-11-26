import { describe, expect, it } from "vitest";
import type { Task } from "../api.ts";
import {
  borderPoint,
  edgePath,
  fitView,
  graphLayout,
  NODE_H,
  NODE_W,
  neighbours,
} from "./taskGraph.ts";

function task(id: string, depends_on: string[] = []): Task {
  return {
    id,
    title: `Task ${id}`,
    body: "",
    files: null,
    depends_on,
    status: "pending",
    attempts: 0,
    max_attempts: 3,
    holder: null,
    pinned: true,
    quarantined_because: null,
    fail_reason: null,
    position: 0,
  };
}

// a → b, a → c, b + c → d, plus a dependency outside the goal that must be ignored.
const diamond = [
  task("a"),
  task("b", ["a"]),
  task("c", ["a", "elsewhere"]),
  task("d", ["b", "c"]),
];

describe("graphLayout", () => {
  it("puts each task one layer below its deepest dependency", () => {
    const l = graphLayout(diamond, "vertical");
    const y = Object.fromEntries(l.nodes.map((n) => [n.id, n.y]));
    expect(y.a).toBeLessThan(y.b!);
    expect(y.b).toBe(y.c);
    expect(y.d).toBeGreaterThan(y.b!);
    expect(l.edges).toEqual([
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
      { from: "c", to: "d" },
    ]);
  });

  it("numbers tasks by their order in the goal, like the list", () => {
    const l = graphLayout(diamond);
    expect(l.nodes.map((n) => [n.id, n.index])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
  });

  it("lays layers left to right when horizontal", () => {
    const l = graphLayout(diamond, "horizontal");
    const x = Object.fromEntries(l.nodes.map((n) => [n.id, n.x]));
    expect(x.a).toBeLessThan(x.b!);
    expect(x.b).toBe(x.c);
    expect(l.width).toBeGreaterThan(l.height);
  });

  it("packs a long chain into a zig-zag grid in compact mode", () => {
    const chain = Array.from({ length: 9 }, (_, i) =>
      task(`t${i}`, i ? [`t${i - 1}`] : []),
    );
    const l = graphLayout(chain, "snake");
    const row1 = l.nodes.slice(3, 6).map((n) => n.x);
    expect(row1).toEqual([...row1].sort((a, b) => b - a)); // second row runs right to left
    expect(l.width).toBeLessThan(5 * NODE_W);
  });

  it("survives a dependency cycle", () => {
    const l = graphLayout([task("x", ["y"]), task("y", ["x"])]);
    expect(l.nodes).toHaveLength(2);
  });
});

describe("geometry", () => {
  const box = { x: 0, y: 0, w: NODE_W, h: NODE_H };
  it("lands an edge on the border of the box", () => {
    const p = borderPoint({ x: NODE_W / 2, y: 500 }, box);
    expect(p).toEqual({ x: NODE_W / 2, y: NODE_H });
  });
  it("draws a straight line between two boxes", () => {
    const below = { ...box, y: 200 };
    expect(edgePath(box, below)).toBe(
      `M${NODE_W / 2},${NODE_H} L${NODE_W / 2},200`,
    );
  });
  it("lights the picked task and its direct neighbours only", () => {
    const l = graphLayout(diamond);
    expect([...neighbours(l.edges, "b")].sort()).toEqual(["a", "b", "d"]);
  });
  it("fits a big layout without zooming in past 100%", () => {
    expect(fitView({ width: 100, height: 100 }, 800, 400).scale).toBe(1);
    const v = fitView({ width: 1600, height: 400 }, 800, 400);
    expect(v.scale).toBeLessThan(0.5);
    expect(v.tx).toBeGreaterThanOrEqual(0);
  });
});
