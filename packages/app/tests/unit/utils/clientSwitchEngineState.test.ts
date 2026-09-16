// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * clientSwitch 引擎降级扩展（ADR-0164 / spec §3、§7.2、E11）——IO 边界双路径：
 * - readAutoFallbackSwitch / writeAutoFallbackSwitch：`pictelio_engine_auto_fallback` 直读写
 * - readEngineState：`pictelio_engine_state` 快照行解析（Java EngineRoute.snapshotLine 格式）
 *
 * oracle 溯源：
 * - 开关口径（absent/"" → true、"false" → false、畸形 → warn + true）= Java
 *   EnginePrefs.autoFallbackEnabled 逐字镜像（spec §3 键契约表缺省列）。
 * - 快照行格式 = EngineRoute.snapshotLine() 逐字拼接
 *   `preferred=<kind> effective=<kind|none> reason=<code>`（spec §3）。
 * - 原因码集合 = spec §3.1 十码。
 * - 畸形快照 warn + null（spec E11：禁静默）。
 */

const mocks = vi.hoisted(() => ({
  preferencesGet: vi.fn(),
  preferencesSet: vi.fn(),
  exitApp: vi.fn(),
  restart: vi.fn(),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: mocks.preferencesGet, set: mocks.preferencesSet },
}));
vi.mock("@capacitor/app", () => ({
  App: { exitApp: mocks.exitApp },
}));
vi.mock("@/native/ClientInfo", () => ({
  ClientInfo: { restart: mocks.restart, getClientKinds: vi.fn() },
}));

async function loadModule() {
  vi.resetModules();
  const mod = await import("@/utils/clientSwitch");
  return mod;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readAutoFallbackSwitch（缺省开，镜像 Java autoFallbackEnabled）", () => {
  it("absent（null）→ true（缺省开）", async () => {
    mocks.preferencesGet.mockResolvedValue({ value: null });
    const { readAutoFallbackSwitch } = await loadModule();
    await expect(readAutoFallbackSwitch()).resolves.toBe(true);
  });

  it("空字符串 → true（缺省开）", async () => {
    mocks.preferencesGet.mockResolvedValue({ value: "" });
    const { readAutoFallbackSwitch } = await loadModule();
    await expect(readAutoFallbackSwitch()).resolves.toBe(true);
  });

  it('"true" → true', async () => {
    mocks.preferencesGet.mockResolvedValue({ value: "true" });
    const { readAutoFallbackSwitch } = await loadModule();
    await expect(readAutoFallbackSwitch()).resolves.toBe(true);
  });

  it('"false" → false', async () => {
    mocks.preferencesGet.mockResolvedValue({ value: "false" });
    const { readAutoFallbackSwitch } = await loadModule();
    await expect(readAutoFallbackSwitch()).resolves.toBe(false);
  });

  it("畸形值 → true + console.warn（fail-open 到缺省，禁静默）", async () => {
    mocks.preferencesGet.mockResolvedValue({ value: "yes" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readAutoFallbackSwitch } = await loadModule();
    await expect(readAutoFallbackSwitch()).resolves.toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[clientSwitch]"), "yes");
    warn.mockRestore();
  });

  it("读取失败（get reject）→ true + console.warn（不抛）", async () => {
    mocks.preferencesGet.mockRejectedValue(new Error("bridge 故障"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readAutoFallbackSwitch } = await loadModule();
    await expect(readAutoFallbackSwitch()).resolves.toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[clientSwitch]"), expect.anything());
    warn.mockRestore();
  });
});

describe("writeAutoFallbackSwitch（写入不抛，失败必须 warn）", () => {
  it("true → set 值 'true'", async () => {
    mocks.preferencesSet.mockResolvedValue(undefined);
    const { writeAutoFallbackSwitch } = await loadModule();
    await expect(writeAutoFallbackSwitch(true)).resolves.toBeUndefined();
    expect(mocks.preferencesSet).toHaveBeenCalledWith({
      key: "pictelio_engine_auto_fallback",
      value: "true",
    });
  });

  it("false → set 值 'false'", async () => {
    mocks.preferencesSet.mockResolvedValue(undefined);
    const { writeAutoFallbackSwitch } = await loadModule();
    await expect(writeAutoFallbackSwitch(false)).resolves.toBeUndefined();
    expect(mocks.preferencesSet).toHaveBeenCalledWith({
      key: "pictelio_engine_auto_fallback",
      value: "false",
    });
  });

  it("写入失败（set reject）→ 不抛 + console.warn（UI 乐观更新的持久化失败必须可见）", async () => {
    mocks.preferencesSet.mockRejectedValue(new Error("磁盘满"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { writeAutoFallbackSwitch } = await loadModule();
    await expect(writeAutoFallbackSwitch(true)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[clientSwitch]"), expect.anything());
    warn.mockRestore();
  });
});

describe("readEngineState（快照行解析，格式 = EngineRoute.snapshotLine）", () => {
  it("合法行 → 结构化快照", async () => {
    mocks.preferencesGet.mockResolvedValue({
      value: "preferred=lynx effective=webview reason=lynx_unavailable",
    });
    const { readEngineState } = await loadModule();
    await expect(readEngineState()).resolves.toEqual({
      preferred: "lynx",
      effective: "webview",
      reason: "lynx_unavailable",
    });
  });

  it("effective=none（双失败）→ effective 为 null", async () => {
    mocks.preferencesGet.mockResolvedValue({
      value: "preferred=lynx effective=none reason=no_engine",
    });
    const { readEngineState } = await loadModule();
    await expect(readEngineState()).resolves.toEqual({
      preferred: "lynx",
      effective: null,
      reason: "no_engine",
    });
  });

  it("按首选运行（effective === preferred）→ 原样返回（降级判定交给 UI）", async () => {
    mocks.preferencesGet.mockResolvedValue({
      value: "preferred=lynx effective=lynx reason=preferred",
    });
    const { readEngineState } = await loadModule();
    await expect(readEngineState()).resolves.toEqual({
      preferred: "lynx",
      effective: "lynx",
      reason: "preferred",
    });
  });

  it("无记录（null）→ null（不 warn：正常冷启动尚未 resolve 的合法态）", async () => {
    mocks.preferencesGet.mockResolvedValue({ value: null });
    const { readEngineState } = await loadModule();
    await expect(readEngineState()).resolves.toBeNull();
  });

  it("空字符串 → null", async () => {
    mocks.preferencesGet.mockResolvedValue({ value: "" });
    const { readEngineState } = await loadModule();
    await expect(readEngineState()).resolves.toBeNull();
  });

  it("畸形行（自由文本）→ null + console.warn（spec E11 禁静默）", async () => {
    mocks.preferencesGet.mockResolvedValue({ value: "garbage" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readEngineState } = await loadModule();
    await expect(readEngineState()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[clientSwitch]"), "garbage");
    warn.mockRestore();
  });

  it("preferred 非法 → null + console.warn", async () => {
    const raw = "preferred=banana effective=webview reason=preferred";
    mocks.preferencesGet.mockResolvedValue({ value: raw });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readEngineState } = await loadModule();
    await expect(readEngineState()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[clientSwitch]"), raw);
    warn.mockRestore();
  });

  it("effective 非法（既非 none 也非 kind）→ null + console.warn", async () => {
    const raw = "preferred=lynx effective=banana reason=preferred";
    mocks.preferencesGet.mockResolvedValue({ value: raw });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readEngineState } = await loadModule();
    await expect(readEngineState()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[clientSwitch]"), raw);
    warn.mockRestore();
  });

  it("读取失败（get reject）→ null + console.warn（不抛）", async () => {
    mocks.preferencesGet.mockRejectedValue(new Error("bridge 故障"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readEngineState } = await loadModule();
    await expect(readEngineState()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[clientSwitch]"), expect.anything());
    warn.mockRestore();
  });
});

describe("reasonKey（原因码 → i18n 键）", () => {
  it("已知码 → 对应 engineFallback.reason.* 键", async () => {
    const { reasonKey } = await loadModule();
    expect(reasonKey("lynx_unavailable")).toBe("engineFallback.reason.lynx_unavailable");
    expect(reasonKey("a11y_lynx_last_resort")).toBe("engineFallback.reason.a11y_lynx_last_resort");
  });

  it("未知码 → unknown 键兜底（UI 显式显示「引擎状态未知」）", async () => {
    const { reasonKey } = await loadModule();
    expect(reasonKey("mystery_code")).toBe("engineFallback.reason.unknown");
  });
});
