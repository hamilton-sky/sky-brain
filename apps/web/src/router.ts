// The app's few addresses: `/` (the board), `/agents`, and `/docs/<entry id>` (a document's own
// page). The server and Vercel answer every other path with index.html, so a link or a reload
// lands back here.
import { useEffect, useState } from "react";

export type Route =
  { page: "board" } | { page: "agents" } | { page: "doc"; entryId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoute(path: string): Route {
  if (path === "/agents") return { page: "agents" };
  const m = /^\/docs\/([^/]+)\/?$/.exec(path);
  if (m && UUID.test(m[1]!)) return { page: "doc", entryId: m[1]! };
  return { page: "board" };
}

export function routePath(route: Route): string {
  return route.page === "doc"
    ? `/docs/${route.entryId}`
    : route.page === "agents"
      ? "/agents"
      : "/";
}

const EVENT = "sky-brain:navigate";

export function navigate(route: Route): void {
  const path = routePath(route);
  if (location.pathname !== path) history.pushState(null, "", path);
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
