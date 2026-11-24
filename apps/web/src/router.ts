// The app's few addresses: `/` (the board), `/approvals`, `/a/<request id>` (an approval link an
// agent hands the person), `/agents`, and `/docs/<entry id>` (a document's own page). The server and Vercel answer every other path with index.html, so a link or a reload
// lands back here.
import { useEffect, useState } from "react";

export type Route =
  | { page: "board" }
  | { page: "approvals" }
  | { page: "agents" }
  | { page: "approval"; id: string }
  | { page: "doc"; entryId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoute(path: string): Route {
  if (path === "/agents") return { page: "agents" };
  if (path === "/approvals") return { page: "approvals" };
  const m = /^\/(docs|a)\/([^/]+)\/?$/.exec(path);
  if (m && UUID.test(m[2]!)) {
    return m[1] === "a"
      ? { page: "approval", id: m[2]! }
      : { page: "doc", entryId: m[2]! };
  }
  return { page: "board" };
}

export function routePath(route: Route): string {
  switch (route.page) {
    case "doc":
      return `/docs/${route.entryId}`;
    case "approval":
      return `/a/${route.id}`;
    case "board":
      return "/";
    default:
      return `/${route.page}`;
  }
}

const EVENT = "sky-brain:navigate";

/** Goes to a route; `replace` swaps the current history entry (no extra Back step). */
export function navigate(route: Route, replace = false): void {
  const path = routePath(route);
  if (replace) history.replaceState(null, "", path);
  else if (location.pathname !== path) history.pushState(null, "", path);
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const update = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return route;
}
