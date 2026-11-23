// The consent page's stylesheet, served as /auth-pages/consent.css by routes.ts. It is the
// entry page's look (baseStyle) around one card: who asks, as whom, where it returns, what it
// may do, and Allow or Deny.
import { baseStyle } from "./base-style.ts";

export const style =
  baseStyle +
  `/* consent */
.consent { min-height: 100vh; min-height: 100dvh; display: grid; align-content: center; justify-items: center; gap: 8px; padding-block: 24px 40px; }
.consent .wordmark { margin-bottom: 4px; }
.consent canvas { display: block; width: 240px; max-width: 70vw; aspect-ratio: 50 / 28; height: auto; }
.card {
  width: 100%; max-width: 440px; display: grid; gap: 18px; padding: 28px 26px;
  border-radius: 20px; background: var(--card-bg); border: 1px solid var(--card-border);
  box-shadow: 0 0 0 1px var(--card-edge), 0 24px 60px -30px var(--glow);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
}
.card h1 { font-size: clamp(22px, 4.6vw, 26px); font-weight: 650; letter-spacing: -0.015em; overflow-wrap: anywhere; }
.card h1 .app { color: var(--accent); }
.facts { display: grid; gap: 12px; margin: 0; padding: 14px 0; border-block: 1px solid var(--rule); }
.facts div { display: grid; grid-template-columns: 7.5em minmax(0, 1fr); gap: 12px; align-items: baseline; }
.facts dt { font-size: 13px; color: var(--muted); }
.facts dd { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.actions .btn { width: 100%; }
.btn:disabled { opacity: .55; cursor: not-allowed; transform: none; }
#status { min-height: 1.2em; font-size: 13px; color: var(--muted); text-align: center; }
#status:empty { display: none; }
.fine { font-size: 13px; color: var(--muted); text-align: center; }
@media (max-width: 400px) {
  .card { padding: 22px 18px; }
  .facts div { grid-template-columns: 1fr; gap: 2px; }
}
`;
