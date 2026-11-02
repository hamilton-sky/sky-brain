import express from "express";
import { fileURLToPath } from "node:url";
import { actorMiddleware, type ActorResolver } from "./actor/middleware.ts";
import type { Db } from "./db/client.ts";
import { deviceFlowRouter } from "./devices/device-flow.ts";
import { devicesRouter } from "./devices/devices-router.ts";
import { errorHandler } from "./http/error-handler.ts";
import { mintRouter } from "./run-tokens/mint-router.ts";
import { runTokenResolver } from "./run-tokens/resolver.ts";
import { verbMiddleware } from "./run-tokens/verbs.ts";

export interface AppOptions {
  db: Db;
  /** Finds the actor of a request. Default: none, until the auth feature adds one. */
  resolveActor?: ActorResolver;
  /** Honour `X-Dev-Actor`. Default false; see `devActorHeaderEnabled`. */
  devActorHeader?: boolean;
  /**
   * How many proxies in front of the app to trust for the client address and scheme
   * (X-Forwarded-For / X-Forwarded-Proto / X-Forwarded-Host). Default: 1 (the one Render
   * proxy hop assumed in ticket 01's Answer), or 0 when `devActorHeader` is on: `pnpm dev`
   * listens on 127.0.0.1 with no proxy, and a trusted X-Forwarded-Host would let a rebinding
   * page pass the dev actor's localhost check (D15). Must be 0 while `devActorHeader` is on.
   */
  trustProxyHops?: number;
  /**
   * The public origin people reach the app at, such as `https://brain.example`. When set,
   * `verification_uri` is built from it instead of the request's Host.
   */
  publicBaseUrl?: string;
  /** The clock routes use. Default: `() => new Date()`. */
  now?: () => Date;
  /** Folder holding the web build. Default: apps/web/dist. */
  webDist?: string;
}

const defaultWebDist = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
);

function trustProxyHopsOf(options: AppOptions): number {
  const devActorHeader = options.devActorHeader ?? false;
  const hops = options.trustProxyHops ?? (devActorHeader ? 0 : 1);
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error(
      `createApp: trustProxyHops must be a whole number of at least 0, got ${hops}`,
    );
  }
  if (devActorHeader && hops > 0) {
    throw new Error(
      "createApp: trustProxyHops must be 0 while devActorHeader is on (D15)",
    );
  }
  return hops;
}

/** The origin of `raw` without a trailing slash; throws unless it is a bare http(s) origin. */
function publicBaseUrlOf(raw: string): string {
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {
    url = undefined;
  }
  if (
    !url ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(
      `createApp: publicBaseUrl must be a bare http(s) origin such as https://brain.example, got "${raw}"`,
    );
  }
  return url.origin;
}

export function createApp(options: AppOptions): express.Express {
  const webDist = options.webDist ?? defaultWebDist;
  const db = options.db;
  // Every time comparison in a route uses this clock, so tests can move time.
  const now = options.now ?? (() => new Date());
  const hops = trustProxyHopsOf(options);
  const publicBaseUrl =
    options.publicBaseUrl === undefined
      ? undefined
      : publicBaseUrlOf(options.publicBaseUrl);
  const app = express();
  // Take the client address and scheme from the last `hops` entries the proxies in front add to
  // X-Forwarded-For / X-Forwarded-Proto, never from earlier, caller-sent ones. 0 trusts none.
  app.set("trust proxy", hops === 0 ? false : hops);

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // The anonymous device flow: before the actor middleware, with its own body parser.
  app.use("/api/device", deviceFlowRouter({ db, now, publicBaseUrl }));

  // Check order step 1: a device or run token first (`sbd_`/`sbr_`), then the existing resolver.
  const runTokens = runTokenResolver(db, now);
  const otherActors = options.resolveActor ?? (() => undefined);
  const resolveActor: ActorResolver = async (req) =>
    (await runTokens(req)) ?? (await otherActors(req));

  // Check order steps 1 to 3: the actor before the body, so an anonymous body is never read;
  // then the verb check for device and run tokens, before any router.
  app.use(
    "/api/v1",
    actorMiddleware({
      resolveActor,
      devActorHeader: options.devActorHeader ?? false,
    }),
    express.json({ limit: "64kb" }),
    verbMiddleware(),
  );

  app.use("/api/v1/devices", devicesRouter({ db, now }));
  app.use("/api/v1/run-tokens", mintRouter({ db, now }));

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
