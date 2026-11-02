import express from "express";
import { fileURLToPath } from "node:url";
import { actorMiddleware, type ActorResolver } from "./actor/middleware.ts";
import type { Db } from "./db/client.ts";
import { deviceFlowRouter } from "./devices/device-flow.ts";
import { devicesRouter } from "./devices/devices-router.ts";
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
}

const defaultWebDist = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
);

export function createApp(options: AppOptions): express.Express {
  const webDist = options.webDist ?? defaultWebDist;
  const db = options.db;
  // Every time comparison in a route uses this clock, so tests can move time.
  const now = options.now ?? (() => new Date());
  const app = express();
  // Render runs one proxy in front of the app: take the client address and scheme from the last
  // hop it adds to X-Forwarded-For / X-Forwarded-Proto, never from earlier, caller-sent hops.
  app.set("trust proxy", 1);

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // The anonymous device flow: before the actor middleware, with its own body parser.
  app.use("/api/device", deviceFlowRouter({ db, now }));

  // Check order steps 1 and 2: the actor before the body, so an anonymous body is never read.
  app.use(
    "/api/v1",
    actorMiddleware({
      resolveActor: options.resolveActor ?? (() => undefined),
      devActorHeader: options.devActorHeader ?? false,
    }),
    express.json({ limit: "64kb" }),
  );

  app.use("/api/v1/devices", devicesRouter({ db, now }));

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
