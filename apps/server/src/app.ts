import express from "express";
import { fileURLToPath } from "node:url";
import { actorMiddleware, type ActorResolver } from "./actor/middleware.ts";
import type { Auth } from "./auth/auth.ts";
import { mountAuth } from "./auth/routes.ts";
import type { Db } from "./db/client.ts";
import { errorHandler } from "./http/error-handler.ts";

export interface AppOptions {
  db: Db;
  /** Finds the actor of a request. Default: none, until the auth feature adds one. */
  resolveActor?: ActorResolver;
  /** Honour `X-Dev-Actor`. Default false; see `devActorHeaderEnabled`. */
  devActorHeader?: boolean;
  /** The clock routes use. Default: `() => new Date()`. */
  now?: () => Date;
  /** Folder holding the web build. Default: apps/web/dist. */
  webDist?: string;
  /** Better Auth and the origin it serves (`authFromConfig`). Default: no auth routes. */
  auth?: { instance: Auth; publicUrl: string };
}

const defaultWebDist = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
);

export function createApp(options: AppOptions): express.Express {
  const webDist = options.webDist ?? defaultWebDist;
  // db and now are handed to the routers the entries tickets mount on /api/v1.
  const app = express();

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // Before /api/v1, the /api 404, express.static and the catch-all, which would shadow it.
  if (options.auth) mountAuth(app, options.auth.instance);

  // Check order steps 1 and 2: the actor before the body, so an anonymous body is never read.
  app.use(
    "/api/v1",
    actorMiddleware({
      resolveActor: options.resolveActor ?? (() => undefined),
      devActorHeader: options.devActorHeader ?? false,
    }),
    express.json({ limit: "64kb" }),
  );

  app.use("/api", (_req, res) => {
    res
      .status(404)
      .json({ error: { code: "not_found", message: "No such API route." } });
  });

  app.use(express.static(webDist));

  app.get("/{*splat}", (_req, res) => {
    res.sendFile("index.html", { root: webDist }, (err) => {
      if (err && !res.headersSent) {
        res.status(404).type("text/plain").send("Not found");
      }
    });
  });

  // Last, and for the API only: other paths keep Express's own error page.
  app.use("/api", errorHandler);

  return app;
}
