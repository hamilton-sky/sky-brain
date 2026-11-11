// The auth test harness (spec.md Interfaces -> How a test reaches the server): the real app with
// Better Auth on a free 127.0.0.1 port, a fake Perminister and fake CIMD documents. Tests only.
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.ts";
import { authFromConfig } from "../auth/from-config.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import {
  createFakePerminister,
  type PerministerAccount,
} from "./fake-perminister.ts";
import type { TestResponse } from "./harness.ts";
import { navigate } from "./navigate.ts";

export type { PerministerAccount };

/** Made up: the fake Perminister's client. Never a real id or secret. */
export const TEST_PERMINISTER_CLIENT_ID = "test-perminister-client";
export const TEST_PERMINISTER_CLIENT_SECRET =
  "test-perminister-secret-not-real";
export const TEST_PERMINISTER_URL = "https://perminister.test";

export interface AuthTestServerOptions {
  db: Db;
  /** client_id URL -> metadata document; every other URL answers 404. */
  cimdDocuments?: Record<string, object>;
}

export interface BrowserResponse extends TestResponse {
  /** The `Location` header, or the `url` of Better Auth's `200 {redirect: true, url}`. */
  next: string | null;
}

export interface Browser {
  request(path: string, init?: RequestInit): Promise<BrowserResponse>;
}

export interface AuthTestServer {
  /** http://127.0.0.1:<port>, also the PUBLIC_URL. */
  url: string;
  /** The fake Perminister's base URL. */
  perministerUrl: string;
  /** Whom the fake signs in next. */
  setPerministerAccount(account: PerministerAccount): void;
  /** The fake's /oauth/authorize: checks the URL, returns the callback path with a new code. */
  approve(authorizeUrl: string): string;
  /** A fresh cookie jar. */
  browser(): Browser;
  /** A JWT signed with the server's own key. */
  signJwt(payload: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

async function toTestResponse(res: Response): Promise<TestResponse> {
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, text };
}

function fakeCimd(
  documents: Record<string, object>,
): ClientMetadataResourceFetch {
  return (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const doc = documents[url];
    return doc
      ? Response.json(doc)
      : new Response("Not found", { status: 404 });
  };
}

function browserFor(url: string): Browser {
  const jar = new Map<string, string>();
  return {
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      if (jar.size > 0) {
        headers.set(
          "cookie",
          [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
        );
      }
      headers.set("origin", url);
      // A GET is the person's browser following a link or redirect (a navigation); anything
      // else is the page script's fetch.
      const method = (init.method ?? "GET").toUpperCase();
      const res =
        method === "GET" && init.body == null
          ? await navigate(url + path, headers)
          : await fetch(url + path, { ...init, headers, redirect: "manual" });
      for (const cookie of res.headers.getSetCookie()) {
        const [pair = "", ...attrs] = cookie.split(";");
        const at = pair.indexOf("=");
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        const expired = attrs.some((a) => {
          const [key = "", ...rest] = a.split("=");
          const attr = key.trim().toLowerCase();
          const val = rest.join("=").trim();
          if (attr === "max-age") return Number(val) <= 0;
          if (attr === "expires") return Date.parse(val) <= Date.now();
          return false;
        });
        if (!value || expired) jar.delete(name);
        else jar.set(name, value);
      }
      const out = await toTestResponse(res);
      const location = res.headers.get("location");
      const next =
        location ??
        (out.body?.redirect === true && typeof out.body.url === "string"
          ? (out.body.url as string)
          : null);
      return { ...out, next };
    },
  };
}

export async function startAuthTestServer(
  opts: AuthTestServerOptions,
): Promise<AuthTestServer> {
  // Listen first: the URL is the PUBLIC_URL the auth instance is built with.
  const server: Server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const perminister = createFakePerminister({
    baseUrl: TEST_PERMINISTER_URL,
    clientId: TEST_PERMINISTER_CLIENT_ID,
    clientSecret: TEST_PERMINISTER_CLIENT_SECRET,
    publicUrl: url,
  });
  const config: Config = {
    port: 0,
    databaseUrl: undefined,
    pgliteDataDir: "memory://",
    nodeEnv: "test",
    publicUrl: url,
    betterAuthSecret: randomBytes(32).toString("base64url"),
    perministerBaseUrl: TEST_PERMINISTER_URL,
    perministerClientId: TEST_PERMINISTER_CLIENT_ID,
    perministerClientSecret: TEST_PERMINISTER_CLIENT_SECRET,
  };
  const auth = authFromConfig(config, opts.db, {
    publicUrl: url,
    perministerFetch: perminister.fetch,
    fetchClientMetadataResource: fakeCimd(opts.cimdDocuments ?? {}),
  });
  const app = createApp({
    db: opts.db,
    auth: { instance: auth.instance, publicUrl: url },
  });
  server.on("request", app);

  return {
    url,
    perministerUrl: TEST_PERMINISTER_URL,
    setPerministerAccount: (account) => perminister.setAccount(account),
    approve: (authorizeUrl) => perminister.approve(authorizeUrl),
    browser: () => browserFor(url),
    async signJwt(payload) {
      const { token } = await auth.instance.api.signJWT({ body: { payload } });
      return token;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
