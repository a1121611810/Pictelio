import { describe, it, expect } from "vitest";
import { formatReport, redactSecrets } from "../src/report";
import type { DiagInput } from "../src/types";

describe("redactSecrets", () => {
  it("redacts bearer tokens", () => {
    expect(redactSecrets("Authorization: Bearer abc.def-123")).not.toContain("abc.def-123");
  });

  it("redacts token query params", () => {
    const out = redactSecrets("access_token=SECRETVALUE&refresh_token=OTHERSECRET");
    expect(out).not.toContain("SECRETVALUE");
    expect(out).not.toContain("OTHERSECRET");
  });
});

describe("formatReport", () => {
  const input: DiagInput = {
    platform: "android",
    engine: "lynx",
    appVersion: "9.9.9",
    device: { transports: ["wifi"], validated: true, captivePortal: false, metered: false },
    probes: [{ id: "dns", ok: false, errorClass: "dns", rawError: "failed Bearer super.secret.token" }],
    capturedAt: "2026-09-11T00:00:00Z",
  };

  it("includes whitelisted metadata but never leaks secrets", () => {
    const out = formatReport(input);
    expect(out).toContain("v9.9.9");
    expect(out).toContain("lynx");
    expect(out).not.toContain("super.secret.token");
    expect(out).toContain("[REDACTED]");
  });

  it("reports skip for route instead of omitting it", () => {
    expect(formatReport(input)).toContain("网络直连路由");
  });
});
