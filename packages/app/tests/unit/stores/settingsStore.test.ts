// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Preferences ──
const mockGet = vi.fn<() => Promise<{ value: string | null }>>();
const mockSet = vi.fn<() => Promise<void>>();
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: (...args: unknown[]) => mockGet(...args),
    set: (...args: unknown[]) => mockSet(...args),
  },
}));

// ── 被测试模块 ──
import { layoutMode, setLayoutMode, loadLayoutModePreference } from "@/stores/settingsStore";

describe("settingsStore — setLayoutMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("成功路径：更新 state + 持久化 + 派发事件", async () => {
    mockSet.mockResolvedValue(undefined);
    const events: string[] = [];
    const handler = (e: Event) => events.push(e.type);
    window.addEventListener("layoutModeChanged", handler);

    await setLayoutMode("single");

    expect(layoutMode()).toBe("single");
    expect(mockSet).toHaveBeenCalledWith({ key: "layout_mode", value: "single" });
    expect(events).toContain("layoutModeChanged");
    window.removeEventListener("layoutModeChanged", handler);
  });

  it("Preferences.set 失败 → state 已更新，不抛异常", async () => {
    mockSet.mockRejectedValue(new Error("storage full"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(setLayoutMode("grid")).resolves.toBeUndefined();
    expect(layoutMode()).toBe("grid");
    expect(warnSpy).toHaveBeenCalledWith(
      "[settingsStore] Failed to persist layoutMode",
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});

describe("settingsStore — loadLayoutModePreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("成功路径：加载有效值 → 更新 state", async () => {
    mockGet.mockResolvedValue({ value: "waterfall" });

    await loadLayoutModePreference();

    expect(layoutMode()).toBe("waterfall");
  });

  it("Preferences 返回 null → state 保持默认", async () => {
    mockGet.mockResolvedValue({ value: null });

    await loadLayoutModePreference();

    expect(layoutMode()).toBe("waterfall"); // 默认值
  });

  it("Preferences 返回无效值 → state 保持默认", async () => {
    mockGet.mockResolvedValue({ value: "invalid-mode" });

    await loadLayoutModePreference();

    expect(layoutMode()).toBe("waterfall");
  });

  it("Preferences.get 失败 → state 保持默认，不抛异常", async () => {
    mockGet.mockRejectedValue(new Error("corrupted storage"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(loadLayoutModePreference()).resolves.toBeUndefined();
    expect(layoutMode()).toBe("waterfall");
    expect(warnSpy).toHaveBeenCalledWith(
      "[settingsStore] Failed to load layoutMode preference",
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});
