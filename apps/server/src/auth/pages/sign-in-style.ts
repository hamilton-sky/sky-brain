// The sign-in (entry) page's stylesheet, served as /auth-pages/sign-in.css by routes.ts.
// The page runs under `default-src 'self'`, so every rule lives here, not inline.
export const style = `[hidden] { display: none !important; }
/* Constellation Night, landing variant: hero with the 3D brain, then the four memory layers
   as an interactive stack, then how agents use it. Everything here can live in a same-origin
   CSS file: this is /auth-pages/sign-in.css, served under default-src 'self'. */
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

/* hero */
.hero { display: grid; justify-items: center; text-align: center; gap: 12px; padding: 0 0 56px; }
.hero canvas { display: block; width: 500px; max-width: 94vw; aspect-ratio: 50 / 28; height: auto; touch-action: manipulation; }
.legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: -4px; }
.chip-link {
  display: inline-flex; align-items: center; gap: 7px; padding: 6px 14px; border-radius: 999px;
  font-size: 14px; font-weight: 600; text-decoration: none; color: var(--text);
  border: 1px solid var(--ghost-border); background: var(--card-bg);
  transition: border-color .2s ease, background-color .2s ease;
}
.chip-link:hover, .chip-link.on { background: var(--ghost-hover); }
.chip-link.core:hover, .chip-link.core.on { border-color: var(--l-core); }
.chip-link.work:hover, .chip-link.work.on { border-color: var(--l-work); }
.chip-link.short:hover, .chip-link.short.on { border-color: var(--l-short); }
.chip-link.long:hover, .chip-link.long.on { border-color: var(--l-long); }
.chip-link:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.hint { font-size: 13px; color: var(--muted); }
.sw { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }
.hero h1 { font-size: clamp(30px, 5vw, 46px); font-weight: 650; letter-spacing: -0.02em; max-width: 16ch; }
.hero .lede { font-size: clamp(16px, 2.2vw, 19px); color: var(--muted); max-width: 52ch; }
.hero .ctas { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 8px; }

section.block { padding: 56px 0; border-top: 1px solid var(--rule); }
.block-head { display: grid; gap: 10px; max-width: 62ch; margin-bottom: 32px; }
.block-head h2 { font-size: clamp(26px, 4vw, 36px); letter-spacing: -0.015em; }

.signin { display: grid; justify-items: center; gap: 10px; }
.signin #status { min-height: 1.2em; font-size: 13px; color: var(--muted); }
.fine { font-size: 13px; color: var(--muted); }
.noaccess { max-width: 46ch; padding: 22px 24px; border-radius: 18px; background: var(--card-bg); border: 1px solid var(--card-border); box-shadow: 0 0 0 1px var(--card-edge); }
.noaccess h2 { font-size: 20px; }
.chip-link { cursor: default; }

/* the layer stack, linked to the brain */
.layers-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 32px; align-items: center; }
.stack { width: 100%; height: auto; display: block; overflow: visible; }
.stack .layer { cursor: pointer; outline: none; }
.stack .plane { fill-opacity: var(--plane-a); stroke-width: 1.2; transition: fill-opacity .35s ease, transform .35s ease; }
.stack .layer.core .plane { fill: var(--l-core); stroke: var(--l-core); }
.stack .layer.work .plane { fill: var(--l-work); stroke: var(--l-work); }
.stack .layer.short .plane { fill: var(--l-short); stroke: var(--l-short); }
.stack .layer.long .plane { fill: var(--l-long); stroke: var(--l-long); }
.stack .layer .g { transition: transform .45s cubic-bezier(.2,.8,.2,1); }
.stack .layer.on .plane { fill-opacity: var(--plane-on); stroke-width: 2; }
.stack .layer.on .g { transform: translateY(-8px); }
.stack .layer:focus-visible .plane { stroke-width: 3; }
.stack .dot { fill: var(--node); }
.stack .layer.on .dot { fill: var(--node-core); }
.stack .lbl { font: 600 13px ui-sans-serif, system-ui, sans-serif; fill: var(--muted); }
.stack .layer.on .lbl { fill: var(--text); }
.stack .lbl-sub { font: 12px ui-sans-serif, system-ui, sans-serif; fill: var(--muted); }
.stack .tick { stroke: var(--line); stroke-width: 1; }
.stack .thread { fill: none; stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 4; }
.stack .flow { fill: none; stroke: var(--signal); stroke-width: 2; stroke-linecap: round; stroke-dasharray: 0.06 1.2; stroke-dashoffset: 1.06; opacity: 0; animation: up 4.5s ease-in-out infinite; }
.stack .flow.f2 { animation-delay: 1.5s; }
.stack .flow.f3 { animation-delay: 3s; }
@keyframes up { 0% { stroke-dashoffset: 1.06; opacity: 0; } 15%, 80% { opacity: 1; } 100% { stroke-dashoffset: 0; opacity: 0; } }

.layers-grid { margin-bottom: 36px; grid-template-columns: minmax(0, 1fr); justify-items: center; }
.layers-grid .stack { max-width: 620px; }

/* rings: closer to the centre = more active */
.rings { max-width: 680px; }
.rings .layer .g { transform: none !important; }
.rings .plane { stroke-width: 1; }
.rings .layer.on .plane { stroke-width: 2; }
.rings .lbl { font: 600 11px ui-sans-serif, system-ui, sans-serif; fill: var(--text); pointer-events: none; }
.rings .lbl-sub { font: 9px ui-sans-serif, system-ui, sans-serif; fill: var(--muted); letter-spacing: .06em; pointer-events: none; }
.rings .layer.core .lbl { font-size: 12px; }
.rings .cg-in { stop-color: var(--l-core); stop-opacity: .45; }
.rings .cg-out { stop-color: var(--l-core); stop-opacity: 0; }
.rings .glow { animation: core-breathe 4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes core-breathe { 0%, 100% { opacity: .55; transform: scale(.92); } 50% { opacity: 1; transform: scale(1.08); } }
.rings .mem { fill: var(--node-core); opacity: .85; pointer-events: none; }
.rings-note { max-width: 62ch; text-align: center; font-size: 15px; }
@media (prefers-reduced-motion: reduce) { .rings .orbits { display: none; } }

/* the four parts */
.parts { display: grid; gap: 20px; }
.part {
  display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 0;
  border-radius: 18px; overflow: hidden; background: var(--card-bg);
  border: 1px solid var(--card-border); box-shadow: 0 0 0 1px var(--card-edge);
  scroll-margin-top: 24px; transition: box-shadow .4s ease;
}
.part.flash { box-shadow: 0 0 0 2px var(--pc), 0 20px 60px -30px var(--pc); }
.part.core { --pc: var(--l-core); } .part.work { --pc: var(--l-work); }
.part.short { --pc: var(--l-short); } .part.long { --pc: var(--l-long); }
.part-main { padding: 26px; display: grid; gap: 8px; align-content: start; min-width: 0; border-top: 3px solid var(--pc); }
.part-main h3 { font-size: 26px; letter-spacing: -0.01em; }
.part .eyebrow { display: flex; align-items: center; gap: 8px; }
.inhead { padding: 26px; display: grid; gap: 8px; align-content: start; border-left: 1px solid var(--rule); background: var(--ghost-hover); min-width: 0; }
.inhead-t { font-size: 18px; font-weight: 600; color: var(--pc); }
.inhead .muted { font-size: 15px; }
.back { font-size: 14px; color: var(--muted); margin-top: 6px; justify-self: start; }
.back:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.sw.core { background: var(--l-core); } .sw.work { background: var(--l-work); }
.sw.short { background: var(--l-short); } .sw.long { background: var(--l-long); }
.facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 8px 0 0; font-size: 14px; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; }
.example { margin-top: 8px; padding: 10px 14px; border-left: 2px solid var(--pc); font-size: 14px; color: var(--muted); }
.example b { color: var(--text); font-weight: 600; }

/* journey */
.steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; list-style: none; margin: 0; padding: 0; }
.step {
  position: relative; padding: 20px; border-radius: 16px; background: var(--card-bg);
  border: 1px solid var(--card-border); box-shadow: 0 0 0 1px var(--card-edge);
  display: grid; gap: 8px; align-content: start; min-width: 0;
}
.step .num { font: 600 12px ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: var(--muted); letter-spacing: .08em; }
.step h3 { font-size: 17px; }
.step p { font-size: 14px; color: var(--muted); }
.chip { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; border: 1px solid currentColor; justify-self: start; }
.chip.short { color: var(--l-short); } .chip.long { color: var(--l-long); }
.chip.work { color: var(--l-work); } .chip.core { color: var(--l-core); }

/* trust */
.trust { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.trust > div { display: grid; gap: 6px; align-content: start; min-width: 0; }
.trust h3 { font-size: 17px; }
.trust p { font-size: 15px; color: var(--muted); }
.levels { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.lv { font-size: 12px; padding: 2px 9px; border-radius: 999px; border: 1px dashed var(--ghost-border); color: var(--muted); }
.lv.ok { border-style: solid; color: var(--text); }

.tools { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 32px; }
.tool { padding: 8px 14px; border-radius: 10px; border: 1px solid var(--ghost-border); font-size: 14px; }

.final { text-align: center; display: grid; justify-items: center; gap: 14px; padding: 64px 0 48px; border-top: 1px solid var(--rule); }
.final h2 { font-size: clamp(26px, 4vw, 36px); }
.foot { padding: 24px 0 40px; text-align: center; font-size: 13px; color: var(--muted); }

@media (max-width: 860px) {
  .layers-grid { grid-template-columns: 1fr; }
  .part { grid-template-columns: 1fr; }
  .inhead { border-left: 0; border-top: 1px solid var(--rule); }
  .steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .trust { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .steps { grid-template-columns: 1fr; }
  section.block { padding: 40px 0; }
  .nav .btn-sm { padding: 6px 10px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  html { scroll-behavior: auto; }
}
.btn-star::before {
  content: ""; width: 14px; height: 14px; flex: none; background: currentColor;
  clip-path: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%);
}
`;
