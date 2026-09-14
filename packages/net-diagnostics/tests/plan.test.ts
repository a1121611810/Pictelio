import { describe, it, expect } from "vitest";
import { CHECK_PLAN, TOTAL_BUDGET_MS, getCheck } from "../src/plan";

describe("CHECK_PLAN", () => {
  it("ids are unique", () => {
    const ids = CHECK_PLAN.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getCheck resolves every planned id", () => {
    for (const c of CHECK_PLAN) expect(getCheck(c.id)?.id).toBe(c.id);
  });

  it("route check is explicitly disabled (direct access removed)", () => {
    expect(getCheck("route")?.disabledReason).toBeTruthy();
  });

  it("serial worst case (sum of item timeouts) equals the total budget", () => {
    const sum = CHECK_PLAN.filter((c) => c.timeoutMs > 0).reduce((a, c) => a + c.timeoutMs, 0);
    expect(sum).toBe(TOTAL_BUDGET_MS);
  });

  it("no single probe timeout exceeds the total budget", () => {
    for (const c of CHECK_PLAN) expect(c.timeoutMs).toBeLessThanOrEqual(TOTAL_BUDGET_MS);
  });

  it("every probe check has a positive timeout", () => {
    for (const c of CHECK_PLAN) {
      if (c.id === "device" || c.id === "route") continue;
      expect(c.timeoutMs).toBeGreaterThan(0);
    }
  });
});
