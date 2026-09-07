// @vitest-environment node
/**
 * apiProxyStore 单测（ADR-0146 D3）——「API 反代地址」设置：校验 + 归一化 + 落盘契约。
 *
 * <b>Oracle 溯源</b>：
 * <ul>
 *   <li><b>落盘契约</b>（CapacitorStorage 原始字符串、stringCodec 无引号落盘）：
 *       Java ApiEndpoints.PREF_KEY 同名 getString 读取——断言的是<b>落盘序列化字符串</b>
 *       （经真实 settings registry + stringCodec 管线，仅存储后端换为内存 adapter，
 *       与生产 @capacitor/preferences 写入路径同构，harness 模式镜像
 *       directAccessStore.test.ts）；</li>
 *   <li><b>校验边界</b>（https 前缀、尾斜杠归一化、空=关闭）：ADR-0146 D2/D3 拍板
 *       （凭据面拒明文；Worker 前缀路由按无尾斜杠基址拼接）。</li>
 * </ul>
 */
import { describe, it, expect, vi } from "vitest";
import type { Settings } from "@/settings/registry";

const mockState = vi.hoisted(() => ({
  current: null as Settings | null,
}));

vi.mock("@/settings", () => ({
  get settings() {
    return mockState.current;
  },
}));

async function loadStore(seed: Record<string, string> = {}) {
  vi.resetModules();
  const { createSettings } = await import("@/settings/registry");
  const { createMemoryAdapter } = await import("@/settings/backends/memory");
  const mem = createMemoryAdapter(seed);
  const settings = createSettings({
    storages: { preferences: mem, memory: mem },
    defaultStorage: "preferences",
  });
  mockState.current = settings;
  const mod = await import("@/stores/apiProxyStore");
  await settings.hydrateAll();
  return { ...mod, mem };
}

/** 读落盘原始字符串（存储后端 dump 后门，镜像 directAccessStore.test 模式） */
function persisted(mem: { dump(): Map<string, string> }): string | null {
  return mem.dump().get("api_proxy_base") ?? null;
}

describe("apiProxyStore（ADR-0146 D3）", () => {
  it("默认空串（未配置 = 官方域名 + 直连兜底）", async () => {
    const { apiProxyUrl } = await loadStore();
    expect(apiProxyUrl()).toBe("");
    expect(persisted((await loadStore()).mem)).toBeNull();
  });

  it("合法基址：无尾斜杠归一化落盘（原始字符串无引号）", async () => {
    const { setApiProxyBase, apiProxyUrl, mem } = await loadStore();
    expect(setApiProxyBase("https://x.y.workers.dev/p/")).toBeNull();
    expect(apiProxyUrl()).toBe("https://x.y.workers.dev/p");
    // 落盘契约：Java ApiEndpoints.getString 直接读原始字符串（无 JSON 引号）
    expect(persisted(mem)).toBe("https://x.y.workers.dev/p");
  });

  it("非 https 前缀拒写盘（凭据面拒明文）", async () => {
    const { setApiProxyBase, apiProxyUrl, mem } = await loadStore();
    expect(setApiProxyBase("http://insecure.example/p")).toContain("https://");
    expect(apiProxyUrl()).toBe("");
    expect(persisted(mem)).toBeNull();
  });

  it("仅 scheme 无主机名拒写盘", async () => {
    const { setApiProxyBase, apiProxyUrl } = await loadStore();
    expect(setApiProxyBase("https://")).toContain("主机名");
    expect(apiProxyUrl()).toBe("");
  });

  it("空白 = 关闭（落盘空串，官方域名 + 直连兜底）", async () => {
    const { setApiProxyBase, apiProxyUrl, mem } = await loadStore();
    setApiProxyBase("https://x.y.workers.dev/p");
    expect(setApiProxyBase("   ")).toBeNull();
    expect(apiProxyUrl()).toBe("");
    expect(persisted(mem)).toBe("");
  });
});
