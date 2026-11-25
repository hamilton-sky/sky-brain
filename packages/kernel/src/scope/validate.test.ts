// validate() with the shared IdSchema and ScopeRefSchema (Check order step 5).
import { IdSchema, ScopeRefSchema } from "@sky-brain/shared/scope";
import { describe, expect, it } from "vitest";
import { validate } from "../http/validate.ts";

const uuid = "3f1c2a4e-9b7d-4c1e-8a2f-6d5e4c3b2a10";

describe("validate", () => {
  it("passes a uuid id", () => {
    expect(validate(IdSchema, uuid)).toBe(uuid);
  });

  it("refuses an id that is not a uuid", () => {
    for (const bad of ["not-a-uuid", "", 42, undefined, `${uuid}x`]) {
      expect(() => validate(IdSchema, bad)).toThrow(
        expect.objectContaining({ status: 400, code: "invalid_request" }),
      );
    }
  });

  it("passes a scope with exactly one id", () => {
    expect(validate(ScopeRefSchema, { workspace_id: uuid })).toEqual({
      workspace_id: uuid,
    });
    expect(validate(ScopeRefSchema, { project_id: uuid })).toEqual({
      project_id: uuid,
    });
    expect(validate(ScopeRefSchema, { feature_id: uuid })).toEqual({
      feature_id: uuid,
    });
  });

  it("refuses a scope with two ids, none, or a non-uuid id", () => {
    for (const bad of [
      { workspace_id: uuid, project_id: uuid },
      { project_id: uuid, feature_id: uuid },
      {},
      { project_id: "not-a-uuid" },
      null,
      "x",
    ]) {
      expect(() => validate(ScopeRefSchema, bad)).toThrow(
        expect.objectContaining({ status: 400, code: "invalid_request" }),
      );
    }
  });
});
