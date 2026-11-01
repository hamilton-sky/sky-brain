// Git remote normalization (spec.md Interfaces -> Git remote normalization).
// Every machine that clones the same repository finds the same project.

const SCHEME = /^(?:git\+ssh|ssh|git|https?):\/\//i;
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

export function normalizeGitRemote(input: string): string | null {
  let rest = input.trim();
  if (rest === "" || /\s/.test(rest)) return null;

  const hasScheme = SCHEME.test(rest);
  rest = rest.replace(SCHEME, "");

  const slash = rest.indexOf("/");
  let authority = slash === -1 ? rest : rest.slice(0, slash);
  let path = slash === -1 ? "" : rest.slice(slash + 1);

  const at = authority.lastIndexOf("@");
  if (at !== -1) authority = authority.slice(at + 1);

  const colon = authority.indexOf(":");
  if (colon !== -1) {
    const after = authority.slice(colon + 1);
    authority = authority.slice(0, colon);
    if (hasScheme) {
      // With a scheme, `host:digits` is a port.
      if (!/^\d*$/.test(after)) return null;
    } else {
      // scp-like `host:path`.
      path = path === "" ? after : `${after}/${path}`;
    }
  }

  const host = authority.toLowerCase();
  if (!HOST.test(host)) return null;

  path = path
    .toLowerCase()
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  if (path === "") return null;

  return `${host}/${path}`;
}
