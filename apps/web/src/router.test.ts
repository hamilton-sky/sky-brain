import { describe, expect, it } from "vitest";
import { parseRoute, routePath } from "./router.ts";

describe("routes", () => {
  it("reads the board, agents and a document page", () => {
    const id = "0b9a6f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    expect(parseRoute("/")).toEqual({ page: "board" });
    expect(parseRoute("/agents")).toEqual({ page: "agents" });
    expect(parseRoute(`/docs/${id}`)).toEqual({ page: "doc", entryId: id });
    expect(routePath({ page: "doc", entryId: id })).toBe(`/docs/${id}`);
    expect(parseRoute("/approvals")).toEqual({ page: "approvals" });
    expect(parseRoute(`/a/${id}`)).toEqual({ page: "approval", id });
    expect(routePath({ page: "approval", id })).toBe(`/a/${id}`);
    expect(routePath({ page: "agents" })).toBe("/agents");
    expect(routePath({ page: "board" })).toBe("/");
  });
  it("reads a layer page of the brain", () => {
    expect(parseRoute("/brain/inbox")).toEqual({
      page: "layer",
      layer: "short",
    });
    expect(parseRoute("/brain/about-me/")).toEqual({
      page: "layer",
      layer: "core",
    });
    expect(routePath({ page: "layer", layer: "long" })).toBe(
      "/brain/notebooks",
    );
    expect(parseRoute("/brain/board")).toEqual({ page: "board" });
    expect(parseRoute("/brain/")).toEqual({ page: "board" });
  });
  it("sends anything else to the board", () => {
    expect(parseRoute("/docs/not-an-id")).toEqual({ page: "board" });
    expect(parseRoute("/docs/../../api")).toEqual({ page: "board" });
    expect(parseRoute("/a/123")).toEqual({ page: "board" });
  });
});
