import { describe, expect, it } from "vitest";
import { normalizeGitRemote } from "./git-remote.ts";

// Every row of spec.md Interfaces -> Git remote normalization.
const normalized: [string, string][] = [
  [
    "https://github.com/Hamilton-Sky/sky-brain.git",
    "github.com/hamilton-sky/sky-brain",
  ],
  [
    "git@github.com:hamilton-sky/sky-brain.git",
    "github.com/hamilton-sky/sky-brain",
  ],
  [
    "ssh://git@github.com:22/hamilton-sky/sky-brain",
    "github.com/hamilton-sky/sky-brain",
  ],
  [
    "https://x-access-token:abc123@github.com/hamilton-sky/sky-brain/",
    "github.com/hamilton-sky/sky-brain",
  ],
  [
    "git://github.com/hamilton-sky/sky-brain",
    "github.com/hamilton-sky/sky-brain",
  ],
  [
    "http://gitlab.example.com:8443/group/sub/repo.git",
    "gitlab.example.com/group/sub/repo",
  ],
];

describe("normalizeGitRemote", () => {
  it.each(normalized)("normalizes %s", (input, expected) => {
    expect(normalizeGitRemote(input)).toBe(expected);
  });

  it.each(["not a remote", "", "https://github.com"])(
    "returns null for %j",
    (input) => {
      expect(normalizeGitRemote(input)).toBeNull();
    },
  );

  it("trims, collapses repeated slashes and handles git+ssh", () => {
    expect(
      normalizeGitRemote("  git+ssh://git@github.com//Org//Repo.git/  "),
    ).toBe("github.com/org/repo");
  });
});
