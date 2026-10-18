import { describe, it, expect } from "vitest";
import { CHECK_PLAN } from "../src/plan";

describe("CHECK_PLAN", () => {
  it("ids are unique", () => {
    const ids = CHECK_PLAN.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
