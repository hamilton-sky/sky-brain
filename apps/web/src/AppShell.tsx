// The frame around every signed-in page: panel-frame-ui's dashboard shell with the sky-brain
// brand, the pages in the sidebar (with icons, so a collapsed sidebar still works), and a top
// bar with the page's name, the theme picker, who is signed in, and Sign out.
import { Button, DashboardShell, ThemeControl } from "panel-frame-ui";
import type { ReactNode } from "react";
import { api, type Me } from "./api.ts";
import type { Part } from "./brain/brainData.ts";
import {
  BrainMark,
  BrandBanner,
  LayerLinks,
  useLayersOpen,
} from "./brain/SidebarBrain.tsx";

export type Page = "board" | "approvals" | "agents";

declare global {
  interface Window {
    /** Set by /auth-pages/brain.js, the sign-in page's 3D brain. */
    skyBrainInit?: (canvas: HTMLCanvasElement) => void;
  }
}

const BOARD_ICON = (
  <svg viewBox="0 0 20 20" aria-hidden="true" data-icon>
    <rect x="2.5" y="3" width="4.5" height="14" rx="1.5" />
    <rect x="8.75" y="3" width="4.5" height="9" rx="1.5" />
    <rect x="15" y="3" width="2.5" height="11.5" rx="1.2" />
  </svg>
);
const AGENTS_ICON = (
  <svg viewBox="0 0 20 20" aria-hidden="true" data-icon>
    <rect x="4" y="6" width="12" height="9.5" rx="3" />
    <path d="M10 6V3.2M7.6 10.2h.01M12.4 10.2h.01M2 10v2.5M18 10v2.5" />
  </svg>
);
const APPROVALS_ICON = (
  <svg viewBox="0 0 20 20" aria-hidden="true" data-icon>
    <circle cx="10" cy="10" r="7" />
    <path d="M6.8 10.2 9 12.4l4.2-4.6" />
  </svg>
);
const SIGN_OUT_ICON = (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="btn-icon">
    <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8M12 6.5 15.5 10 12 13.5M15.5 10H8" />
  </svg>
);

const PAGES: { id: Page; label: string; icon: ReactNode }[] = [
  { id: "board", label: "Board", icon: BOARD_ICON },
  { id: "approvals", label: "Approvals", icon: APPROVALS_ICON },
  { id: "agents", label: "Agents", icon: AGENTS_ICON },
];

/** Signs out, then shows the sign-in page with the brain, never the app's own frame. */
function signOut(): void {
  void api.signOut().finally(() => location.assign("/sign-in"));
}

export function AppShell(props: {
  me?: Me;
  page: Page;
  /** The top bar's name when it is not the page's (a document under Board). */
  title?: string;
  onPage: (page: Page) => void;
  /** Opens the brain view (D40); the header's brain is the way in once signed in. */
  onBrain?: () => void;
  /** The brain layer whose page is shown, if any, so the sidebar marks it (D41). */
  layer?: Part;
  children: ReactNode;
}) {
  const [layersOpen, toggleLayers] = useLayersOpen();
  const brain = Boolean(props.me && props.onBrain);
  // With the layer list open, the Board is listed there, as the brain's working layer.
  const pages =
    brain && layersOpen ? PAGES.filter((p) => p.id !== "board") : PAGES;
  const title =
    props.title ?? PAGES.find((p) => p.id === props.page)?.label ?? "";
  return (
    <DashboardShell
      brand={
        <BrandBanner
          onBrain={brain ? props.onBrain : undefined}
          open={layersOpen}
          onToggle={toggleLayers}
        />
      }
      navigation={
        props.me && (
          <>
            {brain && layersOpen && (
              <LayerLinks
                current={
                  props.layer ?? (props.page === "board" ? "work" : null)
                }
              />
            )}
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                className="pf-sidebar-link"
                title={p.label}
                aria-current={
                  props.page === p.id && !props.layer ? "page" : undefined
                }
                onClick={() => props.onPage(p.id)}
              >
                {p.icon}
                <span className="nav-label">{p.label}</span>
              </button>
            ))}
          </>
        )
      }
      toolbar={
        <>
          {props.me && props.onBrain && (
            <button
              type="button"
              className="brain-open-top"
              aria-label="Open your brain"
              onClick={props.onBrain}
            >
              <BrainMark />
            </button>
          )}
          <span className="pf-toolbar-title">{props.me ? title : ""}</span>
          <ThemeControl className="theme-picker" />
          {props.me && (
            <>
              <span className="account" title={props.me.email}>
                <span className="avatar" aria-hidden="true">
                  {props.me.email.slice(0, 1).toUpperCase()}
                </span>
                <span className="account-email">{props.me.email}</span>
              </span>
              <Button
                variant="secondary"
                className="sign-out"
                onClick={signOut}
              >
                {SIGN_OUT_ICON}
                <span>Sign out</span>
              </Button>
            </>
          )}
        </>
      }
    >
      {props.children}
    </DashboardShell>
  );
}
