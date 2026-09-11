// 网络自检 lynx 适配层 IO 边界测试：原生成功 + 模块缺失降级 + 解析失败降级（AGENTS 测试硬约束 #1）。
import { describe, it, expect, afterEach } from "vitest";
import { collectNetDiagInput } from "./netDiagnostics";

type G = { NativeModules?: unknown };
const g = globalThis as unknown as G;

afterEach(() => {
  delete g.NativeModules;
});

describe("collectNetDiagInput (lynx)", () => {
  it("degrades explicitly when the native module is absent (web-core)", async () => {
    const inp = await collectNetDiagInput("1.0.0");
    expect(inp.degraded).toBe(true);
    expect(inp.engine).toBe("lynx");
    expect(inp.probes).toEqual([]);
  });

  it("parses the native JSON payload", async () => {
    g.NativeModules = {
      NetDiag: {
        diagnose: (_uid: string, cb: (json: string) => void) =>
          cb(
            JSON.stringify({
              device: { transports: ["wifi"], validated: true, captivePortal: false, metered: false },
              probes: [{ id: "dns", ok: true, latencyMs: 5 }],
            }),
          ),
      },
    };
    const inp = await collectNetDiagInput("1.0.0", "42");
    expect(inp.device?.validated).toBe(true);
    expect(inp.probes).toHaveLength(1);
    expect(inp.degraded).toBeUndefined();
  });

  it("degrades on unparseable native output", async () => {
    g.NativeModules = {
      NetDiag: { diagnose: (_uid: string, cb: (json: string) => void) => cb("not json") },
    };
    const inp = await collectNetDiagInput("1.0.0");
    expect(inp.degraded).toBe(true);
  });
});
