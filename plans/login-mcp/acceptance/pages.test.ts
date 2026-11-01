// The /sign-in and /consent pages (Interfaces -> Routes this feature adds, -> The pages).
import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

const ctx = setup();

function expectPageHeaders(headers: Headers): void {
  const csp = headers.get("content-security-policy") ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers.get("cache-control") ?? "").toContain("no-store");
}

describe("the consent page", () => {
  // - [ ] The `/consent` page cannot be framed (`frame-ancestors 'none'`) and shows the redirect host.
  it("GET /consent cannot be framed", async () => {
    const server = await ctx.server();
    const res = await server.browser().request("/consent");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy") ?? "").toContain("frame-ancestors 'none'");
  });

  it("the consent page shows the redirect host, filled only through textContent", async () => {
    const server = await ctx.server();
    const page = await server.browser().request("/consent");
    expect(page.status).toBe(200);
    expect(page.text).toContain('id="redirect-host"');
    expect(page.text).toContain('src="/auth-pages/consent.js"');
    const script = await server.browser().request("/auth-pages/consent.js");
    expect(script.status).toBe(200);
    expect(script.text).toContain("redirect_uri");
    expect(script.text).toContain(".host");
    expect(script.text).toContain("textContent");
    expect(script.text).not.toContain("innerHTML");
  });

  // Interfaces: "`GET /consent` answers HTML holding `id="client-name"`, `id="email"`,
  // `id="redirect-host"`, `id="scopes"`, and the buttons `id="allow"` and `id="deny"`."
  it("the consent page holds the client name, email, redirect host, scopes, Allow and Deny", async () => {
    const server = await ctx.server();
    const page = await server.browser().request("/consent");
    for (const id of ["client-name", "email", "redirect-host", "scopes"]) {
      expect(page.text).toContain(`id="${id}"`);
    }
    expect(page.text).toMatch(/<button[^>]*id="allow"/);
    expect(page.text).toMatch(/<button[^>]*id="deny"/);
  });
});

describe("the sign-in page says No access", () => {
  // - [ ] ... the browser lands on `/sign-in?error=no_access` and the page says "No access".
  // Interfaces: "the HTML of `GET /sign-in?error=no_access` contains `id="no-access"` and
  // `No access`, and `GET /auth-pages/sign-in.js` contains `error` and `no-access`."
  it("GET /sign-in?error=no_access holds the No access section and sign-in.js shows it on error", async () => {
    const server = await ctx.server();
    const page = await server.browser().request("/sign-in?error=no_access");
    expect(page.status).toBe(200);
    expect(page.text).toContain('id="no-access"');
    expect(page.text).toContain("No access");
    expect(page.text).toContain("Try another account");
    expect(page.text).toContain('src="/auth-pages/sign-in.js"');
    const script = await server.browser().request("/auth-pages/sign-in.js");
    expect(script.status).toBe(200);
    expect(script.text).toContain("error");
    expect(script.text).toContain("no-access");
  });
});

describe("page headers", () => {
  // Interfaces -> Routes: "`GET /sign-in`, `GET /consent` | static HTML (`Content-Security-Policy:
  // default-src 'self'; frame-ancestors 'none'`, `Cache-Control: no-store`)"; the scripts "same
  // headers, `text/javascript`".
  for (const path of ["/sign-in", "/consent"]) {
    it(`GET ${path} answers HTML with the strict CSP and no-store`, async () => {
      const server = await ctx.server();
      const res = await server.browser().request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toMatch(/^text\/html/);
      expectPageHeaders(res.headers);
      expect(res.text).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    });
  }

  for (const path of ["/auth-pages/sign-in.js", "/auth-pages/consent.js"]) {
    it(`GET ${path} answers text/javascript with the same headers`, async () => {
      const server = await ctx.server();
      const res = await server.browser().request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toMatch(/^text\/javascript/);
      expectPageHeaders(res.headers);
    });
  }
});
