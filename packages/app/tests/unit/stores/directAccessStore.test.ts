/**
 * directAccessStore 单测（ticket #391 T6）——契约序列化 + IPv4 校验 + 开关持久化。
 *
 * <b>Oracle 溯源（测试硬约束 #6：期望值出处可追溯，禁止从被测实现反推）</b>：
 * <ul>
 *   <li><b>契约 JSON 形态</b>（{"enabled": boolean, "manual": [{"host","ip"}]}，恰好
 *       两字段）：ticket #391 指定 + Java 侧解析契约（DirectAccessConfig javadoc
 *       「存储契约」：SharedPreferences "CapacitorStorage" 键 direct_access_settings）。
 *       fixture 字面量即 Java 侧能逐字段解析的真实形态（真实样例硬约束 #2，非自洽 mock）；
 *       测试断言的是<b>落盘序列化字符串</b>（经真实 settings registry + jsonCodec 管线，
 *       仅存储后端换为内存 adapter），与生产 @capacitor/preferences 写入路径同构；</li>
 *   <li><b>IPv4 校验边界</b>（4 段 0-255、拒前导零）：ticket #391 指定「正则从 Java
 *       IpTableMerger 同语义移植」——边界期望值独立枚举（0.0.0.0 / 255.255.255.255 /
 *       256 越界 / 01 前导零 / 段数 / 非数字），与 IpTableMergerTest 的 Java 侧语义
 *       断言互为差分（独立实现差分测试模式）；</li>
 *   <li><b>开关翻转持久化</b>：ticket #391「开关切换 → Java 侧下一次请求即感知」——
 *       落盘 JSON 字符串是 Java raw equals 解析热路径的直接输入；</li>
 *   <li><b>读入容忍</b>（非法 IP 条目 hydrate 后保留）：Java Merger 对非法条目跳过 +
 *       告警地容忍（不整段拒收）——TS 读入若丢弃会在下次写盘时静默销毁用户数据
 *       （测试硬约束 #3 禁静默降级）。</li>
 * </ul>
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Settings } from "@/settings/registry";

const mockState = vi.hoisted(() => ({
  current: null as Settings | null,
}));

/** 桥 mock（refreshDirectAccessRuntime 的数据源/失败注入） */
const bridgeMock = vi.hoisted(() => ({
  directAccessStatus: vi.fn(),
  directAccessCommand: vi.fn(),
}));

vi.mock("@/settings", () => ({
  get settings() {
    return mockState.current;
  },
  jsonCodec: {
    encode: (v: unknown) => JSON.stringify(v),
    decode: (raw: string) => JSON.parse(raw),
  },
}));

vi.mock("@/native/DirectAccess", () => ({
  DIRECT_ACCESS_DEFAULT_STATUS: {
    switchState: "UNSET",
    imageChannel: "CLOSED",
    apiChannel: "CLOSED",
    tableEntries: 0,
    tableSource: "builtin",
    lastFetchAtMillis: 0,
  },
  directAccessStatus: bridgeMock.directAccessStatus,
  directAccessCommand: bridgeMock.directAccessCommand,
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
  const mod = await import("@/stores/directAccessStore");
  await settings.hydrateAll();
  return { ...mod, mem };
}

/** 读落盘字符串（存储后端 dump 后门） */
function persisted(mem: { dump(): Map<string, string> }): string | null {
  return mem.dump().get("direct_access_settings") ?? null;
}

describe("directAccessStore 存储契约（oracle = ticket #391 + Java PREF_KEY 契约字面量）", () => {
  it("写盘 JSON 与 Java 解析形态逐字段一致（恰 enabled/manual 两字段，条目恰 host/ip）", async () => {
    const { setDirectAccessEnabled, setManualEntries, mem } = await loadStore();

    setDirectAccessEnabled(true);
    expect(setManualEntries([{ host: " I.PXIMG.NET ", ip: " 210.140.139.131 " }])).toBeNull();

    const raw = persisted(mem);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    // 逐字段对齐 Java DirectAccessConfig.parse 的期望形态（含规范化：host 小写去空白）
    expect(parsed).toEqual({
      enabled: true,
      manual: [{ host: "i.pximg.net", ip: "210.140.139.131" }],
    });
    // 契约纯度：根级与条目级都不得有第三字段（多余字段 Java 虽忽略，但契约形态锁定）
    expect(Object.keys(parsed)).toEqual(["enabled", "manual"]);
    expect(Object.keys((parsed.manual as Record<string, string>)[0]!)).toEqual(["host", "ip"]);
  });

  it("hydrate 真实契约样例（Java 同款字面量）→ 开关与手动表进 signal", async () => {
    const { directAccessState } = await loadStore({
      direct_access_settings: JSON.stringify({
        enabled: true,
        manual: [{ host: "i.pximg.net", ip: "210.140.139.131" }],
      }),
    });

    expect(directAccessState().enabled).toBe(true);
    expect(directAccessState().manual).toEqual([{ host: "i.pximg.net", ip: "210.140.139.131" }]);
  });

  it("读入容忍非法 IP 条目（Java Merger 跳过式容忍；TS 不静默销毁用户数据）", async () => {
    const { directAccessState } = await loadStore({
      direct_access_settings: JSON.stringify({
        enabled: false,
        manual: [{ host: "odd.example", ip: "999.9.9.9" }],
      }),
    });

    expect(directAccessState().manual).toEqual([{ host: "odd.example", ip: "999.9.9.9" }]);
  });
});

describe("directAccessStore IPv4 校验（oracle = Java IpTableMerger.isValidIpv4Literal 同语义）", () => {
  it("合法字面量：4 段 0-255（含 0 段与边界 255）", async () => {
    const { isValidIpv4Literal } = await loadStore();
    for (const ip of ["0.0.0.0", "255.255.255.255", "1.2.3.4", "10.0.0.1", "210.140.139.131"]) {
      expect(isValidIpv4Literal(ip), ip).toBe(true);
    }
  });

  it("非法字面量：256 越界 / 前导零 / 段数不对 / 非数字 / 空白尾随", async () => {
    const { isValidIpv4Literal } = await loadStore();
    for (const ip of [
      "256.1.1.1", // 越界
      "01.2.3.4", // 前导零（八进制歧义形态）
      "1.01.2.3", // 中段前导零
      "255.255.255.256", // 末段越界
      "1.2.3", // 3 段
      "1.2.3.4.5", // 5 段
      "a.b.c.d", // 非数字
      "1.2.3.4.", // 尾空段
      ".1.2.3.4", // 首空段
      "1..2.3", // 中空段
      "1.2.3.4 ", // 空白尾随（严格字面量不 trim）
      "１.２.３.４", // 全角数字
    ]) {
      expect(isValidIpv4Literal(ip), ip).toBe(false);
    }
  });

  it("validateManualEntry：结构校验文案 + 合法返回 null", async () => {
    const { validateManualEntry } = await loadStore();

    expect(validateManualEntry("not-an-object")).toBe("条目必须是对象");
    expect(validateManualEntry({})).toBe("host 不能为空");
    expect(validateManualEntry({ host: "  ", ip: "1.2.3.4" })).toBe("host 不能为空");
    expect(validateManualEntry({ host: "h.example", ip: "" })).toBe("IP 不能为空");
    expect(validateManualEntry({ host: "h.example", ip: "256.0.0.1" })).toBe(
      "IP 必须是合法 IPv4 字面量（4 段 0-255，无前导零）",
    );
    expect(validateManualEntry({ host: "h.example", ip: "01.2.3.4" })).toBe(
      "IP 必须是合法 IPv4 字面量（4 段 0-255，无前导零）",
    );
    expect(validateManualEntry({ host: "h.example", ip: "1.2.3.4" })).toBeNull();
  });
});

describe("directAccessStore 写入口", () => {
  it("setManualEntries 非法条目拒绝写盘并返回错误文案", async () => {
    const { setManualEntries, directAccessState, mem } = await loadStore();

    const err = setManualEntries([{ host: "h.example", ip: "256.1.1.1" }]);

    expect(err).toBe("IP 必须是合法 IPv4 字面量（4 段 0-255，无前导零）");
    expect(directAccessState().manual).toEqual([]);
    expect(persisted(mem)).toBeNull(); // 拒写盘
  });

  it("开关翻转持久化（默认关；翻转后落盘 JSON 即 Java raw equals 热路径输入）", async () => {
    const { directAccessState, setDirectAccessEnabled, mem } = await loadStore();

    expect(directAccessState().enabled).toBe(false);
    expect(persisted(mem)).toBeNull(); // 默认态不写回（registry 无记录不落盘语义）

    setDirectAccessEnabled(true);
    expect(directAccessState().enabled).toBe(true);
    expect(persisted(mem)).toBe('{"enabled":true,"manual":[]}');

    setDirectAccessEnabled(false);
    expect(persisted(mem)).toBe('{"enabled":false,"manual":[]}');
  });

  it("setManualEntries 全量替换并规范化落盘（保留开关位）", async () => {
    const { setDirectAccessEnabled, setManualEntries, directAccessState, mem } = await loadStore();

    setDirectAccessEnabled(true);
    expect(setManualEntries([{ host: "App-API.Pixiv.net", ip: "210.140.139.155" }])).toBeNull();

    expect(directAccessState().manual).toEqual([
      { host: "app-api.pixiv.net", ip: "210.140.139.155" },
    ]);
    expect(JSON.parse(persisted(mem)!)).toEqual({
      enabled: true,
      manual: [{ host: "app-api.pixiv.net", ip: "210.140.139.155" }],
    });
  });
});

describe("directAccessStore 运行时状态刷新（bridge = @/native/DirectAccess mock）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("桥成功 → signal 更新为 Java 快照", async () => {
    const snapshot = {
      switchState: "ON",
      imageChannel: "CLOSED",
      apiChannel: "HALF_OPEN",
      tableEntries: 4,
      tableSource: "manual+remote+builtin",
      lastFetchAtMillis: 1_000_000,
    };
    bridgeMock.directAccessStatus.mockResolvedValueOnce(snapshot);

    const { directAccessRuntime, refreshDirectAccessRuntime } = await loadStore();
    await refreshDirectAccessRuntime();

    expect(directAccessRuntime()).toEqual(snapshot);
    expect(bridgeMock.directAccessStatus).toHaveBeenCalledTimes(1);
  });

  it("桥失败 → 保留上次状态 + console.warn（禁静默降级）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stale = {
      switchState: "OFF",
      imageChannel: "CLOSED",
      apiChannel: "CLOSED",
      tableEntries: 3,
      tableSource: "builtin",
      lastFetchAtMillis: 0,
    };
    bridgeMock.directAccessStatus.mockResolvedValueOnce(stale);
    bridgeMock.directAccessStatus.mockRejectedValueOnce(new Error("bridge down"));

    const { directAccessRuntime, refreshDirectAccessRuntime } = await loadStore();
    await refreshDirectAccessRuntime();
    await refreshDirectAccessRuntime();

    expect(directAccessRuntime()).toEqual(stale);
    expect(warnSpy).toHaveBeenCalledWith(
      "[directAccessStore] directAccessStatus 查询失败，保留上次状态",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
