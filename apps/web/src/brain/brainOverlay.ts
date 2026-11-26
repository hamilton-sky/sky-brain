// What the brain view draws over the split star brain (brain.js calls it every frame, through
// canvas.skyBrainOverlay): each part's name and count, a slow ring around a part with something
// waiting for the person, and a moving arc between two parts when an item links them.
import type { Part } from "./brainData.ts";

interface Centre {
  x: number;
  y: number;
  top: number;
  bottom: number;
}

/** What brain.js hands the overlay each frame. */
export interface OverlayFrame {
  centers: Partial<Record<Part, Centre>>;
  /** 0 together .. 1 fully split. */
  split: number;
  /** Milliseconds since the brain started. */
  time: number;
  colors: Record<Part, string>;
  text: string;
  signal: string;
  highlight: Part | null;
}

export interface OverlayState {
  labels: Record<Part, { name: string; count: string }>;
  waiting: Partial<Record<Part, boolean>>;
  link: [Part, Part] | null;
  still: boolean;
}

function labels(
  ctx: CanvasRenderingContext2D,
  f: OverlayFrame,
  s: OverlayState,
) {
  ctx.textAlign = "center";
  for (const [part, c] of Object.entries(f.centers) as [Part, Centre][]) {
    const below = part === "core" || part === "short";
    const y = below ? c.bottom + 24 : c.top - 22;
    const on = !f.highlight || f.highlight === part;
    ctx.globalAlpha = Math.min(1, (f.split - 0.3) / 0.5) * (on ? 1 : 0.45);
    ctx.font = "700 16px Inter, system-ui, sans-serif";
    ctx.fillStyle = f.colors[part];
    ctx.fillText(s.labels[part].name, c.x, y);
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    ctx.fillStyle = f.text;
    ctx.fillText(s.labels[part].count, c.x, y + 16);
  }
}

function rings(
  ctx: CanvasRenderingContext2D,
  f: OverlayFrame,
  s: OverlayState,
) {
  for (const part of Object.keys(s.waiting) as Part[]) {
    const c = f.centers[part];
    if (!s.waiting[part] || !c) continue;
    const phase = s.still ? 0.4 : (f.time % 2200) / 2200;
    const r = Math.max(40, (c.bottom - c.top) * 0.6) * (0.85 + 0.35 * phase);
    ctx.globalAlpha = (1 - phase) * 0.55 * f.split;
    ctx.strokeStyle = f.colors[part];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function link(ctx: CanvasRenderingContext2D, f: OverlayFrame, s: OverlayState) {
  if (!s.link) return;
  const a = f.centers[s.link[0]];
  const b = f.centers[s.link[1]];
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2;
  const my = Math.min(a.y, b.y) - 70;
  const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  grad.addColorStop(0, f.colors[s.link[0]]);
  grad.addColorStop(1, f.colors[s.link[1]]);
  ctx.globalAlpha = 0.9 * f.split;
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = s.still ? 0 : -f.time * 0.03;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(mx, my, b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  if (s.still) return;
  const t = (f.time % 1600) / 1600;
  const u = 1 - t;
  ctx.fillStyle = f.signal;
  ctx.beginPath();
  ctx.arc(
    u * u * a.x + 2 * u * t * mx + t * t * b.x,
    u * u * a.y + 2 * u * t * my + t * t * b.y,
    3.5,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/** The function to hang on the canvas as `skyBrainOverlay`; reads the latest state each frame. */
export function makeOverlay(state: () => OverlayState) {
  return (ctx: CanvasRenderingContext2D, f: OverlayFrame) => {
    if (f.split <= 0.3) return;
    const s = state();
    rings(ctx, f, s);
    link(ctx, f, s);
    labels(ctx, f, s);
  };
}
