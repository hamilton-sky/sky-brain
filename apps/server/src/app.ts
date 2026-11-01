import express from "express";
import { fileURLToPath } from "node:url";

export interface AppOptions {
  /** Folder holding the web build. Default: apps/web/dist. */
  webDist?: string;
}

const defaultWebDist = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
);

export function createApp(options: AppOptions = {}): express.Express {
  const webDist = options.webDist ?? defaultWebDist;
  const app = express();

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

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

  return app;
}
