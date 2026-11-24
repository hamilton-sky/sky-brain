// The frame around every signed-in page: panel-frame-ui's dashboard shell with the sky-brain
// brand, the pages in the sidebar (with icons, so a collapsed sidebar still works), and a top
// bar with the page's name, the theme picker, who is signed in, and Sign out.
import { Button, DashboardShell, ThemeControl } from "panel-frame-ui";
import type { ReactNode } from "react";
import { api, type Me } from "./api.ts";

export type Page = "board" | "agents";

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
