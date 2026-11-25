// The JSON error shape of spec.md Interfaces -> Wire types -> errors.
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { errorHandler } from "./error-handler.ts";
import { HttpError } from "./http-error.ts";

let server: Server;
let url: string;

beforeAll(async () => {
  const app = express();
  app.get("/http-error", () => {
    throw new HttpError(413, "too_large", "Title is too long.", {
      field: "title",
    });
  });
  app.get("/rule", () => {
    throw new HttpError(403, "agent_cannot_write_rule", "No.", {
      rule: "agents-no-rules",
    });
  });
  app.get("/crash", async () => {
    await Promise.resolve();
    throw new Error("secret internals at /srv/app.ts:12");
  });
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("errorHandler", () => {
  it("renders an HttpError with its status, code, message and field", async () => {
    const res = await fetch(`${url}/http-error`);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: {
        code: "too_large",
        message: "Title is too long.",
        field: "title",
      },
    });
  });

  it("renders the rule of an HttpError", async () => {
    const res = await fetch(`${url}/rule`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: "agent_cannot_write_rule",
        message: "No.",
        rule: "agents-no-rules",
      },
    });
  });

  it("answers anything else with 500 internal and no stack", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await fetch(`${url}/crash`);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({
        error: { code: "internal", message: "Internal error." },
      });
      expect(text).not.toContain("secret internals");
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
