// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * clientSwitch（webview ↔ lynx 开关，IO 边界 + 切换时序）。
 *
 * 深模块契约（issue #120/#123）：
 * - 读/写均直对 @capacitor/preferences 单键（不依赖 settings 层）
 * - switchClient 内化：in-flight 锁（busy）、5s 写入超时（timeout）、
 *   原生 restart（fallback App.exitApp）、错误模式显式返回
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
  vi.useRealTimers();
});

describe("readClientKind（直读 Preferences 单键）", () => {
  it("读取到 lynx → 返回 lynx", async () => {
    mocks.preferencesGet.mockResolvedValue({ value: "lynx" });
    const { readClientKind } = await loadModule();
    await expect(readClientKind()).resolves.toBe("lynx");
  });

  it("读取到 webview → 返回 webview", async () => {
    mocks.preferencesGet.mockResolvedValue({ value: "webview" });
    const { readClientKind } = await loadModule();
    await expect(readClientKind()).resolves.toBe("webview");
  });

  it("无记录（null）→ 默认 webview", async () => {
    mocks.preferencesGet.mockResolvedValue({ value: null });
    const { readClientKind, DEFAULT_CLIENT } = await loadModule();
    await expect(readClientKind()).resolves.toBe(DEFAULT_CLIENT);
  });

  it("异常值 → 默认 webview（不抛）", async () => {
    mocks.preferencesGet.mockResolvedValue({ value: "unknown-kind" });
    const { readClientKind } = await loadModule();
    await expect(readClientKind()).resolves.toBe("webview");
  });

  it("读取失败（get reject）→ 默认 webview + console.warn（禁止静默降级）", async () => {
    mocks.preferencesGet.mockRejectedValue(new Error("bridge 故障"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readClientKind } = await loadModule();
    await expect(readClientKind()).resolves.toBe("webview");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[clientSwitch]"), expect.anything());
    warn.mockRestore();
  });
});

describe("switchClient（切换深模块时序）", () => {
  it("成功：写入 1 次且值正确 → 调原生 restart → ok:true（不调 exitApp）", async () => {
    mocks.preferencesSet.mockResolvedValue(undefined);
    mocks.restart.mockResolvedValue(undefined);
    const { switchClient } = await loadModule();
    const result = await switchClient("lynx");
    expect(result).toEqual({ ok: true });
    expect(mocks.preferencesSet).toHaveBeenCalledTimes(1);
    expect(mocks.preferencesSet).toHaveBeenCalledWith({
      key: "pictelio_client_kind",
      value: "lynx",
    });
    expect(mocks.restart).toHaveBeenCalledTimes(1);
    expect(mocks.exitApp).not.toHaveBeenCalled();
  });

  it("连点/并发：第一个切换在途时第二次调用 → busy（不重复写入）", async () => {
    let releaseWrite: (() => void) | undefined;
    mocks.preferencesSet.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve;
        }),
    );
    mocks.restart.mockResolvedValue(undefined);
    const { switchClient } = await loadModule();
    const first = switchClient("lynx"); // 在途（set 未 resolve）
    const second = await switchClient("webview"); // 立即返回 busy
    expect(second).toEqual({ ok: false, reason: "busy" });
    releaseWrite?.();
    await expect(first).resolves.toEqual({ ok: true });
    expect(mocks.preferencesSet).toHaveBeenCalledTimes(1); // 只写入一次
    expect(mocks.preferencesSet).toHaveBeenCalledWith({
      key: "pictelio_client_kind",
      value: "lynx",
    });
  });

  it("写入超时（5s 未完成）→ timeout", async () => {
    mocks.preferencesSet.mockImplementation(() => new Promise(() => {})); // 永不 resolve
    const { switchClient } = await loadModule();
    vi.useFakeTimers();
    const pending = switchClient("lynx");
    vi.advanceTimersByTime(5_000);
    await expect(pending).resolves.toEqual({ ok: false, reason: "timeout" });
    vi.useRealTimers();
  });

  it("写入失败（set reject）→ write-failed（不调 restart）", async () => {
    mocks.preferencesSet.mockRejectedValue(new Error("写入失败"));
    const { switchClient } = await loadModule();
    const result = await switchClient("lynx");
    expect(result).toEqual({ ok: false, reason: "write-failed" });
    expect(mocks.restart).not.toHaveBeenCalled();
  });

  it("原生 restart 失败 → fallback App.exitApp → ok:true", async () => {
    mocks.preferencesSet.mockResolvedValue(undefined);
    mocks.restart.mockRejectedValue(new Error("无原生插件"));
    mocks.exitApp.mockResolvedValue(undefined);
    const { switchClient } = await loadModule();
    const result = await switchClient("lynx");
    expect(result).toEqual({ ok: true });
    expect(mocks.restart).toHaveBeenCalledTimes(1);
    expect(mocks.exitApp).toHaveBeenCalledTimes(1);
  });

  it("restart 与 exitApp 均失败 → restart-failed", async () => {
    mocks.preferencesSet.mockResolvedValue(undefined);
    mocks.restart.mockRejectedValue(new Error("无原生插件"));
    mocks.exitApp.mockRejectedValue(new Error("无 exitApp"));
    const { switchClient } = await loadModule();
    const result = await switchClient("lynx");
    expect(result).toEqual({ ok: false, reason: "restart-failed" });
  });
});

describe("supportsClientSwitch（ADR-0062 包能力）", () => {
  it("full 包（webview+lynx）→ true", async () => {
    const { supportsClientSwitch } = await loadModule();
    expect(supportsClientSwitch(["webview", "lynx"])).toBe(true);
  });

  it("webview-only → false", async () => {
    const { supportsClientSwitch } = await loadModule();
    expect(supportsClientSwitch(["webview"])).toBe(false);
  });

  it("lynx-only → false", async () => {
    const { supportsClientSwitch } = await loadModule();
    expect(supportsClientSwitch(["lynx"])).toBe(false);
  });

  it("null / undefined（未知）→ true（保守渲染）", async () => {
    const { supportsClientSwitch } = await loadModule();
    expect(supportsClientSwitch(null)).toBe(true);
    expect(supportsClientSwitch(undefined)).toBe(true);
  });

  it("空数组 / 非数组 → false（与 lynx 侧契约一致）", async () => {
    const { supportsClientSwitch } = await loadModule();
    expect(supportsClientSwitch([])).toBe(false);
    expect(supportsClientSwitch("webview")).toBe(false);
    expect(supportsClientSwitch({ kinds: ["webview"] })).toBe(false);
  });
});
