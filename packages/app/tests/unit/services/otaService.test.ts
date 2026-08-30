// ─── otaService 单测（#251） ───
// oracle 溯源：期望值来自规格 docs/specs/ota-web-bundle.md「检查与调度」节
// （单 fetch 三重消费 / fail-open 显式化 / 快慢双通道的自愈路径 / 退避）与
// update-check 的 isNewer/isBelowMin 独立语义（#247 已有性质测试锚定）。
// 契约 mock：APP_VERSION 由 vitest.config define 注入（"3.21.2"），floor/webBundle
// 字段形态与 version.json 生产 schema 同形（真实样例口径，禁自洽 mock）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockOta = vi.hoisted(() => ({
  status: vi.fn(),
  install: vi.fn(),
  notifyReady: vi.fn(),
  applyNow: vi.fn(),
}));
const mockCap = vi.hoisted(() => ({ isNativePlatform: vi.fn(() => true) }));
const mockApp = vi.hoisted(() => ({
  addListener: vi.fn(async () => ({ remove: async () => {} })),
}));
const mockSettings = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    otaLastKnownFloor: () => store.get("floor") ?? "",
    setOtaLastKnownFloor: async (v: string) => {
      store.set("floor", v);
    },
    setShowUpdateDialog: vi.fn(),
  };
});

vi.mock("@capacitor/core", () => ({ Capacitor: mockCap }));
vi.mock("@capacitor/app", () => ({ App: mockApp }));
vi.mock("@/native/Ota", () => ({ Ota: mockOta }));
vi.mock("@/stores/settingsStore", () => ({
  otaLastKnownFloor: mockSettings.otaLastKnownFloor,
  setOtaLastKnownFloor: mockSettings.setOtaLastKnownFloor,
  setShowUpdateDialog: mockSettings.setShowUpdateDialog,
}));

import {
  gateActive,
  gateError,
  gateFloor,
  gateHealing,
  notifyWebBundleReady,
  registerOtaResumeListener,
  resetOtaStateForTest,
  RESUME_CHECK_MIN_INTERVAL_MS,
  runOtaCheck,
  selfHeal,
} from "@/services/otaService";

/** 构造成功响应的 fetchImpl（payload 与 version.json 生产 schema 同形） */
function fetchOk(payload: Record<string, unknown>): Parameters<typeof runOtaCheck>[0] {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetOtaStateForTest();
  mockCap.isNativePlatform.mockReturnValue(true);
  mockOta.install.mockReset();
  mockOta.notifyReady.mockReset().mockResolvedValue(undefined);
  mockOta.applyNow.mockReset().mockResolvedValue(undefined);
  mockSettings.store.clear();
  vi.stubGlobal("location", { reload: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("otaService 门槛评估（fail-open 语义）", () => {
  it("检查失败且无缓存 floor → 不设门槛 + 显式 warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFail = vi.fn().mockRejectedValue(new Error("network down"));

    await runOtaCheck(fetchFail);

    expect(gateActive()).toBe(false);
    expect(gateFloor()).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("不设门槛"), expect.anything());
  });

  it("检查失败 + 缓存 floor → 用缓存评估（显式 warn，非静默）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSettings.store.set("floor", "3.22.0");
    mockOta.install.mockRejectedValue(new Error("offline"));
    const fetchFail = vi.fn().mockRejectedValue(new Error("network down"));

    await runOtaCheck(fetchFail);
    await flush();

    expect(gateFloor()).toBe("3.22.0");
    expect(gateActive()).toBe(true); // 3.21.2 < 3.22.0 → 门槛命中并已尝试自愈
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("缓存 floor"), expect.anything());
  });

  it("floor 达标 → 不设门槛 + floor 写入缓存", async () => {
    await runOtaCheck(fetchOk({ version: "9.9.9", minWebVersion: "3.20.0" }));

    expect(gateActive()).toBe(false);
    expect(gateFloor()).toBe("3.20.0");
    expect(mockSettings.store.get("floor")).toBe("3.20.0");
  });

  it("floor 缺失（未发布 OTA）→ 不设门槛且不写缓存", async () => {
    await runOtaCheck(fetchOk({ version: "3.21.2" }));

    expect(gateActive()).toBe(false);
    expect(gateFloor()).toBeNull();
    expect(mockSettings.store.has("floor")).toBe(false);
  });
});

describe("otaService G1 自愈（前台直连快路径）", () => {
  it("门槛命中 → install(urlBase) → applyNow → reload", async () => {
    mockOta.install.mockResolvedValue({ ok: true, version: "3.22.0" });

    await runOtaCheck(
      fetchOk({
        version: "3.22.0",
        minWebVersion: "3.22.0",
        webBundle: {
          version: "3.22.0",
          url: "https://example.com/repo/releases/download/v3.22.0/pictelio-3.22.0",
        },
      }),
    );
    await flush();

    expect(gateActive()).toBe(true);
    expect(mockOta.install).toHaveBeenCalledWith({
      urlBase: "https://example.com/repo/releases/download/v3.22.0/pictelio-3.22.0",
    });
    expect(mockOta.applyNow).toHaveBeenCalledTimes(1);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("自愈失败 → gateError 暴露 + healing 复位（转阻断态，无静默）", async () => {
    mockOta.install.mockRejectedValue(new Error("checksum"));

    await runOtaCheck(
      fetchOk({
        version: "3.22.0",
        minWebVersion: "3.22.0",
        webBundle: { version: "3.22.0", url: "https://example.com/prefix" },
      }),
    );
    await flush();

    expect(gateActive()).toBe(true);
    expect(gateError()).toBe("checksum");
    expect(gateHealing()).toBe(false);
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("门槛命中但 webBundle 缺失 → 无可用更新包错误（不崩溃）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runOtaCheck(fetchOk({ version: "3.22.0", minWebVersion: "3.22.0" }));
    await flush();

    expect(gateActive()).toBe(true);
    expect(gateError()).toContain("无可用更新包");
    expect(warn).toHaveBeenCalled();
  });

  it("T3：install 拒绝 apk-too-old → 撤销门槛转 APK 弹窗通道（不阻断）", async () => {
    mockOta.install.mockRejectedValue(new Error("apk-too-old"));

    await runOtaCheck(
      fetchOk({
        version: "3.22.0",
        minWebVersion: "3.22.0",
        webBundle: { version: "3.22.0", url: "https://example.com/prefix" },
      }),
    );
    await flush();

    expect(gateActive()).toBe(false);
    expect(gateError()).toBe("");
    expect(mockSettings.setShowUpdateDialog).toHaveBeenCalledWith(true);
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("手动重试：selfHeal 可被 UI 重复触发", async () => {
    mockOta.install
      .mockRejectedValueOnce(new Error("HTTP 404"))
      .mockResolvedValueOnce({ ok: true, version: "3.22.0" });
    await runOtaCheck(
      fetchOk({
        version: "3.22.0",
        minWebVersion: "3.22.0",
        webBundle: { version: "3.22.0", url: "https://example.com/prefix" },
      }),
    );
    await flush();
    expect(gateError()).toBe("HTTP 404");

    const ok = await selfHeal();
    expect(ok).toBe(true);
    expect(gateError()).toBe("");
  });
});

describe("otaService T0 静默安装（下次启动生效）", () => {
  it("webBundle 较新 → 静默 install 写 pending", async () => {
    mockOta.install.mockResolvedValue({ ok: true, version: "3.22.0" });

    await runOtaCheck(
      fetchOk({
        version: "3.22.0",
        webBundle: { version: "3.22.0", url: "https://example.com/prefix" },
      }),
    );
    await flush();

    expect(gateActive()).toBe(false);
    expect(mockOta.install).toHaveBeenCalledWith({ urlBase: "https://example.com/prefix" });
  });

  it("webBundle 未变新 → 不安装", async () => {
    await runOtaCheck(
      fetchOk({
        version: "3.21.2",
        webBundle: { version: "3.21.2", url: "https://example.com/prefix" },
      }),
    );
    await flush();
    expect(mockOta.install).not.toHaveBeenCalled();
  });

  it("安装失败 → 指数退避，同会话内不再立即重试", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockOta.install.mockRejectedValue(new Error("HTTP 500"));
    const payload = {
      version: "3.22.0",
      webBundle: { version: "3.22.0", url: "https://example.com/prefix" },
    };

    await runOtaCheck(fetchOk(payload));
    await flush();
    await runOtaCheck(fetchOk(payload));
    await flush();

    expect(mockOta.install).toHaveBeenCalledTimes(1); // 第二次被退避拦下
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("退避"), expect.anything());
  });
});

describe("otaService 护栏与挂点", () => {
  it("非原生环境：检查照跑（弹窗面用）但 install/notifyReady 显式跳过", async () => {
    mockCap.isNativePlatform.mockReturnValue(false);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await runOtaCheck(
      fetchOk({
        version: "3.22.0",
        webBundle: { version: "3.22.0", url: "https://example.com/prefix" },
      }),
    );
    await flush();
    notifyWebBundleReady();
    await vi.advanceTimersByRealTimeAsync?.(600).catch?.(() => {});
    await flush();

    expect(mockOta.install).not.toHaveBeenCalled();
    expect(mockOta.notifyReady).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });

  it("notifyReady 首帧挂点：延迟上报当前 bundle 版本（版本握手契约）", async () => {
    vi.useFakeTimers();
    notifyWebBundleReady();
    expect(mockOta.notifyReady).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(mockOta.notifyReady).toHaveBeenCalledWith({ version: APP_VERSION });
  });

  it("回前台监听注册走 @capacitor/app（authStore 同款先例）", async () => {
    registerOtaResumeListener();
    registerOtaResumeListener(); // 幂等
    expect(mockApp.addListener).toHaveBeenCalledTimes(1);
    expect(mockApp.addListener).toHaveBeenCalledWith("appStateChange", expect.any(Function));
  });

  it("resume 节流常量 = 4h（规格：≥4h 才补查）", () => {
    expect(RESUME_CHECK_MIN_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
  });
});
