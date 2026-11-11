// A browser navigation for the auth test harness. Node's fetch always sends
// `Sec-Fetch-Mode: cors`, so Better Auth takes every request from it for a script's fetch and
// answers a resumed OAuth authorization with JSON. A real browser following a link or redirect
// sends `navigate` and gets a 302; node:http lets the harness send the same. Tests only.
import { request } from "node:http";

/** GET `url` with `headers` (plus `Sec-Fetch-Mode: navigate` unless set), never following. */
export function navigate(url: string, headers: Headers): Promise<Response> {
  const sent: Record<string, string> = { "sec-fetch-mode": "navigate" };
  headers.forEach((value, name) => {
    sent[name] = value;
  });
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers: sent }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        const out = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          for (const v of Array.isArray(value) ? value : [value ?? ""]) {
            out.append(name, v);
          }
        }
        const status = res.statusCode ?? 0;
        const empty = status === 204 || status === 304;
        resolve(
          new Response(empty ? null : Buffer.concat(chunks), {
            status,
            headers: out,
          }),
        );
      });
    });
    req.on("error", reject);
    req.end();
  });
}
