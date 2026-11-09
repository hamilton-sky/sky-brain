// The auth routes (spec.md Interfaces -> Routes this feature adds). createApp mounts them before
// the /api 404, express.static and the web catch-all, which would otherwise shadow them.
import { toNodeHandler } from "better-auth/node";
import type express from "express";
import type { Auth } from "./auth.ts";
import * as consentPage from "./pages/consent.ts";
import * as signInPage from "./pages/sign-in.ts";

interface Page {
  html: string;
  script: string;
}

const pages: Record<string, Page> = {
  "sign-in": signInPage,
  consent: consentPage,
};

/** Pages ship inside the bundle as strings (spec.md Decisions); an empty one is not built yet. */
function sendPage(
  res: express.Response,
  body: string,
  type: "html" | "text/javascript",
): void {
  res.set({
    "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
    "Cache-Control": "no-store",
  });
  if (!body) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  res.status(200).type(type).send(body);
}

export function mountAuth(app: express.Express, auth: Auth): void {
  const handler = toNodeHandler(auth);

  app.all("/api/auth/*splat", handler);
  // Better Auth's mcp() and oauth provider answer these absolute paths in its own handler.
  app.get("/.well-known/oauth-protected-resource", handler);
  app.get("/.well-known/oauth-protected-resource/mcp", handler);
  app.get("/.well-known/oauth-authorization-server/api/auth", handler);

  // Perminister's callback path is fixed; Better Auth's generic provider listens under /api/auth.
  app.get("/auth/perminister/callback", (req, res) => {
    const at = req.originalUrl.indexOf("?");
    const query = at === -1 ? "" : req.originalUrl.slice(at);
    res.redirect(302, `/api/auth/callback/perminister${query}`);
  });

  for (const [name, page] of Object.entries(pages)) {
    app.get(`/${name}`, (_req, res) => {
      sendPage(res, page.html, "html");
    });
    app.get(`/auth-pages/${name}.js`, (_req, res) => {
      sendPage(res, page.script, "text/javascript");
    });
  }
}
