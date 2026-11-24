// The frame around every signed-in page: panel-frame-ui's dashboard shell with the sky-brain
// brand, the pages in the sidebar (with icons, so a collapsed sidebar still works), and a top
// bar with the page's name, the theme picker, who is signed in, and Sign out.
import { Button, DashboardShell, ThemeControl } from "panel-frame-ui";
import type { ReactNode } from "react";
import { api, type Me } from "./api.ts";

export type Page = "board" | "agents";

// A small constellation brain, like the big one on the sign-in page.
const BRAIN_MARK = (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="brain-mark">
    <path d="M12 5c-1-1.7-3.7-2-5-.4C5.3 4.4 3.8 5.9 4 7.6c-1.6.9-2 3-.9 4.4-.9 1.5-.3 3.5 1.4 4.2.3 1.8 2.2 2.8 3.9 2.2 1 1.1 2.6 1.3 3.6.4M12 5c1-1.7 3.7-2 5-.4 1.7-.2 3.2 1.3 3 3 1.6.9 2 3 .9 4.4.9 1.5.3 3.5-1.4 4.2-.3 1.8-2.2 2.8-3.9 2.2-1 1.1-2.6 1.3-3.6.4M12 5v13.8" />
    <path
      className="links"
      d="M8 9l1.5 4.5M8 9l-1.5 3M15.8 8.6l-1.2 4.8M15.8 8.6l1.9 3.2M9.5 13.5l-3 -1.5M14.6 13.4l3.1-1.6"
    />
    <circle cx="8" cy="9" r="1.1" />
    <circle cx="9.5" cy="13.5" r="1.1" />
    <circle cx="6.5" cy="12" r="0.9" />
    <circle cx="15.8" cy="8.6" r="1.1" />
    <circle cx="14.6" cy="13.4" r="1.1" />
    <circle cx="17.7" cy="11.8" r="0.9" />
  </svg>
);
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
const SIGN_OUT_ICON = (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="btn-icon">
    <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8M12 6.5 15.5 10 12 13.5M15.5 10H8" />
  </svg>
);

const PAGES: { id: Page; label: string; icon: ReactNode }[] = [
  { id: "board", label: "Board", icon: BOARD_ICON },
  { id: "agents", label: "Agents", icon: AGENTS_ICON },
];

/** Signs out, then shows the sign-in page with the brain, never the app's own frame. */
function signOut(): void {
  void api.signOut().finally(() => location.assign("/sign-in"));
}

export function AppShell(props: {
  me?: Me;
  page: Page;
  onPage: (page: Page) => void;
  children: ReactNode;
}) {
  const title = PAGES.find((p) => p.id === props.page)?.label ?? "";
  return (
    <DashboardShell
      brand={
        <span className="pf-brand">
          {BRAIN_MARK}
          <span>
            sky<span className="dash">-</span>brain
          </span>
        </span>
      }
      navigation={
        props.me &&
        PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            className="pf-sidebar-link"
            title={p.label}
            aria-current={props.page === p.id ? "page" : undefined}
            onClick={() => props.onPage(p.id)}
          >
            {p.icon}
            <span className="nav-label">{p.label}</span>
          </button>
        ))
      }
      toolbar={
        <>
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
