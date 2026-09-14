// 网络自检 webview 适配层 IO 边界测试：原生成功路径 + web 降级路径（AGENTS 测试硬约束 #1）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ isNative: { value: false }, fakeRun: vi.fn() }));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => h.isNative.value },
  registerPlugin: () => ({ run: h.fakeRun }),
}));

import { collectNetDiagInput } from "../../../src/native/NetDiag";

describe("collectNetDiagInput (webview)", () => {
  beforeEach(() => {
    h.isNative.value = false;
    h.fakeRun.mockReset();
  });

  it("native path returns device + probes with engine webview", async () => {
    h.isNative.value = true;
    h.fakeRun.mockResolvedValue({
      device: { transports: ["wifi"], validated: true, captivePortal: false, metered: false },
      probes: [{ id: "dns", ok: true, latencyMs: 9 }],
    });
    const inp = await collectNetDiagInput("9.9.9", "42");
    expect(inp.engine).toBe("webview");
    expect(inp.platform).toBe("android");
    expect(inp.device?.validated).toBe(true);
    expect(inp.probes).toHaveLength(1);
    expect(h.fakeRun).toHaveBeenCalledWith({ userId: "42" });
  });

  it("web/dev path degrades explicitly and probes the proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const inp = await collectNetDiagInput("9.9.9");
    expect(inp.degraded).toBe(true);
    expect(inp.platform).toBe("web");
    expect(inp.probes[0]?.id).toBe("http");
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("web/dev path reports a failed fetch instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const inp = await collectNetDiagInput("9.9.9");
    expect(inp.degraded).toBe(true);
    expect(inp.probes[0]?.ok).toBe(false);
    expect(inp.probes[0]?.errorClass).toBe("connect");
    vi.unstubAllGlobals();
  });
});
