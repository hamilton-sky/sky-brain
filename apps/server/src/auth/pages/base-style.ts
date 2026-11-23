// The look every auth page shares (Constellation Night, D27): colour tokens for light and dark,
// the starry sky, type and buttons. sign-in-style.ts and consent-style.ts start with it, and
// routes.ts serves each page's whole stylesheet under `default-src 'self'`.
export const baseStyle = `[hidden] { display: none !important; }
/* Constellation Night: the colours, sky, type and buttons every auth page shares. */
:root {
  color-scheme: light;
  --sky-top: #c9d3f2; --sky-mid: #e6e3f4; --sky-low: #f8e6dc;
  --glow: rgba(120, 132, 220, 0.22);
  --star: rgba(52, 58, 128, 0.42); --star-dim: rgba(52, 58, 128, 0.22);
  --line: rgba(60, 66, 150, 0.30);
  --node: #3d4396; --node-core: #2b2f7a; --node-halo: rgba(80, 90, 200, 0.18);
  --signal: #5b4fe0;
  --text: #171a3a; --muted: #4a4e72;
  --card-bg: rgba(255, 255, 255, 0.62); --card-border: rgba(255, 255, 255, 0.85);
  --card-edge: rgba(40, 46, 110, 0.10);
  --accent: #3a3f9a; --accent-hover: #2f3384; --on-accent: #ffffff;
  --ghost-border: rgba(40, 46, 110, 0.28); --ghost-hover: rgba(40, 46, 110, 0.06);
  --ring: #3a3f9a; --rule: rgba(40, 46, 110, 0.12);
  --l-core: #b7791f; --l-work: #0f8a7e; --l-short: #6d55d8; --l-long: #2f5fd0;
  --plane-a: 0.22; --plane-on: 0.5;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  color-scheme: dark;
  --sky-top: #03040c; --sky-mid: #0a0d26; --sky-low: #161a44;
  --glow: rgba(120, 140, 255, 0.14);
  --star: rgba(226, 232, 255, 0.85); --star-dim: rgba(200, 210, 255, 0.38);
  --line: rgba(170, 188, 255, 0.28);
  --node: #dfe6ff; --node-core: #ffffff; --node-halo: rgba(150, 175, 255, 0.22);
  --signal: #eef2ff;
  --text: #eef1ff; --muted: #a9b0d6;
  --card-bg: rgba(18, 22, 56, 0.52); --card-border: rgba(190, 200, 255, 0.14);
  --card-edge: rgba(0, 0, 0, 0.4);
  --accent: #b9c6ff; --accent-hover: #d2dbff; --on-accent: #0b0e2a;
  --ghost-border: rgba(190, 200, 255, 0.3); --ghost-hover: rgba(190, 200, 255, 0.08);
  --ring: #b9c6ff; --rule: rgba(190, 200, 255, 0.12);
  --l-core: #f3c677; --l-work: #5fd3c4; --l-short: #b3a6ff; --l-long: #86a8ff;
  --plane-a: 0.18; --plane-on: 0.42;
} }
:root[data-theme="dark"] {
  color-scheme: dark;
  --sky-top: #03040c; --sky-mid: #0a0d26; --sky-low: #161a44;
  --glow: rgba(120, 140, 255, 0.14);
  --star: rgba(226, 232, 255, 0.85); --star-dim: rgba(200, 210, 255, 0.38);
  --line: rgba(170, 188, 255, 0.28);
  --node: #dfe6ff; --node-core: #ffffff; --node-halo: rgba(150, 175, 255, 0.22);
  --signal: #eef2ff;
  --text: #eef1ff; --muted: #a9b0d6;
  --card-bg: rgba(18, 22, 56, 0.52); --card-border: rgba(190, 200, 255, 0.14);
  --card-edge: rgba(0, 0, 0, 0.4);
  --accent: #b9c6ff; --accent-hover: #d2dbff; --on-accent: #0b0e2a;
  --ghost-border: rgba(190, 200, 255, 0.3); --ghost-hover: rgba(190, 200, 255, 0.08);
  --ring: #b9c6ff; --rule: rgba(190, 200, 255, 0.12);
  --l-core: #f3c677; --l-work: #5fd3c4; --l-short: #b3a6ff; --l-long: #86a8ff;
  --plane-a: 0.18; --plane-on: 0.42;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; }
html { background: var(--sky-mid); scroll-behavior: smooth; }
body {
  position: relative;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 16px; line-height: 1.6; color: var(--text);
  background:
    radial-gradient(ellipse 70% 30% at 50% 0%, var(--glow), transparent 70%),
    linear-gradient(180deg, var(--sky-top) 0%, var(--sky-mid) 40%, var(--sky-low) 100%);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
body::before {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    radial-gradient(1.2px 1.2px at 12% 18%, var(--star) 50%, transparent 52%),
    radial-gradient(1px 1px at 37% 72%, var(--star-dim) 50%, transparent 52%),
    radial-gradient(1.4px 1.4px at 64% 28%, var(--star) 50%, transparent 52%),
    radial-gradient(1px 1px at 82% 61%, var(--star-dim) 50%, transparent 52%),
    radial-gradient(1px 1px at 23% 47%, var(--star-dim) 50%, transparent 52%),
    radial-gradient(1.1px 1.1px at 91% 12%, var(--star) 50%, transparent 52%),
    radial-gradient(1px 1px at 52% 90%, var(--star-dim) 50%, transparent 52%);
  background-size: 290px 290px;
}
.wrap { position: relative; z-index: 1; max-width: 1080px; margin: 0 auto; padding: 0 20px; }
a { color: inherit; }
h1, h2, h3 { line-height: 1.15; margin: 0; text-wrap: balance; }
p { margin: 0; }
.muted { color: var(--muted); }
.eyebrow { font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }

/* nav */
.nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 0; }
.wordmark { font-weight: 600; font-size: 18px; letter-spacing: 0.01em; text-decoration: none; }
.wordmark .dash { color: var(--muted); font-weight: 400; }

/* buttons */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  min-height: 44px; padding: 10px 20px; border-radius: 12px;
  font: inherit; font-weight: 600; font-size: 15px; text-decoration: none; cursor: pointer;
  transition: background-color .2s ease, transform .2s ease;
}
.btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
.btn-primary { background: var(--accent); color: var(--on-accent); border: 0; box-shadow: 0 8px 24px -10px var(--accent); }
.btn-primary:hover { background: var(--accent-hover); transform: translateY(-1px); }
.btn-ghost { background: transparent; color: var(--text); border: 1px solid var(--ghost-border); }
.btn-ghost:hover { background: var(--ghost-hover); }
.btn svg { width: 16px; height: 16px; flex: none; }
.btn svg path { fill: currentColor; }
.btn-sm { min-height: 36px; padding: 6px 14px; font-size: 14px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  html { scroll-behavior: auto; }
}
.btn-star::before {
  content: ""; width: 14px; height: 14px; flex: none; background: currentColor;
  clip-path: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%);
}
`;
