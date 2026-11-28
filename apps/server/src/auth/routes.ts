// The auth routes (spec.md Interfaces -> Routes this feature adds). createApp mounts them before
// the /api 404, express.static and the web catch-all, which would otherwise shadow them.
import { toNodeHandler } from "better-auth/node";
import type express from "express";
import type { Auth } from "./auth.ts";
import { stripStateSuffix } from "./perminister-oidc.ts";
import { brainScript } from "./pages/brain-script.ts";
// Named imports, so dead-code checks see each part of the page in use.
import {
  html as consentHtml,
  script as consentScript,
  style as consentStyle,
} from "./pages/consent.ts";
import {
  html as signInHtml,
  script as signInScript,
  style as signInStyle,
} from "./pages/sign-in.ts";

interface Page {
  html: string;
  script: string;
  /** The page's stylesheet, served as /auth-pages/<name>.css (no inline style under the CSP). */
  style?: string;
}

const pages: Record<string, Page> = {
  "sign-in": { html: signInHtml, script: signInScript, style: signInStyle },
  consent: { html: consentHtml, script: consentScript, style: consentStyle },
};

/** Pages ship inside the bundle as strings (spec.md Decisions); an empty one is not built yet. */
function sendPage(
  res: express.Response,
  body: string,
  type: "html" | "text/javascript" | "text/css",
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

  // A callback with no state is a forged one too (spec.md Edge cases): Better Auth would answer
  // `state_not_found`, the spec asks for its error page with `state_mismatch` and no session.
  app.get("/api/auth/callback/perminister", (req, res, next) => {
    const { state } = req.query;
    if (typeof state === "string" && state !== "") {
      next();
      return;
    }
    res.redirect(302, "/api/auth/error?error=state_mismatch");
  });
  app.all("/api/auth/*splat", handler);
  // Better Auth's mcp() and oauth provider answer these absolute paths in its own handler.
  app.get("/.well-known/oauth-protected-resource", handler);
  app.get("/.well-known/oauth-protected-resource/mcp", handler);
  app.get("/.well-known/oauth-authorization-server/api/auth", handler);

  // Perminister's callback path is fixed; Better Auth's generic provider listens under /api/auth.
  // Perminister echoes the padded state (perminister-oidc.ts); Better Auth checks its own.
  app.get("/auth/perminister/callback", (req, res) => {
    const at = req.originalUrl.indexOf("?");
    const params = new URLSearchParams(
      at === -1 ? "" : req.originalUrl.slice(at + 1),
    );
    const state = params.get("state");
    if (state !== null) params.set("state", stripStateSuffix(state));
    const query = params.toString();
    res.redirect(
      302,
      `/api/auth/callback/perminister${query ? `?${query}` : ""}`,
    );
  });

  // The 3D brain alone, for the small brain in the web app's header.
  app.get("/auth-pages/brain.js", (_req, res) => {
    sendPage(res, brainScript, "text/javascript");
  });
  for (const [name, page] of Object.entries(pages)) {
    app.get(`/${name}`, (_req, res) => {
      sendPage(res, page.html, "html");
    });
    app.get(`/auth-pages/${name}.js`, (_req, res) => {
      sendPage(res, page.script, "text/javascript");
    });
    const { style } = page;
    if (style !== undefined) {
      app.get(`/auth-pages/${name}.css`, (_req, res) => {
        sendPage(res, style, "text/css");
      });
    }
  }
}
