// The sign-in (entry) page's stylesheet, served as /auth-pages/sign-in.css by routes.ts.
// The page runs under `default-src 'self'`, so every rule lives here, not inline. The shared
// look (tokens, sky, buttons) is baseStyle; this file adds the entry page's own parts.
import { baseStyle } from "./base-style.ts";

export const style =
  baseStyle +
  `/* hero */
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
`;
