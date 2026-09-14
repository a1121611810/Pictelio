import { describe, it, expect } from "vitest";
import { evaluate } from "../src/judge";
import type { DiagInput, ProbeOutcome } from "../src/types";

function base(overrides: Partial<DiagInput> = {}): DiagInput {
  return {
    platform: "android",
    engine: "webview",
    appVersion: "0.0.0-test",
    device: { transports: ["wifi"], validated: true, captivePortal: false, metered: false },
    probes: [
      { id: "dns", ok: true, latencyMs: 12 },
      { id: "tcp", ok: true, latencyMs: 30 },
      { id: "tls", ok: true, latencyMs: 60 },
      { id: "http", ok: true, latencyMs: 120 },
      { id: "edge", ok: true, latencyMs: 90 },
    ],
    ...overrides,
  };
}

function withProbe(id: string, p: ProbeOutcome): DiagInput {
  const b = base();
  return { ...b, probes: [...b.probes.filter((x) => x.id !== id), p] };
}

describe("evaluate", () => {
  it("all ok -> overall ok, attribution none", () => {
    const r = evaluate(base());
    expect(r.overall).toBe("ok");
    expect(r.attribution).toBe("none");
  });

  it("route is always skipped with an explicit reason", () => {
    const route = evaluate(base()).checks.find((c) => c.id === "route");
    expect(route?.status).toBe("skipped");
    expect(route?.detail).toContain("移除");
  });

  it("no transport -> device fail", () => {
    const r = evaluate(base({ device: { transports: ["none"], validated: false, captivePortal: false, metered: false } }));
    expect(r.overall).toBe("fail");
    expect(r.attribution).toBe("device");
  });

  it("captive portal -> device attribution and captive headline", () => {
    const r = evaluate(base({ device: { transports: ["wifi"], validated: false, captivePortal: true, metered: false } }));
    expect(r.attribution).toBe("device");
    expect(r.headline).toContain("登录");
  });

  it("dns ok but tcp reset -> network", () => {
    const r = evaluate(withProbe("tcp", { id: "tcp", ok: false, errorClass: "connect" }));
    expect(r.overall).toBe("fail");
    expect(r.attribution).toBe("network");
  });

  it("http 401 -> auth and /login action", () => {
    const r = evaluate(withProbe("http", { id: "http", ok: false, errorClass: "auth", httpStatus: 401 }));
    expect(r.attribution).toBe("auth");
    expect(r.actionTarget).toBe("/login");
  });

  it("http 5xx -> service", () => {
    const r = evaluate(withProbe("http", { id: "http", ok: false, errorClass: "http_status", httpStatus: 503 }));
    expect(r.attribution).toBe("service");
  });

  it("missing probe -> skipped", () => {
    const b = base();
    const edge = evaluate({ ...b, probes: b.probes.filter((p) => p.id !== "edge") }).checks.find((c) => c.id === "edge");
    expect(edge?.status).toBe("skipped");
  });

  it("degraded web without device -> device skipped not fail", () => {
    const dev = evaluate(base({ device: undefined, degraded: true })).checks.find((c) => c.id === "device");
    expect(dev?.status).toBe("skipped");
  });

  it("warn never outranks fail in overall", () => {
    const b = base();
    const input: DiagInput = {
      ...b,
      device: { transports: ["wifi"], validated: false, captivePortal: false, metered: false },
      probes: [...b.probes.filter((p) => p.id !== "tcp"), { id: "tcp", ok: false, errorClass: "timeout" }],
    };
    expect(evaluate(input).overall).toBe("fail");
  });
});
